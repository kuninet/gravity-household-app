const { getFiscalMonth } = require('../lib/fiscalMonth')
const { createDbAsync } = require('../lib/dbAsync')

function getCurrentFiscalMonth() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return getFiscalMonth(`${y}-${m}-${d}`)
}

function getPreviousMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  let prevY = y
  let prevM = m - 1
  if (prevM < 1) {
    prevM = 12
    prevY--
  }
  return `${prevY}-${String(prevM).padStart(2, '0')}`
}

/**
 * 指定会計月（未指定時は現在会計月）のサマリを取得する
 * @param {import('sqlite3').Database} db
 * @param {string} [fiscalMonth] - 会計月 (YYYY-MM)
 * @returns {Promise<{month: string, prev_month: string, by_category: Array, comparison: Array, total: {income: number, expense: number, balance: number}}>}
 */
async function getMonthSummary(db, fiscalMonth) {
  const targetMonth = fiscalMonth || getCurrentFiscalMonth()
  const prevMonth = getPreviousMonth(targetMonth)
  const dbAsync = createDbAsync(db)

  const categorySql = `
        SELECT 
            t.fiscal_month,
            c.group_name, 
            SUM(t.amount) as total 
        FROM transactions t
        JOIN categories c ON t.category_code = c.code
        WHERE t.fiscal_month IN (?, ?) AND t.type = 'EXPENSE'
        GROUP BY t.fiscal_month, c.group_name
        ORDER BY total DESC
    `

  const rows = (await dbAsync.all(categorySql, [targetMonth, prevMonth])) || []

  // Process Comparison Data
  const currentData = rows.filter((r) => r.fiscal_month === targetMonth)
  const prevData = rows.filter((r) => r.fiscal_month === prevMonth)

  // Merge logic
  const comparisonMap = new Map()

  currentData.forEach((r) => {
    comparisonMap.set(r.group_name, { group: r.group_name, current: r.total, prev: 0 })
  })
  prevData.forEach((r) => {
    if (!comparisonMap.has(r.group_name)) {
      comparisonMap.set(r.group_name, { group: r.group_name, current: 0, prev: r.total })
    } else {
      comparisonMap.get(r.group_name).prev = r.total
    }
  })

  const comparison = Array.from(comparisonMap.values()).map((item) => ({
    ...item,
    diff: item.current - item.prev,
  }))

  const summarySql = `
        SELECT 
            type, 
            SUM(amount) as total 
        FROM transactions 
        WHERE fiscal_month = ? 
        GROUP BY type
    `

  const summaryRows = (await dbAsync.all(summarySql, [targetMonth])) || []

  const income = summaryRows.find((r) => r.type === 'INCOME')?.total || 0
  const expense = summaryRows.find((r) => r.type === 'EXPENSE')?.total || 0

  return {
    month: targetMonth,
    prev_month: prevMonth,
    by_category: currentData,
    comparison: comparison,
    total: {
      income,
      expense,
      balance: income - expense,
    },
  }
}

module.exports = {
  getMonthSummary,
  getPreviousMonth,
  getCurrentFiscalMonth,
}
