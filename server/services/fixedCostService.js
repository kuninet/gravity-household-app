const { EXPENSE_FIXED_CODES, INCOME_FIXED_CODES } = require('../lib/fixedCostCodes')
const { createDbAsync } = require('../lib/dbAsync')

/**
 * 固定費・固定収入（給与）の一覧（マトリクス元データ）を取得する
 * @param {import('sqlite3').Database} db
 * @param {object|string|number} options - { year } または year 文字列/数値
 * @returns {Promise<{data: Array<{id: number, fiscal_month: string, category_code: number, amount: number, description: string, type: string}>}>}
 */
async function getFixedCostMatrix(db, options) {
  const year = typeof options === 'object' && options !== null ? options.year : options

  if (!year) {
    const err = new Error('Year is required')
    err.statusCode = 400
    throw err
  }

  const pattern = `${year}-%`
  const expensePlaceholder = EXPENSE_FIXED_CODES.map(() => '?').join(',')
  const incomePlaceholder = INCOME_FIXED_CODES.map(() => '?').join(',')

  const sql = `
        SELECT id, fiscal_month, category_code, amount, description, type
        FROM transactions
        WHERE fiscal_month LIKE ?
          AND (
            (type = 'EXPENSE' AND category_code IN (${expensePlaceholder}))
            OR (type = 'INCOME' AND category_code IN (${incomePlaceholder}))
          )
    `

  const dbAsync = createDbAsync(db)
  const rows =
    (await dbAsync.all(sql, [pattern, ...EXPENSE_FIXED_CODES, ...INCOME_FIXED_CODES])) || []

  return { data: rows }
}

module.exports = {
  getFixedCostMatrix,
}
