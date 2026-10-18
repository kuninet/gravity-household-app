const path = require('path')

// server/node_modules をモジュール解決パスに追加
const serverNodeModules = path.resolve(__dirname, '../../server/node_modules')
if (!module.paths.includes(serverNodeModules)) {
  module.paths.push(serverNodeModules)
}

const fs = require('fs')
const os = require('os')
const express = require('express')
const sqlite3 = require('sqlite3').verbose()
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

const SEED_CATEGORIES = [
  { code: 100, name: '食費', group: '食費' },
  { code: 103, name: '外食費', group: '食費' },
  { code: 105, name: '酒', group: '食費' },
  { code: 200, name: '日用品・雑費', group: '日用品' },
  { code: 201, name: 'クリーニング', group: '日用品' },
  { code: 300, name: '交通費', group: '交通費' },
  { code: 400, name: '交際費・娯楽', group: '交際費' },
  { code: 401, name: '映画', group: '交際費' },
  { code: 402, name: '本', group: '交際費' },
  { code: 500, name: '医療費', group: '医療費' },
  { code: 900, name: 'その他', group: 'その他' },
  { code: 901, name: '小遣い', group: '固定費' },
  { code: 700, name: '給与', group: '収入' },
  { code: 701, name: 'ボーナス', group: '収入' },
  { code: 702, name: '年金', group: '収入' },
  { code: 703, name: '配当・利息', group: '収入' },
  { code: 704, name: 'その他収入', group: '収入' },
  { code: 600, name: '家賃・光熱費', group: '固定費' },
  { code: 601, name: '電気', group: '固定費' },
  { code: 602, name: '水道', group: '固定費' },
  { code: 603, name: 'ガス一般', group: '固定費' },
  { code: 604, name: '家賃', group: '固定費' },
  { code: 605, name: '固定電話・フレッツ', group: '固定費' },
  { code: 606, name: '食洗機', group: '固定費' },
  { code: 607, name: '携帯電話', group: '固定費' },
  { code: 608, name: '保険', group: '固定費' },
]

/**
 * 一時 SQLite DB を作成しスキーマとカテゴリを初期化する
 */
function createTempDb() {
  const tempDbPath = path.join(
    os.tmpdir(),
    `mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  )

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(tempDbPath, (err) => {
      if (err) return reject(err)

      db.serialize(() => {
        db.run('PRAGMA journal_mode = WAL')
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          fiscal_month TEXT NOT NULL,
          amount INTEGER NOT NULL,
          type TEXT NOT NULL,
          category_code INTEGER,
          description TEXT,
          memo TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`)

        db.run(`CREATE TABLE IF NOT EXISTS categories (
          code INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          group_name TEXT NOT NULL
        )`)

        const stmt = db.prepare(
          'INSERT OR IGNORE INTO categories (code, name, group_name) VALUES (?, ?, ?)'
        )
        for (const cat of SEED_CATEGORIES) {
          stmt.run(cat.code, cat.name, cat.group)
        }
        stmt.finalize(() => {
          resolve({
            dbPath: tempDbPath,
            db,
            cleanup: () =>
              new Promise((res) => {
                db.close(() => {
                  try {
                    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath)
                    const wal = `${tempDbPath}-wal`
                    const shm = `${tempDbPath}-shm`
                    if (fs.existsSync(wal)) fs.unlinkSync(wal)
                    if (fs.existsSync(shm)) fs.unlinkSync(shm)
                  } catch (err) {
                    // 一時ファイルの削除失敗は無視
                    void err
                  }
                  res()
                })
              }),
          })
        })
      })
    })
  })
}

/**
 * テスト用サーバーをポート 0 で起動する
 */
function startServer(appInstance) {
  return new Promise((resolve) => {
    const s = appInstance.listen(0, () => {
      const port = s.address().port
      resolve({
        server: s,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => s.close(res)),
      })
    })
  })
}

/**
 * テスト用 MCP Client を接続して返す
 */
async function createMcpClient({ baseUrl, token }) {
  const headers = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const clientTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers,
    },
  })

  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return { client, clientTransport }
}

module.exports = {
  express,
  Client,
  StreamableHTTPClientTransport,
  createTempDb,
  startServer,
  createMcpClient,
  SEED_CATEGORIES,
}
