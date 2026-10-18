const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')
const fs = require('fs')

// テスト用の一時 DB パスを設定
const tempDbPath = path.join(
  os.tmpdir(),
  `service-golden-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
)
process.env.DB_PATH = tempDbPath

const db = require('../../server/db')
const app = require('../../server/app')
const { startServer, SEED_CATEGORIES } = require('./mcp-helpers')
const {
  EXPENSE_FIXED_CODES,
  INCOME_FIXED_CODES,
  SALARY_CATEGORY_CODE,
  isFixedExpense,
  isFixedIncome,
  isSalary,
  isFixedCost,
} = require('../../server/lib/fixedCostCodes')
const { getMonthSummary, getCurrentFiscalMonth } = require('../../server/services/summaryService')
const { getPriceTrends } = require('../../server/services/priceTrendService')
const { getFixedCostMatrix } = require('../../server/services/fixedCostService')

let serverInstance
let baseUrl

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err)
      resolve(this)
    })
  })
}

test.before(async () => {
  const s = await startServer(app)
  serverInstance = s
  baseUrl = s.baseUrl

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO categories (code, name, group_name) VALUES (?, ?, ?)'
  )
  for (const cat of SEED_CATEGORIES) {
    stmt.run(cat.code, cat.name, cat.group)
  }
  await new Promise((resolve) => stmt.finalize(resolve))
})

test.after(async () => {
  if (serverInstance) {
    await serverInstance.close()
  }
  await new Promise((resolve) => {
    db.close(() => {
      try {
        if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath)
        const wal = `${tempDbPath}-wal`
        const shm = `${tempDbPath}-shm`
        if (fs.existsSync(wal)) fs.unlinkSync(wal)
        if (fs.existsSync(shm)) fs.unlinkSync(shm)
      } catch {
        // ignore
      }
      resolve()
    })
  })
})

// -------------------------------------------------------------------------
// 1. fixedCostCodes の検証
// -------------------------------------------------------------------------
test('fixedCostCodes: 定数とヘルパー関数の検証', () => {
  assert.ok(Array.isArray(EXPENSE_FIXED_CODES))
  assert.ok(EXPENSE_FIXED_CODES.includes(604))
  assert.deepEqual(INCOME_FIXED_CODES, [700])
  assert.equal(SALARY_CATEGORY_CODE, 700)

  // isFixedExpense
  assert.equal(isFixedExpense(604), true)
  assert.equal(isFixedExpense('604'), true)
  assert.equal(isFixedExpense(100), false)
  assert.equal(isFixedExpense(null), false)

  // isFixedIncome
  assert.equal(isFixedIncome(700), true)
  assert.equal(isFixedIncome('700'), true)
  assert.equal(isFixedIncome(604), false)

  // isSalary
  assert.equal(isSalary(700), true)
  assert.equal(isSalary('700'), true)
  assert.equal(isSalary(604), false)

  // isFixedCost
  assert.equal(isFixedCost(604, 'EXPENSE'), true)
  assert.equal(isFixedCost(700, 'INCOME'), true)
  assert.equal(isFixedCost(700, 'EXPENSE'), false)
  assert.equal(isFixedCost(604), true)
  assert.equal(isFixedCost(700), true)
  assert.equal(isFixedCost(100), false)
})

// -------------------------------------------------------------------------
// 2. summaryService: month 未指定時の正常動作 (P0)
// -------------------------------------------------------------------------
test('summaryService: month 未指定時（デフォルト当月）に 200 が返り正常動作すること (P0)', async () => {
  const currentFiscalMonth = getCurrentFiscalMonth()

  // API 呼び出し (month パラメータなし)
  const apiRes = await fetch(`${baseUrl}/api/summary`)
  assert.equal(apiRes.status, 200)
  const apiJson = await apiRes.json()
  assert.equal(apiJson.month, currentFiscalMonth)

  // サービス関数呼び出し (fiscalMonth パラメータ省略)
  const serviceResult = await getMonthSummary(db)
  assert.equal(serviceResult.month, currentFiscalMonth)
  assert.deepStrictEqual(serviceResult, apiJson)
})

// -------------------------------------------------------------------------
// 3. summaryService vs 固定期待値スナップショット (Golden Test - P1)
// -------------------------------------------------------------------------
test('summaryService: 固定期待値スナップショットとの厳格な完全一致 (Golden Test - P1)', async () => {
  await runSql(`DELETE FROM transactions`)

  const testTxList = [
    // 2026-10 (当月)
    {
      date: '2026-10-01',
      fiscal_month: '2026-10',
      amount: 3000,
      type: 'EXPENSE',
      category_code: 100, // 食費
      description: '食材',
    },
    {
      date: '2026-10-05',
      fiscal_month: '2026-10',
      amount: 2000,
      type: 'EXPENSE',
      category_code: 103, // 外食費 (グループ: 食費)
      description: 'ランチ',
    },
    {
      date: '2026-10-01',
      fiscal_month: '2026-10',
      amount: 80000,
      type: 'EXPENSE',
      category_code: 604, // 家賃 (グループ: 固定費)
      description: '10月家賃',
    },
    {
      date: '2026-10-02',
      fiscal_month: '2026-10',
      amount: 5000,
      type: 'EXPENSE',
      category_code: 601, // 電気 (グループ: 固定費)
      description: '電気代',
    },
    // マイナス割引明細 (食費)
    {
      date: '2026-10-03',
      fiscal_month: '2026-10',
      amount: -500,
      type: 'EXPENSE',
      category_code: 100,
      description: 'クーポン割引',
    },
    // 収入
    {
      date: '2026-09-25',
      fiscal_month: '2026-10',
      amount: 300000,
      type: 'INCOME',
      category_code: 700,
      description: '給与(固定入力)',
    },

    // 2026-09 (前月)
    {
      date: '2026-09-01',
      fiscal_month: '2026-09',
      amount: 4000,
      type: 'EXPENSE',
      category_code: 100,
      description: '食材',
    },
    {
      date: '2026-09-01',
      fiscal_month: '2026-09',
      amount: 80000,
      type: 'EXPENSE',
      category_code: 604,
      description: '9月家賃',
    },
    {
      date: '2026-09-02',
      fiscal_month: '2026-09',
      amount: 4500,
      type: 'EXPENSE',
      category_code: 601,
      description: '電気代',
    },
    // 前月のみ存在するカテゴリ（交際費）
    {
      date: '2026-09-10',
      fiscal_month: '2026-09',
      amount: 1800,
      type: 'EXPENSE',
      category_code: 401, // 映画 (グループ: 交際費)
      description: '映画鑑賞',
    },
    {
      date: '2026-08-25',
      fiscal_month: '2026-09',
      amount: 300000,
      type: 'INCOME',
      category_code: 700,
      description: '給与(固定入力)',
    },
  ]

  for (const tx of testTxList) {
    await runSql(
      `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tx.date, tx.fiscal_month, tx.amount, tx.type, tx.category_code, tx.description]
    )
  }

  // 真の固定期待値（スナップショット）
  // 食費: 当月 (3000 + 2000 - 500) = 4500, 前月 4000 -> diff: +500
  // 固定費: 当月 (80000 + 5000) = 85000, 前月 (80000 + 4500) = 84500 -> diff: +500
  // 交際費: 当月 0, 前月 1800 -> diff: -1800
  const expectedSnapshot = {
    month: '2026-10',
    prev_month: '2026-09',
    by_category: [
      { fiscal_month: '2026-10', group_name: '固定費', total: 85000 },
      { fiscal_month: '2026-10', group_name: '食費', total: 4500 },
    ],
    comparison: [
      { group: '固定費', current: 85000, prev: 84500, diff: 500 },
      { group: '食費', current: 4500, prev: 4000, diff: 500 },
      { group: '交際費', current: 0, prev: 1800, diff: -1800 },
    ],
    total: {
      income: 300000,
      expense: 89500,
      balance: 210500,
    },
  }

  // 1. サービス関数の結果を固定期待値と比較
  const serviceResult = await getMonthSummary(db, '2026-10')
  assert.deepStrictEqual(serviceResult, expectedSnapshot)

  // 2. REST API の結果を固定期待値と比較
  const apiRes = await fetch(`${baseUrl}/api/summary?month=2026-10`)
  assert.equal(apiRes.status, 200)
  const apiJson = await apiRes.json()
  assert.deepStrictEqual(apiJson, expectedSnapshot)
})

test('summaryService: 対象月データが空の場合の固定期待値 Golden Test', async () => {
  const expectedEmptySnapshot = {
    month: '2026-05',
    prev_month: '2026-04',
    by_category: [],
    comparison: [],
    total: {
      income: 0,
      expense: 0,
      balance: 0,
    },
  }

  const serviceResult = await getMonthSummary(db, '2026-05')
  assert.deepStrictEqual(serviceResult, expectedEmptySnapshot)

  const apiRes = await fetch(`${baseUrl}/api/summary?month=2026-05`)
  assert.equal(apiRes.status, 200)
  const apiJson = await apiRes.json()
  assert.deepStrictEqual(apiJson, expectedEmptySnapshot)
})

// -------------------------------------------------------------------------
// 4. priceTrendService vs 固定期待値スナップショット (Golden Test - P1)
// -------------------------------------------------------------------------
test('priceTrendService: 固定期待値スナップショットとの厳格な完全一致 (Golden Test - P1)', async () => {
  await runSql(`DELETE FROM transactions`)

  const testTxList = [
    {
      id: 1,
      date: '2026-01-10',
      fiscal_month: '2026-02',
      amount: 200,
      type: 'EXPENSE',
      category_code: 100,
      description: '国産たまご 10個入',
      memo: 'スーパーA',
    },
    {
      id: 2,
      date: '2026-01-20',
      fiscal_month: '2026-02',
      amount: 220,
      type: 'EXPENSE',
      category_code: 100,
      description: '国産たまご 10個入',
      memo: 'スーパーB',
    },
    {
      id: 3,
      date: '2026-02-05',
      fiscal_month: '2026-03',
      amount: 150,
      type: 'EXPENSE',
      category_code: 100,
      description: '温泉たまご',
      memo: 'コンビニ',
    },
    // マイナス割引明細 -> 集計から除外されること
    {
      id: 4,
      date: '2026-02-15',
      fiscal_month: '2026-03',
      amount: -50,
      type: 'EXPENSE',
      category_code: 100,
      description: 'たまご値引き',
      memo: 'クーポン',
    },
    // 別品目
    {
      id: 5,
      date: '2026-02-10',
      fiscal_month: '2026-03',
      amount: 180,
      type: 'EXPENSE',
      category_code: 100,
      description: '牛乳 1L',
      memo: 'スーパーA',
    },
  ]

  for (const tx of testTxList) {
    await runSql(
      `INSERT INTO transactions (id, date, fiscal_month, amount, type, category_code, description, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tx.id,
        tx.date,
        tx.fiscal_month,
        tx.amount,
        tx.type,
        tx.category_code,
        tx.description,
        tx.memo,
      ]
    )
  }

  const expectedSnapshot = {
    keyword: 'たまご',
    jev_configured: false,
    mode_used: 'simple',
    summary: {
      count: 3,
      average_price: 190, // round((200 + 220 + 150) / 3) = 190
      min_price: 150,
      max_price: 220,
      latest_price: 150,
      latest_date: '2026-02-05',
      price_diff: -70, // 150 - 220
    },
    matched_items: [
      {
        name: '国産たまご 10個入',
        count: 2,
        confidence: 100,
        source: 'fallback',
      },
      {
        name: '温泉たまご',
        count: 1,
        confidence: 100,
        source: 'fallback',
      },
    ],
    data: [
      {
        id: 1,
        date: '2026-01-10',
        fiscal_month: '2026-02',
        amount: 200,
        description: '国産たまご 10個入',
        memo: 'スーパーA',
        category_code: 100,
        category_name: '食費',
      },
      {
        id: 2,
        date: '2026-01-20',
        fiscal_month: '2026-02',
        amount: 220,
        description: '国産たまご 10個入',
        memo: 'スーパーB',
        category_code: 100,
        category_name: '食費',
      },
      {
        id: 3,
        date: '2026-02-05',
        fiscal_month: '2026-03',
        amount: 150,
        description: '温泉たまご',
        memo: 'コンビニ',
        category_code: 100,
        category_name: '食費',
      },
    ],
  }

  // 1. 通常検索 (mode=simple)
  const serviceRes1 = await getPriceTrends(db, { keyword: 'たまご', mode: 'simple' })
  assert.deepStrictEqual(serviceRes1, expectedSnapshot)

  const apiRes1 = await fetch(`${baseUrl}/api/price_trend?keyword=たまご&mode=simple`)
  assert.equal(apiRes1.status, 200)
  const apiJson1 = await apiRes1.json()
  assert.deepStrictEqual(apiJson1, expectedSnapshot)

  // 2. 期間絞り込み (from / to)
  const serviceRes2 = await getPriceTrends(db, {
    keyword: 'たまご',
    mode: 'simple',
    from: '2026-01-01',
    to: '2026-01-15',
  })
  assert.equal(serviceRes2.summary.count, 1)
  assert.equal(serviceRes2.data[0].id, 1)

  // 3. selected_items 絞り込み
  const serviceRes3 = await getPriceTrends(db, {
    keyword: 'たまご',
    mode: 'simple',
    selected_items: '温泉たまご',
  })
  assert.equal(serviceRes3.summary.count, 1)
  assert.equal(serviceRes3.data[0].id, 3)

  // 4. 一致なし (0件)
  const expectedEmptyTrend = {
    keyword: '存在しない品名',
    jev_configured: false,
    mode_used: 'simple',
    summary: {
      count: 0,
      average_price: 0,
      min_price: 0,
      max_price: 0,
      latest_price: null,
      latest_date: null,
      price_diff: null,
    },
    matched_items: [],
    data: [],
  }
  const serviceRes4 = await getPriceTrends(db, {
    keyword: '存在しない品名',
    mode: 'simple',
  })
  assert.deepStrictEqual(serviceRes4, expectedEmptyTrend)
})

test('priceTrendService: バリデーションエラーの Golden Test', async () => {
  const apiRes1 = await fetch(`${baseUrl}/api/price_trend`)
  assert.equal(apiRes1.status, 400)
  const apiJson1 = await apiRes1.json()
  assert.deepEqual(apiJson1, { error: 'キーワード（keyword）を指定してください。' })

  await assert.rejects(
    async () => {
      await getPriceTrends(db, {})
    },
    (err) => {
      assert.equal(err.statusCode, 400)
      assert.equal(err.message, 'キーワード（keyword）を指定してください。')
      return true
    }
  )

  const apiRes2 = await fetch(`${baseUrl}/api/price_trend?keyword=たまご&from=invalid-date`)
  assert.equal(apiRes2.status, 400)
  const apiJson2 = await apiRes2.json()
  assert.deepEqual(apiJson2, { error: 'from は YYYY-MM-DD 形式で指定してください。' })

  await assert.rejects(
    async () => {
      await getPriceTrends(db, { keyword: 'たまご', from: 'invalid-date' })
    },
    (err) => {
      assert.equal(err.statusCode, 400)
      assert.equal(err.message, 'from は YYYY-MM-DD 形式で指定してください。')
      return true
    }
  )
})

// -------------------------------------------------------------------------
// 5. fixedCostService vs 固定期待値スナップショット (Golden Test - P1)
// -------------------------------------------------------------------------
test('fixedCostService: 固定期待値スナップショットとの厳格な完全一致 (Golden Test - P1)', async () => {
  await runSql(`DELETE FROM transactions`)

  const testTxList = [
    // 2026-01
    {
      id: 1,
      date: '2026-01-01',
      fiscal_month: '2026-01',
      amount: 80000,
      type: 'EXPENSE',
      category_code: 604,
      description: '固定費入力',
    },
    {
      id: 2,
      date: '2026-01-01',
      fiscal_month: '2026-01',
      amount: 6000,
      type: 'EXPENSE',
      category_code: 601,
      description: '固定費入力',
    },
    // 複数給与明細 (同一月 2026-01 に 2 件)
    {
      id: 3,
      date: '2025-12-25',
      fiscal_month: '2026-01',
      amount: 280000,
      type: 'INCOME',
      category_code: 700,
      description: '本業給与',
    },
    {
      id: 4,
      date: '2025-12-25',
      fiscal_month: '2026-01',
      amount: 50000,
      type: 'INCOME',
      category_code: 700,
      description: '副業給与',
    },

    // 2026-02
    {
      id: 5,
      date: '2026-02-01',
      fiscal_month: '2026-02',
      amount: 80000,
      type: 'EXPENSE',
      category_code: 604,
      description: '固定費入力',
    },
    {
      id: 6,
      date: '2026-02-01',
      fiscal_month: '2026-02',
      amount: 7000,
      type: 'EXPENSE',
      category_code: 601,
      description: '固定費入力',
    },
    {
      id: 7,
      date: '2026-01-25',
      fiscal_month: '2026-02',
      amount: 280000,
      type: 'INCOME',
      category_code: 700,
      description: '給与(固定入力)',
    },
  ]

  for (const tx of testTxList) {
    await runSql(
      `INSERT INTO transactions (id, date, fiscal_month, amount, type, category_code, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tx.id, tx.date, tx.fiscal_month, tx.amount, tx.type, tx.category_code, tx.description]
    )
  }

  const expectedMatrixSnapshot = {
    data: [
      {
        id: 1,
        fiscal_month: '2026-01',
        category_code: 604,
        amount: 80000,
        description: '固定費入力',
        type: 'EXPENSE',
      },
      {
        id: 2,
        fiscal_month: '2026-01',
        category_code: 601,
        amount: 6000,
        description: '固定費入力',
        type: 'EXPENSE',
      },
      {
        id: 3,
        fiscal_month: '2026-01',
        category_code: 700,
        amount: 280000,
        description: '本業給与',
        type: 'INCOME',
      },
      {
        id: 4,
        fiscal_month: '2026-01',
        category_code: 700,
        amount: 50000,
        description: '副業給与',
        type: 'INCOME',
      },
      {
        id: 5,
        fiscal_month: '2026-02',
        category_code: 604,
        amount: 80000,
        description: '固定費入力',
        type: 'EXPENSE',
      },
      {
        id: 6,
        fiscal_month: '2026-02',
        category_code: 601,
        amount: 7000,
        description: '固定費入力',
        type: 'EXPENSE',
      },
      {
        id: 7,
        fiscal_month: '2026-02',
        category_code: 700,
        amount: 280000,
        description: '給与(固定入力)',
        type: 'INCOME',
      },
    ],
  }

  // 1. サービス関数の結果を固定期待値と比較
  const serviceResult = await getFixedCostMatrix(db, { year: '2026' })
  assert.deepStrictEqual(serviceResult, expectedMatrixSnapshot)

  // 2. REST API (GET /api/fixed_costs/matrix?year=2026) の結果を固定期待値と比較
  const apiRes = await fetch(`${baseUrl}/api/fixed_costs/matrix?year=2026`)
  assert.equal(apiRes.status, 200)
  const apiJson = await apiRes.json()
  assert.deepStrictEqual(apiJson, expectedMatrixSnapshot)
})

test('fixedCostService: 対象年が空の場合とバリデーションエラーの Golden Test', async () => {
  const expectedEmptySnapshot = { data: [] }

  const serviceEmpty = await getFixedCostMatrix(db, { year: '2020' })
  assert.deepStrictEqual(serviceEmpty, expectedEmptySnapshot)

  const apiResEmpty = await fetch(`${baseUrl}/api/fixed_costs/matrix?year=2020`)
  assert.equal(apiResEmpty.status, 200)
  const apiJsonEmpty = await apiResEmpty.json()
  assert.deepStrictEqual(apiJsonEmpty, expectedEmptySnapshot)

  // year 未指定 (400)
  const apiRes400 = await fetch(`${baseUrl}/api/fixed_costs/matrix`)
  assert.equal(apiRes400.status, 400)
  const apiJson400 = await apiRes400.json()
  assert.deepEqual(apiJson400, { error: 'Year is required' })

  await assert.rejects(
    async () => {
      await getFixedCostMatrix(db, {})
    },
    (err) => {
      assert.equal(err.statusCode, 400)
      assert.equal(err.message, 'Year is required')
      return true
    }
  )
})
