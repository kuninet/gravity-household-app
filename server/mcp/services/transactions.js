const { createDbAsync } = require('../../lib/dbAsync')
const { isFixedCost, EXPENSE_FIXED_CODES, INCOME_FIXED_CODES } = require('../../lib/fixedCostCodes')

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

module.exports = {
  listCategories,
  escapeLikePattern,
  listTransactions,
  getTransaction,
}
