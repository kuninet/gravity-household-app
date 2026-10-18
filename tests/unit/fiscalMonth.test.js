const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isValidDateString,
  getFiscalMonth,
  getFiscalMonthRange,
  getFiscalMonthInfo,
} = require('../../server/lib/fiscalMonth')

// transactions.js 等に存在する既存の Date ベース実装
function legacyGetFiscalMonth(dateStr) {
  const date = new Date(dateStr)
  const day = date.getDate()
  let year = date.getFullYear()
  let month = date.getMonth() + 1

  if (day >= 23) {
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return `${year}-${String(month).padStart(2, '0')}`
}

test('fiscalMonth: 既存実装との完全一致テスト (30ケース以上)', () => {
  const testDates = [
    '2026-01-01',
    '2026-01-15',
    '2026-01-22',
    '2026-01-23',
    '2026-01-31',
    '2026-02-01',
    '2026-02-22',
    '2026-02-23',
    '2026-02-28',
    '2024-02-22', // うるう年
    '2024-02-23', // うるう年
    '2024-02-29', // うるう年 2/29
    '2026-03-22',
    '2026-03-23',
    '2026-04-22',
    '2026-04-23',
    '2026-05-22',
    '2026-05-23',
    '2026-06-22',
    '2026-06-23',
    '2026-07-22',
    '2026-07-23',
    '2026-08-22',
    '2026-08-23',
    '2026-09-22',
    '2026-09-23',
    '2026-10-22',
    '2026-10-23',
    '2026-11-22',
    '2026-11-23',
    '2026-12-22',
    '2026-12-23', // 年跨ぎ
    '2026-12-31', // 年跨ぎ
    '2025-12-23',
    '2025-12-31',
    '2027-01-01',
    '2027-01-22',
    '2027-01-23',
  ]

  assert.ok(testDates.length >= 30, `ケース数は30以上 (現在: ${testDates.length})`)

  for (const dateStr of testDates) {
    const actual = getFiscalMonth(dateStr)
    const expected = legacyGetFiscalMonth(dateStr)
    assert.equal(actual, expected, `Date ${dateStr} should match legacy: ${actual} === ${expected}`)
  }
})

test('fiscalMonth: 境界値テスト (22日 / 23日)', () => {
  // 10月22日 -> 2026-10
  assert.equal(getFiscalMonth('2026-10-22'), '2026-10')
  // 10月23日 -> 2026-11
  assert.equal(getFiscalMonth('2026-10-23'), '2026-11')

  // 12月22日 -> 2026-12
  assert.equal(getFiscalMonth('2026-12-22'), '2026-12')
  // 12月23日 -> 2027-01 (年跨ぎ)
  assert.equal(getFiscalMonth('2026-12-23'), '2027-01')
  assert.equal(getFiscalMonth('2026-12-31'), '2027-01')

  // 1月22日 -> 2027-01
  assert.equal(getFiscalMonth('2027-01-22'), '2027-01')
  // 1月23日 -> 2027-02
  assert.equal(getFiscalMonth('2027-01-23'), '2027-02')
})

test('fiscalMonth: うるう年の判定と会計月', () => {
  // 2024年はうるう年
  assert.equal(isValidDateString('2024-02-29'), true)
  assert.equal(getFiscalMonth('2024-02-29'), '2024-03')

  // 2025年は平年 (2/29は存在しない)
  assert.equal(isValidDateString('2025-02-29'), false)
  assert.throws(() => getFiscalMonth('2025-02-29'), /無効な日付です/)

  // 2000年はうるう年 (400で割り切れる)
  assert.equal(isValidDateString('2000-02-29'), true)
  // 2100年は平年 (100で割り切れるが400で割り切れない)
  assert.equal(isValidDateString('2100-02-29'), false)
})

test('fiscalMonth: 不正な日付形式や存在しない日のバリデーション', () => {
  assert.equal(isValidDateString('2026-02-30'), false)
  assert.equal(isValidDateString('2026-04-31'), false)
  assert.equal(isValidDateString('2026-13-01'), false)
  assert.equal(isValidDateString('2026-00-10'), false)
  assert.equal(isValidDateString('2026-05-00'), false)
  assert.equal(isValidDateString('2026-05-32'), false)
  assert.equal(isValidDateString('2026/10/23'), false)
  assert.equal(isValidDateString('invalid'), false)
  assert.equal(isValidDateString(null), false)
  assert.equal(isValidDateString(undefined), false)

  assert.throws(() => getFiscalMonth('2026-02-30'), /無効な日付です/)
  assert.throws(() => getFiscalMonth('2026-04-31'), /無効な日付です/)
  assert.throws(() => getFiscalMonth('2026/10/23'), /無効な日付です/)
})

test('getFiscalMonthRange: 会計月の期間計算', () => {
  // 通常月: 2026-11 -> 2026-10-23 〜 2026-11-22
  assert.deepEqual(getFiscalMonthRange('2026-11'), {
    start: '2026-10-23',
    end: '2026-11-22',
  })

  // 年跨ぎ: 2027-01 -> 2026-12-23 〜 2027-01-22
  assert.deepEqual(getFiscalMonthRange('2027-01'), {
    start: '2026-12-23',
    end: '2027-01-22',
  })

  // 不正な形式
  assert.throws(() => getFiscalMonthRange('2026-13'), /無効な会計月形式/)
  assert.throws(() => getFiscalMonthRange('2026-0'), /無効な会計月形式/)
  assert.throws(() => getFiscalMonthRange('2026/11'), /無効な会計月形式/)
})

test('getFiscalMonthInfo: 純関数としての結果整合性 (B7 シナリオ)', () => {
  const res1 = getFiscalMonthInfo('2026-10-23')
  assert.equal(res1.fiscal_month, '2026-11')
  assert.deepEqual(res1.range, { start: '2026-10-23', end: '2026-11-22' })
  assert.equal(res1.date, '2026-10-23')

  const res2 = getFiscalMonthInfo('2026-12-23')
  assert.equal(res2.fiscal_month, '2027-01')
  assert.deepEqual(res2.range, { start: '2026-12-23', end: '2027-01-22' })

  const res3 = getFiscalMonthInfo('2026-10-22')
  assert.equal(res3.fiscal_month, '2026-10')
  assert.deepEqual(res3.range, { start: '2026-09-23', end: '2026-10-22' })

  assert.throws(() => getFiscalMonthInfo('2026-02-30'), /無効な日付です/)
})
