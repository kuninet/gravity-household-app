/**
 * 会計月関連の計算ユーティリティ
 * 家計簿の会計月は「毎月23日から翌月22日まで」
 */

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function getDaysInMonth(year, month) {
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return daysInMonth[month - 1]
}

/**
 * YYYY-MM-DD 形式かつカレンダー上実在する日付か検証する
 */
function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false

  const [yStr, mStr, dStr] = dateStr.split('-')
  const year = parseInt(yStr, 10)
  const month = parseInt(mStr, 10)
  const day = parseInt(dStr, 10)

  if (month < 1 || month > 12) return false
  const maxDays = getDaysInMonth(year, month)
  if (day < 1 || day > maxDays) return false

  return true
}

/**
 * 文字列ベースの堅牢な getFiscalMonth 実装
 * 23日以降は翌月、12月23日以降は翌年1月
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {string} 'YYYY-MM'
 */
function getFiscalMonth(dateStr) {
  if (!isValidDateString(dateStr)) {
    throw new Error(`無効な日付です: "${dateStr}" (YYYY-MM-DD かつ実在日である必要があります)`)
  }

  const [yStr, mStr, dStr] = dateStr.split('-')
  let year = parseInt(yStr, 10)
  let month = parseInt(mStr, 10)
  const day = parseInt(dStr, 10)

  if (day >= 23) {
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }

  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * 会計月 (YYYY-MM) から実際の期間 (前月23日 - 当月22日) を返す
 * @param {string} fiscalMonth - 'YYYY-MM'
 * @returns {{ start: string, end: string }}
 */
function getFiscalMonthRange(fiscalMonth) {
  if (typeof fiscalMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(fiscalMonth)) {
    throw new Error(`無効な会計月形式です: "${fiscalMonth}" (YYYY-MM である必要があります)`)
  }

  const [yStr, mStr] = fiscalMonth.split('-')
  const year = parseInt(yStr, 10)
  const month = parseInt(mStr, 10)

  let prevYear = year
  let prevMonth = month - 1
  if (prevMonth < 1) {
    prevMonth = 12
    prevYear--
  }

  return {
    start: `${prevYear}-${String(prevMonth).padStart(2, '0')}-23`,
    end: `${year}-${String(month).padStart(2, '0')}-22`,
  }
}

/**
 * 日付から会計月および範囲情報を取得する純関数
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {{ date: string, fiscal_month: string, range: { start: string, end: string } }}
 */
function getFiscalMonthInfo(dateStr) {
  const fiscal_month = getFiscalMonth(dateStr)
  const range = getFiscalMonthRange(fiscal_month)
  return {
    date: dateStr,
    fiscal_month,
    range,
  }
}

module.exports = {
  isValidDateString,
  getFiscalMonth,
  getFiscalMonthRange,
  getFiscalMonthInfo,
}
