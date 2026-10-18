const path = require('path')
const sqlite3 = require('sqlite3')
const { createDbAsync } = require('../../lib/dbAsync')
const { isFixedCost, EXPENSE_FIXED_CODES, INCOME_FIXED_CODES } = require('../../lib/fixedCostCodes')
const { getFiscalMonth, isValidDateString } = require('../../lib/fiscalMonth')

let txLock = Promise.resolve()

/**
 * トランザクション直列化のための非同期ミューテックス
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
 * 一括登録用の独立した SQLite 接続を取得する（ファイル DB の場合は独立接続、:memory: の場合は共有 db を再利用）
 * @param {import('sqlite3').Database} db
 * @returns {Promise<{ batchDb: import('sqlite3').Database, isDedicated: boolean }>}
 */
async function openBatchConnection(db) {
  const dbPath =
    db && db.filename
      ? db.filename
      : process.env.DB_PATH || path.join(__dirname, '../../household.db')
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
 * 全カテゴリを取得し、固定費フラグを付与して返す
 * @param {import('sqlite3').Database} db
 * @returns {Promise<Array<{ code: number, name: string, group_name: string, fixed: boolean }>>}
 */
async function listCategories(db) {
  const dbAsync = createDbAsync(db)
  const rows =
    (await dbAsync.all('SELECT code, name, group_name FROM categories ORDER BY code ASC')) || []
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    group_name: row.group_name,
    fixed: Boolean(isFixedCost(row.code, row.group_name === '収入' ? 'INCOME' : 'EXPENSE')),
  }))
}

/**
 * LIKE 句のワイルドカード特殊文字（\, %, _）をエスケープする
 * @param {string} str
 * @returns {string}
 */
function escapeLikePattern(str) {
  return str.replace(/([\\%_])/g, '\\$1')
}

/**
 * フィルタ・ページネーション付きで取引一覧を取得する
 * @param {import('sqlite3').Database} db
 * @param {object} [filters]
 * @param {string} [filters.fiscal_month] - 会計月 (YYYY-MM)
 * @param {string} [filters.from] - 開始日 (YYYY-MM-DD)
 * @param {string} [filters.to] - 終了日 (YYYY-MM-DD)
 * @param {string} [filters.type] - 'INCOME' または 'EXPENSE'
 * @param {number} [filters.category_code] - カテゴリコード
 * @param {string} [filters.keyword] - 品名またはメモの部分一致検索
 * @param {boolean} [filters.include_fixed=true] - 固定費・給与行を含めるか
 * @param {number} [filters.limit=100] - 取得件数 (1〜500)
 * @param {number} [filters.offset=0] - 取得オフセット
 * @returns {Promise<{ total: number, count: number, items: Array }>}
 */
async function listTransactions(db, filters = {}) {
  const {
    fiscal_month,
    from,
    to,
    type,
    category_code,
    keyword,
    include_fixed = true,
    limit = 100,
    offset = 0,
  } = filters || {}

  const dbAsync = createDbAsync(db)
  const whereClauses = []
  const params = []

  if (fiscal_month) {
    whereClauses.push('t.fiscal_month = ?')
    params.push(fiscal_month)
  }
  if (from) {
    whereClauses.push('t.date >= ?')
    params.push(from)
  }
  if (to) {
    whereClauses.push('t.date <= ?')
    params.push(to)
  }
  if (type) {
    whereClauses.push('t.type = ?')
    params.push(type)
  }
  if (category_code !== undefined && category_code !== null) {
    whereClauses.push('t.category_code = ?')
    params.push(Number(category_code))
  }
  if (include_fixed === false) {
    const expensePlaceholders = EXPENSE_FIXED_CODES.map(() => '?').join(',')
    const incomePlaceholders = INCOME_FIXED_CODES.map(() => '?').join(',')
    whereClauses.push(`NOT (
      (t.type = 'EXPENSE' AND t.category_code IN (${expensePlaceholders}))
      OR (t.type = 'INCOME' AND t.category_code IN (${incomePlaceholders}))
    )`)
    params.push(...EXPENSE_FIXED_CODES, ...INCOME_FIXED_CODES)
  }
  if (keyword && typeof keyword === 'string' && keyword.trim()) {
    const trimmed = keyword.trim()
    const escaped = escapeLikePattern(trimmed)
    whereClauses.push("(t.description LIKE ? ESCAPE '\\' OR t.memo LIKE ? ESCAPE '\\')")
    const pattern = `%${escaped}%`
    params.push(pattern, pattern)
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  // 1. 総件数の取得
  const countSql = `SELECT COUNT(*) as count FROM transactions t ${whereSql}`
  const countRow = await dbAsync.get(countSql, params)
  const total = countRow ? Number(countRow.count) : 0

  // 2. ページネーションとクエリ上限 (1〜500)
  const parsedLimit = Number(limit)
  const safeLimit = Math.min(Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 100), 500)
  const parsedOffset = Number(offset)
  const safeOffset = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0)

  // 3. データ取得 (ORDER BY t.date DESC, t.id DESC)
  const dataSql = `
    SELECT 
      t.id,
      t.date,
      t.fiscal_month,
      t.amount,
      t.type,
      t.category_code,
      c.name as category_name,
      t.description,
      t.memo
    FROM transactions t
    LEFT JOIN categories c ON t.category_code = c.code
    ${whereSql}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `
  const items = (await dbAsync.all(dataSql, [...params, safeLimit, safeOffset])) || []

  return {
    total,
    count: items.length,
    items,
  }
}

/**
 * 取引IDから単一の取引明細を取得する
 * @param {import('sqlite3').Database} db
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
async function getTransaction(db, id) {
  if (id === undefined || id === null) {
    return null
  }
  const dbAsync = createDbAsync(db)
  const sql = `
    SELECT 
      t.id,
      t.date,
      t.fiscal_month,
      t.amount,
      t.type,
      t.category_code,
      c.name as category_name,
      t.description,
      t.memo
    FROM transactions t
    LEFT JOIN categories c ON t.category_code = c.code
    WHERE t.id = ?
  `
  const row = await dbAsync.get(sql, [id])
  return row || null
}

/**
 * 単一の取引明細を登録する（カテゴリ存在確認・固定費ガード・負額ガード・会計月自動計算）
 * @param {import('sqlite3').Database} db
 * @param {object} tx
 * @param {string} tx.date - 取引日 (YYYY-MM-DD)
 * @param {number} tx.amount - 金額 (0円不可、1000万円以内)
 * @param {string} tx.type - 'EXPENSE' または 'INCOME'
 * @param {number} tx.category_code - カテゴリコード
 * @param {string} tx.description - 品名・内容
 * @param {string} [tx.memo] - メモ・店舗名等
 * @returns {Promise<object>} 作成された取引明細（category_name 含む）
 */
async function insertOne(db, tx) {
  const { date, amount, type, category_code, description, memo } = tx || {}

  if (!date || !isValidDateString(date)) {
    throw new Error('有効な日付（YYYY-MM-DD）を指定してください')
  }
  if (typeof amount !== 'number' || amount === 0) {
    throw new Error('金額に0は指定できません')
  }
  if (Math.abs(amount) > 10000000) {
    throw new Error('金額は絶対値1,000万円以内で指定してください')
  }
  if (!['EXPENSE', 'INCOME'].includes(type)) {
    throw new Error('収支区分は EXPENSE または INCOME を指定してください')
  }
  if (type === 'INCOME' && amount < 0) {
    throw new Error('収入に負の金額は指定できません（割引は支出のみ対応しています）')
  }
  const parsedCatCode = Number(category_code)
  if (!parsedCatCode || parsedCatCode <= 0) {
    throw new Error('有効なカテゴリコードを指定してください')
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw new Error('品名・内容は1文字以上で指定してください')
  }

  // 固定費・給与ガード (isFixedCost)
  if (isFixedCost(parsedCatCode, type)) {
    throw new Error('固定費・給与の登録は固定入力画面を使ってください')
  }

  const dbAsync = createDbAsync(db)

  // カテゴリ存在確認
  const cat = await dbAsync.get('SELECT code, name, group_name FROM categories WHERE code = ?', [
    parsedCatCode,
  ])
  if (!cat) {
    throw new Error(`存在しない費目コードです: ${parsedCatCode}`)
  }

  const fiscal_month = getFiscalMonth(date)
  const trimmedDescription = description.trim()
  const memoValue = memo && typeof memo === 'string' && memo.trim() ? memo.trim() : null

  const sql = `
    INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  const result = await dbAsync.run(sql, [
    date,
    fiscal_month,
    amount,
    type,
    parsedCatCode,
    trimmedDescription,
    memoValue,
  ])

  return await getTransaction(db, result.lastID)
}

/**
 * 複数明細を一括登録する（直列化ミューテックス・専用独立接続・全件事前検証・dry_run対応）
 * @param {import('sqlite3').Database} db
 * @param {object} options
 * @param {string} [options.date] - 全体取引日
 * @param {string} [options.store] - 全体店舗名（memo 未指定時に適用）
 * @param {Array<object>} options.items - 明細リスト（最大200件）
 * @param {boolean} [options.dry_run=false] - ドライランフラグ
 * @returns {Promise<object>} 結果（dry_run フラグ、件数、合計金額、会計月リスト、明細一覧）
 */
async function insertBatch(db, { date, store, items, dry_run = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('明細リスト（items）は1件以上指定してください')
  }
  if (items.length > 200) {
    throw new Error('一度に登録できる明細は最大200件です')
  }

  const dbAsync = createDbAsync(db)

  // カテゴリ一覧を取得して検証用に Map 化
  const categoryRows = (await dbAsync.all('SELECT code, name, group_name FROM categories')) || []
  const categoryMap = new Map()
  for (const c of categoryRows) {
    categoryMap.set(c.code, c)
  }

  const preparedItems = []
  const errors = []

  // 全行事前検証（全行をチェックし、複数行のエラーを蓄積）
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const rowNum = i + 1
    const prefix = `[${rowNum}行目] items[${i}]`

    const itemDate = item.date ?? date
    if (!itemDate || !isValidDateString(itemDate)) {
      errors.push(`${prefix}.date: 有効な日付（YYYY-MM-DD）が指定されていません`)
    }

    if (typeof item.amount !== 'number' || item.amount === 0) {
      errors.push(`${prefix}.amount: 金額に0は指定できません`)
    } else if (Math.abs(item.amount) > 10000000) {
      errors.push(`${prefix}.amount: 金額は絶対値1,000万円以内で指定してください`)
    }

    const itemType = item.type || 'EXPENSE'
    if (!['EXPENSE', 'INCOME'].includes(itemType)) {
      errors.push(`${prefix}.type: 収支区分は EXPENSE または INCOME を指定してください`)
    } else if (itemType === 'INCOME' && typeof item.amount === 'number' && item.amount < 0) {
      errors.push(
        `${prefix}.amount: 収入に負の金額は指定できません（割引は支出のみ対応しています）`
      )
    }

    const catCode = Number(item.category_code)
    if (!catCode || !categoryMap.has(catCode)) {
      errors.push(`${prefix}.category_code: 存在しない費目コードです (${item.category_code})`)
    } else if (isFixedCost(catCode, itemType)) {
      errors.push(`${prefix}.category_code: 固定費・給与の登録は固定入力画面を使ってください`)
    }

    if (!item.description || typeof item.description !== 'string' || !item.description.trim()) {
      errors.push(`${prefix}.description: 品名・内容は1文字以上で指定してください`)
    }

    if (errors.length === 0) {
      const itemMemo =
        item.memo !== undefined && item.memo !== null && item.memo !== ''
          ? String(item.memo).trim()
          : store
            ? String(store).trim()
            : ''

      const fiscalMonth = itemDate && isValidDateString(itemDate) ? getFiscalMonth(itemDate) : null
      const cat = categoryMap.get(catCode)

      preparedItems.push({
        date: itemDate,
        fiscal_month: fiscalMonth,
        amount: item.amount,
        type: itemType,
        category_code: catCode,
        category_name: cat ? cat.name : '',
        description: item.description ? item.description.trim() : '',
        memo: itemMemo || null,
      })
    }
  }

  if (errors.length > 0) {
    throw new Error(`バッチ明細の検証エラー (${errors.length}件):\n${errors.join('\n')}`)
  }

  const count = preparedItems.length
  const total_amount = preparedItems.reduce((acc, it) => acc + it.amount, 0)
  const fiscal_months = Array.from(new Set(preparedItems.map((it) => it.fiscal_month))).sort()

  if (dry_run) {
    return {
      dry_run: true,
      count,
      total_amount,
      fiscal_months,
      items: preparedItems,
    }
  }

  // 直列化キュー (withTxLock) および独立専用接続を用いたアトミックな INSERT
  return await withTxLock(async () => {
    const { batchDb, isDedicated } = await openBatchConnection(db)
    const batchDbAsync = createDbAsync(batchDb)

    try {
      await batchDbAsync.run('BEGIN IMMEDIATE')
      try {
        const insertedItems = []
        const stmt = batchDb.prepare(
          'INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )

        try {
          for (const item of preparedItems) {
            await new Promise((resolve, reject) => {
              stmt.run(
                [
                  item.date,
                  item.fiscal_month,
                  item.amount,
                  item.type,
                  item.category_code,
                  item.description,
                  item.memo,
                ],
                function (err) {
                  if (err) return reject(err)
                  insertedItems.push({
                    id: this.lastID,
                    ...item,
                  })
                  resolve()
                }
              )
            })
          }
        } finally {
          await new Promise((resolve) => {
            stmt.finalize(() => resolve())
          })
        }

        await batchDbAsync.run('COMMIT')

        return {
          count,
          total_amount,
          fiscal_months,
          items: insertedItems,
        }
      } catch (err) {
        try {
          await batchDbAsync.run('ROLLBACK')
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

/**
 * 取引明細を更新する（固定費ガード、日付変更時の会計月再計算を含む）
 * @param {import('sqlite3').Database} db
 * @param {number|string} id - 取引ID
 * @param {object} fields - 更新フィールド
 * @returns {Promise<{ before: object, after: object }|null>}
 */
async function updateById(db, id, fields = {}) {
  if (id === undefined || id === null) {
    throw new Error('IDが指定されていません')
  }

  const allowedKeys = ['date', 'amount', 'type', 'category_code', 'description', 'memo']
  const updateKeys = allowedKeys.filter((key) => fields[key] !== undefined)
  if (updateKeys.length === 0) {
    throw new Error('更新項目が指定されていません')
  }

  const existing = await getTransaction(db, id)
  if (!existing) {
    return null
  }

  // 固定費ガード: 既存行が固定費・給与なら更新拒否
  if (isFixedCost(existing.category_code, existing.type)) {
    throw new Error('固定費・給与の明細は更新できません（固定入力画面を使ってください）')
  }

  const targetType = fields.type !== undefined ? fields.type : existing.type
  const targetCategoryCode =
    fields.category_code !== undefined ? Number(fields.category_code) : existing.category_code

  // 固定費ガード: 変更先が固定費・給与なら更新拒否
  if (fields.category_code !== undefined || fields.type !== undefined) {
    if (isFixedCost(targetCategoryCode, targetType)) {
      throw new Error('固定費・給与のカテゴリへの変更はできません（固定入力画面を使ってください）')
    }
  }

  const dbAsync = createDbAsync(db)

  // カテゴリ変更時の存在確認
  if (fields.category_code !== undefined) {
    const cat = await dbAsync.get('SELECT code, name FROM categories WHERE code = ?', [
      targetCategoryCode,
    ])
    if (!cat) {
      throw new Error(`存在しない費目コードです: ${targetCategoryCode}`)
    }
  }

  // 日付・会計月
  const targetDate = fields.date !== undefined ? fields.date : existing.date
  if (fields.date !== undefined && !isValidDateString(targetDate)) {
    throw new Error('有効な日付（YYYY-MM-DD）を指定してください')
  }
  const targetFiscalMonth =
    fields.date !== undefined ? getFiscalMonth(targetDate) : existing.fiscal_month

  // 金額
  const targetAmount = fields.amount !== undefined ? fields.amount : existing.amount
  if (targetAmount === 0) {
    throw new Error('金額に0は指定できません')
  }
  if (Math.abs(targetAmount) > 10000000) {
    throw new Error('金額は絶対値1,000万円以内で指定してください')
  }

  // 収支区分
  if (!['EXPENSE', 'INCOME'].includes(targetType)) {
    throw new Error('収支区分は EXPENSE または INCOME を指定してください')
  }
  if (targetType === 'INCOME' && targetAmount < 0) {
    throw new Error('収入に負の金額は指定できません（割引は支出のみ対応しています）')
  }

  // 品名
  const targetDescription =
    fields.description !== undefined ? fields.description : existing.description
  if (!targetDescription || typeof targetDescription !== 'string' || !targetDescription.trim()) {
    throw new Error('品名・内容は1文字以上で指定してください')
  }

  // メモ
  const targetMemo =
    fields.memo !== undefined
      ? fields.memo && String(fields.memo).trim()
        ? String(fields.memo).trim()
        : null
      : existing.memo

  const sql = `
    UPDATE transactions
    SET date = ?, fiscal_month = ?, amount = ?, type = ?, category_code = ?, description = ?, memo = ?
    WHERE id = ?
  `
  await dbAsync.run(sql, [
    targetDate,
    targetFiscalMonth,
    targetAmount,
    targetType,
    targetCategoryCode,
    targetDescription.trim(),
    targetMemo,
    id,
  ])

  const after = await getTransaction(db, id)
  return {
    before: existing,
    after,
  }
}

/**
 * 取引明細を削除する（固定費ガードを含む）
 * @param {import('sqlite3').Database} db
 * @param {number|string} id - 取引ID
 * @returns {Promise<{ deleted_transaction: object }|null>}
 */
async function deleteById(db, id) {
  if (id === undefined || id === null) {
    throw new Error('IDが指定されていません')
  }

  const existing = await getTransaction(db, id)
  if (!existing) {
    return null
  }

  // 固定費ガード
  if (isFixedCost(existing.category_code, existing.type)) {
    throw new Error('固定費・給与の明細は削除できません（固定入力画面を使ってください）')
  }

  const dbAsync = createDbAsync(db)
  await dbAsync.run('DELETE FROM transactions WHERE id = ?', [id])

  return {
    deleted_transaction: existing,
  }
}

module.exports = {
  listCategories,
  escapeLikePattern,
  listTransactions,
  getTransaction,
  insertOne,
  insertBatch,
  updateById,
  deleteById,
  withTxLock,
  openBatchConnection,
}
