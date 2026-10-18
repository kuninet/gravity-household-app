const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const serverNodeModules = path.resolve(__dirname, '../../server/node_modules')
if (!module.paths.includes(serverNodeModules)) {
  module.paths.push(serverNodeModules)
}

const { express, startServer, createTempDb, createMcpClient } = require('./mcp-helpers')
const { createMcpRouter } = require('../../server/mcp')
const summaryService = require('../../server/services/summaryService')
const fixedCostService = require('../../server/services/fixedCostService')
const priceTrendService = require('../../server/services/priceTrendService')
const { createDbAsync } = require('../../server/lib/dbAsync')

const TEST_TOKEN = 'test-mcp-valid-token-32-characters-long!'

/**
 * テスト用ヘルパー: 一時DBとMCPクライアントおよび比較用REST APIを立ち上げる
 */
async function setupTestEnvironment() {
  process.env.MCP_AUTH_TOKEN = TEST_TOKEN

  const { db, cleanup } = await createTempDb()
  const dbAsync = createDbAsync(db)

  const testApp = express()
  // MCP ルーター
  testApp.use('/mcp', createMcpRouter(db))

  // 比較検証用 REST API
  testApp.get('/api/summary', async (req, res) => {
    try {
      const summary = await summaryService.getMonthSummary(db, req.query.month)
      res.json(summary)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  testApp.get('/api/price_trend', async (req, res) => {
    try {
      const result = await priceTrendService.getPriceTrends(db, req.query)
      res.json(result)
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message })
      }
      res.status(500).json({ error: err.message })
    }
  })

  const { baseUrl, close: closeServer } = await startServer(testApp)
  const { client, clientTransport } = await createMcpClient({
    baseUrl,
    token: TEST_TOKEN,
  })

  return {
    db,
    dbAsync,
    baseUrl,
    client,
    teardown: async () => {
      try {
        await client.close()
      } catch {
        // ignore
      }
      try {
        await clientTransport.close()
      } catch {
        // ignore
      }
      await closeServer()
      await cleanup()
    },
  }
}

// tools/list で 7 つのツールと readOnlyHint: true が返ることを検証
test('P1-1: tools/list で 7 つの参照系ツールが登録され、すべて readOnlyHint: true を持つ', async () => {
  const env = await setupTestEnvironment()
  try {
    const list = await env.client.listTools()
    assert.ok(Array.isArray(list.tools))

    const expectedToolNames = [
      'get_categories',
      'get_transactions',
      'get_transaction',
      'get_summary',
      'get_fixed_costs',
      'get_price_trends',
      'get_fiscal_month',
    ]

    const actualToolNames = list.tools.map((t) => t.name)
    for (const expected of expectedToolNames) {
      assert.ok(actualToolNames.includes(expected), `Tool ${expected} should be listed`)
    }

    const readTools = list.tools.filter((t) => expectedToolNames.includes(t.name))
    assert.equal(readTools.length, 7)
    for (const tool of readTools) {
      assert.ok(tool.annotations, `Tool ${tool.name} should have annotations`)
      assert.equal(
        tool.annotations.readOnlyHint,
        true,
        `Tool ${tool.name} should have readOnlyHint: true`
      )
    }
  } finally {
    await env.teardown()
  }
})

// B1: get_categories で固定費（604等）や給与（700）に fixed: true が付き、食費（100等）に fixed: false が付くこと。id列は削除されていること。
test('B1: get_categories で固定費・給与に fixed: true、食費に fixed: false が付与され、id列は存在しない', async () => {
  const env = await setupTestEnvironment()
  try {
    const res = await env.client.callTool({
      name: 'get_categories',
      arguments: {},
    })

    assert.ok(!res.isError, 'isError should be false')
    assert.ok(res.content && res.content.length > 0)
    const categories = JSON.parse(res.content[0].text)

    assert.ok(Array.isArray(categories))
    assert.ok(categories.length >= 20, 'Should return all seed categories')

    // 各要素のプロパティ検証（id列は除外）
    for (const cat of categories) {
      assert.equal('id' in cat, false, 'id column should NOT be present')
      assert.ok('code' in cat, 'Should have code')
      assert.ok('name' in cat, 'Should have name')
      assert.ok('group_name' in cat, 'Should have group_name')
      assert.ok(typeof cat.fixed === 'boolean', 'fixed should be boolean')
    }

    // 家賃 (604) -> fixed: true
    const rent = categories.find((c) => c.code === 604)
    assert.ok(rent, 'Rent category should exist')
    assert.equal(rent.fixed, true, '604 rent should be fixed')

    // 給与 (700) -> fixed: true
    const salary = categories.find((c) => c.code === 700)
    assert.ok(salary, 'Salary category should exist')
    assert.equal(salary.fixed, true, '700 salary should be fixed')

    // 食費 (100) -> fixed: false
    const food = categories.find((c) => c.code === 100)
    assert.ok(food, 'Food category should exist')
    assert.equal(food.fixed, false, '100 food should not be fixed')

    // structuredContent の検証
    assert.ok(res.structuredContent, 'Should have structuredContent')
    assert.deepStrictEqual(res.structuredContent.categories, categories)
  } finally {
    await env.teardown()
  }
})

// B2: get_transactions で fiscal_month 絞り込み、date DESC, id DESC ソート、category_name が付与されること
test('B2: get_transactions で fiscal_month 絞り込みと date DESC, id DESC ソート、category_name 付与が機能する', async () => {
  const env = await setupTestEnvironment()
  try {
    // テストデータ投入
    await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo)
      VALUES 
        ('2026-03-05', '2026-03', 1000, 'EXPENSE', 100, '品目A', 'メモA'),
        ('2026-03-15', '2026-03', 2000, 'EXPENSE', 100, '品目B', 'メモB'),
        ('2026-03-15', '2026-03', 3000, 'EXPENSE', 103, '品目C', 'メモC'),
        ('2026-04-01', '2026-04', 4000, 'EXPENSE', 100, '品目D', 'メモD')
    `)

    const res = await env.client.callTool({
      name: 'get_transactions',
      arguments: { fiscal_month: '2026-03' },
    })

    assert.ok(!res.isError)
    const result = JSON.parse(res.content[0].text)

    assert.equal(result.total, 3, 'Total for 2026-03 should be 3')
    assert.equal(result.count, 3, 'Count should be 3')
    assert.equal(result.items.length, 3)

    // ソート順の検証: date DESC, id DESC
    assert.equal(result.items[0].description, '品目C')
    assert.equal(result.items[0].category_name, '外食費')
    assert.equal(result.items[1].description, '品目B')
    assert.equal(result.items[1].category_name, '食費')
    assert.equal(result.items[2].description, '品目A')
    assert.equal(result.items[2].category_name, '食費')

    // include_fixed: false の検証
    await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
      VALUES ('2026-03-20', '2026-03', 80000, 'EXPENSE', 604, '家賃')
    `)

    const nonFixedRes = await env.client.callTool({
      name: 'get_transactions',
      arguments: { fiscal_month: '2026-03', include_fixed: false },
    })
    const nonFixedResult = JSON.parse(nonFixedRes.content[0].text)
    assert.equal(nonFixedResult.total, 3, 'Fixed expense 604 should be excluded')
    assert.ok(nonFixedResult.items.every((it) => it.category_code !== 604))
  } finally {
    await env.teardown()
  }
})

// B3: 600 件の取引を投入し、limit 未指定時に 100 件取得・total: 600、limit: 1000 で検証エラーになること
test('B3: get_transactions の 600件投入時の既定取得件数（100件）と limit: 1000 での検証エラー', async () => {
  const env = await setupTestEnvironment()
  try {
    // 600件のデータをトランザクションで高速投入
    await env.dbAsync.run('BEGIN TRANSACTION')
    for (let i = 1; i <= 600; i++) {
      await env.dbAsync.run(
        `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
         VALUES ('2026-03-01', '2026-03', 100, 'EXPENSE', 100, ?)`,
        [`アイテム${i}`]
      )
    }
    await env.dbAsync.run('COMMIT')

    // 1. limit 未指定時の取得（既定 100 件、total 600）
    const defaultRes = await env.client.callTool({
      name: 'get_transactions',
      arguments: { fiscal_month: '2026-03' },
    })

    assert.ok(!defaultRes.isError)
    const defaultData = JSON.parse(defaultRes.content[0].text)
    assert.equal(defaultData.total, 600, 'total should be 600')
    assert.equal(defaultData.count, 100, 'count should be 100')
    assert.equal(defaultData.items.length, 100, 'items.length should be 100')

    // 2. limit: 1000 は最大500件の上限を超えるため検証エラー
    const overLimitRes = await env.client.callTool({
      name: 'get_transactions',
      arguments: { limit: 1000 },
    })
    assert.equal(overLimitRes.isError, true, 'limit > 500 should cause validation error')
  } finally {
    await env.teardown()
  }
})

// B4: keyword による安全な部分一致検索（% や _ のエスケープと SQL インジェクション対策）
test('B4: keyword による安全な部分一致検索（% や _ の LIKE 特殊文字エスケープと SQL 安全性）', async () => {
  const env = await setupTestEnvironment()
  try {
    await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo)
      VALUES 
        ('2026-03-01', '2026-03', 150, 'EXPENSE', 100, '100%果汁オレンジ', 'ビタミン補給'),
        ('2026-03-02', '2026-03', 1000, 'EXPENSE', 100, '1000円カット', '散髪'),
        ('2026-03-03', '2026-03', 200, 'EXPENSE', 200, 'item_A', 'アンダースコアテスト'),
        ('2026-03-04', '2026-03', 200, 'EXPENSE', 200, 'itemXA', 'X文字テスト'),
        ('2026-03-05', '2026-03', 500, 'EXPENSE', 900, 'SQLテスト', 'memo '' OR 1=1 --')
    `)

    // 1. '%' のエスケープ検証: '100%' で検索して '100%果汁オレンジ' のみヒットし '1000円カット' は除外
    const percentRes = await env.client.callTool({
      name: 'get_transactions',
      arguments: { keyword: '100%' },
    })
    assert.ok(!percentRes.isError)
    const percentData = JSON.parse(percentRes.content[0].text)
    assert.equal(percentData.total, 1)
    assert.equal(percentData.items[0].description, '100%果汁オレンジ')

    // 2. '_' のエスケープ検証: 'item_' で検索して 'item_A' のみヒットし 'itemXA' は除外
    const underscoreRes = await env.client.callTool({
      name: 'get_transactions',
      arguments: { keyword: 'item_' },
    })
    assert.ok(!underscoreRes.isError)
    const underscoreData = JSON.parse(underscoreRes.content[0].text)
    assert.equal(underscoreData.total, 1)
    assert.equal(underscoreData.items[0].description, 'item_A')

    // 3. SQL インジェクション文字列の安全な無害化
    const sqlInjectionRes = await env.client.callTool({
      name: 'get_transactions',
      arguments: { keyword: "' OR '1'='1" },
    })
    assert.ok(!sqlInjectionRes.isError)
    const sqlInjectionData = JSON.parse(sqlInjectionRes.content[0].text)
    assert.equal(sqlInjectionData.total, 0, 'Injection payload should match 0 rows')
  } finally {
    await env.teardown()
  }
})

// B5: get_summary の結果が GET /api/summary?month=... と完全一致すること
test('B5: get_summary の結果が GET /api/summary?month=... の REST API レスポンスと完全一致する', async () => {
  const env = await setupTestEnvironment()
  try {
    // 2026-02 と 2026-03 のデータを投入
    await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
      VALUES 
        ('2026-02-01', '2026-02', 250000, 'INCOME', 700, '給与'),
        ('2026-02-05', '2026-02', 30000, 'EXPENSE', 100, '食費2月'),
        ('2026-02-10', '2026-02', 10000, 'EXPENSE', 200, '日用品2月'),
        ('2026-03-01', '2026-03', 260000, 'INCOME', 700, '給与'),
        ('2026-03-05', '2026-03', 35000, 'EXPENSE', 100, '食費3月'),
        ('2026-03-12', '2026-03', 8000, 'EXPENSE', 200, '日用品3月')
    `)

    // MCP ツール呼び出し
    const mcpRes = await env.client.callTool({
      name: 'get_summary',
      arguments: { fiscal_month: '2026-03' },
    })
    assert.ok(!mcpRes.isError)
    const mcpSummary = JSON.parse(mcpRes.content[0].text)

    // REST API 呼び出し
    const restRes = await fetch(`${env.baseUrl}/api/summary?month=2026-03`)
    assert.equal(restRes.status, 200)
    const restSummary = await restRes.json()

    // 完全一致検証
    assert.deepStrictEqual(mcpSummary, restSummary)
    assert.deepStrictEqual(mcpRes.structuredContent, restSummary)
  } finally {
    await env.teardown()
  }
})

// B6: get_price_trends が GET /api/price_trend?keyword=... と一致し、keyword: "" で検証エラー
test('B6: get_price_trends が GET /api/price_trend と一致し、keyword: "" で検証エラーになる', async () => {
  const env = await setupTestEnvironment()
  try {
    await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
      VALUES 
        ('2026-01-10', '2026-01', 200, 'EXPENSE', 100, 'たまご 10個入'),
        ('2026-02-15', '2026-02', 260, 'EXPENSE', 100, 'たまご 10個入'),
        ('2026-03-05', '2026-03', 230, 'EXPENSE', 100, 'たまご 10個入'),
        ('2026-03-06', '2026-03', 180, 'EXPENSE', 100, '牛乳 1L')
    `)

    // MCP ツール呼び出し
    const mcpRes = await env.client.callTool({
      name: 'get_price_trends',
      arguments: { keyword: 'たまご', mode: 'simple' },
    })
    assert.ok(!mcpRes.isError)
    const mcpTrend = JSON.parse(mcpRes.content[0].text)

    // REST API 呼び出し
    const restRes = await fetch(
      `${env.baseUrl}/api/price_trend?keyword=${encodeURIComponent('たまご')}&mode=simple`
    )
    assert.equal(restRes.status, 200)
    const restTrend = await restRes.json()

    assert.deepStrictEqual(mcpTrend, restTrend)
    assert.deepStrictEqual(mcpRes.structuredContent, restTrend)

    // keyword: "" での検証エラー
    const emptyKwRes = await env.client.callTool({
      name: 'get_price_trends',
      arguments: { keyword: '' },
    })
    assert.equal(emptyKwRes.isError, true, 'keyword: "" should cause validation error')
  } finally {
    await env.teardown()
  }
})

// B7: get_fiscal_month で23日ルール（翌月判定・年末年始・うるう年）および 2026-10-22, 2026-02-30 のケース検証
test('B7: get_fiscal_month で23日ルール、年末年始、うるう年、境界日（10-22/10-23）、不正日検証', async () => {
  const env = await setupTestEnvironment()
  try {
    const cases = [
      {
        date: '2026-10-22',
        expectedMonth: '2026-10',
        expectedRange: { start: '2026-09-23', end: '2026-10-22' },
      },
      {
        date: '2026-10-23',
        expectedMonth: '2026-11',
        expectedRange: { start: '2026-10-23', end: '2026-11-22' },
      },
      {
        date: '2026-12-23',
        expectedMonth: '2027-01',
        expectedRange: { start: '2026-12-23', end: '2027-01-22' },
      },
      {
        date: '2028-02-29', // うるう年 (23日以降) -> 翌月3月
        expectedMonth: '2028-03',
        expectedRange: { start: '2028-02-23', end: '2028-03-22' },
      },
      {
        date: '2028-02-20', // うるう年 (22日以前) -> 当月2月
        expectedMonth: '2028-02',
        expectedRange: { start: '2028-01-23', end: '2028-02-22' },
      },
    ]

    for (const tc of cases) {
      const res = await env.client.callTool({
        name: 'get_fiscal_month',
        arguments: { date: tc.date },
      })

      assert.ok(!res.isError, `Calling get_fiscal_month for ${tc.date} should succeed`)
      const info = JSON.parse(res.content[0].text)
      assert.equal(info.date, tc.date)
      assert.equal(info.fiscal_month, tc.expectedMonth)
      assert.deepStrictEqual(info.range, tc.expectedRange)
      assert.deepStrictEqual(res.structuredContent, info)
    }

    // カレンダー上に実在しない不正な日付 (例: 2026-02-30) -> バリデーションエラー
    const invalidRes = await env.client.callTool({
      name: 'get_fiscal_month',
      arguments: { date: '2026-02-30' },
    })
    assert.equal(invalidRes.isError, true, 'Invalid date 2026-02-30 should result in error')
  } finally {
    await env.teardown()
  }
})

// B8: 存在しない ID の get_transaction で isError: true が返ること、存在する ID では category_name つきで正常返却
test('B8: get_transaction で存在しない ID は isError: true、存在する ID は category_name つきで正常返却', async () => {
  const env = await setupTestEnvironment()
  try {
    const inserted = await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo)
      VALUES ('2026-03-10', '2026-03', 5000, 'EXPENSE', 100, '本棚', '書斎用')
    `)
    const validId = inserted.lastID

    // 存在する ID
    const validRes = await env.client.callTool({
      name: 'get_transaction',
      arguments: { id: validId },
    })
    assert.ok(!validRes.isError)
    const validData = JSON.parse(validRes.content[0].text)
    assert.equal(validData.id, validId)
    assert.equal(validData.amount, 5000)
    assert.equal(validData.description, '本棚')
    assert.equal(validData.category_name, '食費')
    assert.deepStrictEqual(validRes.structuredContent, validData)

    // 存在しない ID
    const notFoundRes = await env.client.callTool({
      name: 'get_transaction',
      arguments: { id: 999999 },
    })
    assert.equal(notFoundRes.isError, true, 'Non-existent ID must return isError: true')
    assert.match(notFoundRes.content[0].text, /999999/)
  } finally {
    await env.teardown()
  }
})

// B-extra: get_fixed_costs の年指定によるマトリクスデータ取得
test('B-extra: get_fixed_costs で指定年の固定費・給与データが正常に取得される', async () => {
  const env = await setupTestEnvironment()
  try {
    await env.dbAsync.run(`
      INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
      VALUES 
        ('2026-01-25', '2026-02', 250000, 'INCOME', 700, '1月給与'),
        ('2026-01-26', '2026-02', 80000, 'EXPENSE', 604, '1月家賃'),
        ('2026-02-25', '2026-03', 250000, 'INCOME', 700, '2月給与'),
        ('2026-02-26', '2026-03', 80000, 'EXPENSE', 604, '2月家賃'),
        ('2026-03-10', '2026-03', 1500, 'EXPENSE', 100, '食費（変動費）'),
        ('2025-12-25', '2026-01', 250000, 'INCOME', 700, '2025年冬給与')
    `)

    const res = await env.client.callTool({
      name: 'get_fixed_costs',
      arguments: { year: 2026 },
    })

    assert.ok(!res.isError)
    const fixedCosts = JSON.parse(res.content[0].text)

    const expected = await fixedCostService.getFixedCostMatrix(env.db, { year: 2026 })
    assert.deepStrictEqual(fixedCosts, expected)
    assert.deepStrictEqual(res.structuredContent, expected)

    // 変動費（食費 100）は含まれず、固定費（604, 700）のみが含まれること
    assert.ok(fixedCosts.data.length > 0)
    for (const row of fixedCosts.data) {
      assert.notEqual(row.category_code, 100, 'Variable cost should not be included')
      assert.ok([604, 700].includes(row.category_code))
    }
  } finally {
    await env.teardown()
  }
})
