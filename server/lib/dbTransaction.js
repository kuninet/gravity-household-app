const path = require('path')
const sqlite3 = require('sqlite3')
const { createDbAsync } = require('./dbAsync')

let txLock = Promise.resolve()

/**
 * トランザクション直列化のための非同期ミューテックス
 * 一括登録（insertBatch）と固定費セルの upsert（setFixedCostCell）で共有し、
 * プロセス内の書き込みトランザクションを 1 本ずつ実行する。
 *
 * 注意: 再入不可。fn の中（lock 保持中）から withTxLock / runInWriteTransaction / insertBatch を
 * 呼ぶと、先行する自分自身の完了を待ち続けてデッドロックする。
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withTxLock(fn) {
  const nextLock = txLock.then(async () => {
    return await fn()
  })
  txLock = nextLock.catch(() => {})
  return nextLock
}

/**
 * 書き込みトランザクション用の独立した SQLite 接続を取得する（ファイル DB の場合は独立接続、:memory: の場合は共有 db を再利用）
 * 共有接続で BEGIN すると同じ接続を使う他のリクエストがトランザクションに巻き込まれるため、専用接続を使う。
 * @param {import('sqlite3').Database} db
 * @returns {Promise<{ batchDb: import('sqlite3').Database, isDedicated: boolean }>}
 */
async function openBatchConnection(db) {
  const dbPath =
    db && db.filename ? db.filename : process.env.DB_PATH || path.join(__dirname, '../household.db')
  if (!dbPath || dbPath === ':memory:') {
    return { batchDb: db, isDedicated: false }
  }

  const batchDb = new sqlite3.Database(dbPath)
  try {
    await new Promise((resolve, reject) => {
      batchDb.run('PRAGMA busy_timeout = 5000', (err) => (err ? reject(err) : resolve()))
    })
    return { batchDb, isDedicated: true }
  } catch (err) {
    await new Promise((resolve) => batchDb.close(resolve))
    throw err
  }
}

/**
 * 直列化キュー＋専用接続＋BEGIN IMMEDIATE で fn を実行し、成功時 COMMIT・失敗時 ROLLBACK する
 *
 * 注意: 再入不可（withTxLock を使うため）。fn の中から runInWriteTransaction / insertBatch を呼ぶと
 * デッドロックする。fn 内の読み書きは引数の txDbAsync（専用接続）だけで行い、共有 db は使わないこと。
 * @template T
 * @param {import('sqlite3').Database} db
 * @param {(txDbAsync: ReturnType<typeof createDbAsync>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
function runInWriteTransaction(db, fn) {
  return withTxLock(async () => {
    const { batchDb, isDedicated } = await openBatchConnection(db)
    const txDbAsync = createDbAsync(batchDb)

    try {
      await txDbAsync.run('BEGIN IMMEDIATE')
      try {
        const result = await fn(txDbAsync)
        await txDbAsync.run('COMMIT')
        return result
      } catch (err) {
        try {
          await txDbAsync.run('ROLLBACK')
        } catch {
          // ignore rollback error
        }
        throw err
      }
    } finally {
      if (isDedicated) {
        await new Promise((resolve) => batchDb.close(resolve))
      }
    }
  })
}

module.exports = {
  withTxLock,
  openBatchConnection,
  runInWriteTransaction,
}
