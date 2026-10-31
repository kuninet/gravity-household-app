// 取引明細 1 行を返却用の形（category_name を含む）で取得する共通 SQL。
// MCP の getTransaction と fixedCostService の返却行で共有し、列構成を一致させる。
const TRANSACTION_ROW_SQL = `
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

/**
 * 取引 ID から明細 1 行を取得する
 * @param {{ get: (sql: string, params?: Array) => Promise<object|undefined> }} dbAsync - createDbAsync の戻り値（トランザクション用の専用接続でも可）
 * @param {number|string} id
 * @returns {Promise<object|null>} 明細（見つからない場合は null）
 */
async function selectTransactionRow(dbAsync, id) {
  const row = await dbAsync.get(TRANSACTION_ROW_SQL, [id])
  return row || null
}

module.exports = {
  TRANSACTION_ROW_SQL,
  selectTransactionRow,
}
