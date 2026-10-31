const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const serverNodeModules = path.resolve(__dirname, '../../server/node_modules')
if (!module.paths.includes(serverNodeModules)) {
  module.paths.push(serverNodeModules)
}

const { express, startServer, createTempDb, createMcpClient } = require('./mcp-helpers')
const { createMcpRouter } = require('../../server/mcp')
const { createDbAsync } = require('../../server/lib/dbAsync')

const TEST_TOKEN = 'test-mcp-valid-token-32-characters-long!'

// 汎用ツールの固定費・給与ガードが専用ツールを案内するメッセージ
const DEDICATED_TOOL_GUIDE_RE =
  /固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item \/ update_salary_item \/ delete_salary_item）/

/**
 * テスト用ヘルパー: 一時DBとMCPクライアントを立ち上げる
 */
async function setupTestEnvironment() {
  process.env.MCP_AUTH_TOKEN = TEST_TOKEN
  // 実行環境の設定に依存せず token モード・Host 検証なしで動かす
  delete process.env.MCP_AUTH_MODE
  delete process.env.MCP_ALLOWED_HOSTS

  const { db, cleanup } = await createTempDb()
  const dbAsync = createDbAsync(db)

  const testApp = express()
  testApp.use('/mcp', createMcpRouter(db))

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

// tools/list で 4 つの更新系ツールの名前と destructiveHint が返ること（登録系は destructiveHint: false）
test('tools/list で 4 つの更新系ツールが登録され、適切な destructiveHint を持つこと', async () => {
  const env = await setupTestEnvironment()
  try {
    const list = await env.client.listTools()
    assert.ok(Array.isArray(list.tools))

    const expectedWriteTools = [
      { name: 'create_transaction', destructive: false, idempotent: false },
      { name: 'create_transactions_batch', destructive: false, idempotent: false },
      { name: 'update_transaction', destructive: true, idempotent: true },
      { name: 'delete_transaction', destructive: true, idempotent: false },
    ]

    for (const exp of expectedWriteTools) {
      const tool = list.tools.find((t) => t.name === exp.name)
      assert.ok(tool, `Tool ${exp.name} should be listed`)
      assert.ok(tool.annotations, `Tool ${exp.name} should have annotations`)
      assert.equal(
        tool.annotations.destructiveHint,
        exp.destructive,
        `${exp.name} destructiveHint should be ${exp.destructive}`
      )
      if (exp.idempotent) {
        assert.equal(
          tool.annotations.idempotentHint,
          true,
          `${exp.name} idempotentHint should be true`
        )
      }
    }
  } finally {
    await env.teardown()
  }
})

// C1: 23日以降の日付が翌月会計月として登録されること
test('C1: 23日以降の日付が翌月会計月として登録されること', async () => {
  const env = await setupTestEnvironment()
  try {
    const res = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-23',
        amount: 1500,
        type: 'EXPENSE',
        category_code: 100,
        description: '夕食食材',
        memo: 'スーパー',
      },
    })

    assert.ok(!res.isError, 'isError should be false')
    assert.ok(res.content && res.content.length > 0)
    const data = JSON.parse(res.content[0].text)

    assert.equal(data.date, '2026-03-23')
    assert.equal(data.fiscal_month, '2026-04')
    assert.equal(data.amount, 1500)
    assert.equal(data.type, 'EXPENSE')
    assert.equal(data.category_code, 100)
    assert.equal(data.category_name, '食費')
    assert.equal(data.description, '夕食食材')
    assert.equal(data.memo, 'スーパー')
    assert.ok(data.id, 'id should be present')

    // DB 実データ確認
    const row = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [data.id])
    assert.ok(row)
    assert.equal(row.fiscal_month, '2026-04')
    assert.equal(row.amount, 1500)
  } finally {
    await env.teardown()
  }
})

// C2: 支出の割引（amount < 0）が負数のまま登録されること
test('C2: 支出の割引（amount < 0）が負数のまま登録されること', async () => {
  const env = await setupTestEnvironment()
  try {
    const res = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: -200,
        type: 'EXPENSE',
        category_code: 100,
        description: '割引クーポン',
      },
    })

    assert.ok(!res.isError, 'isError should be false')
    const data = JSON.parse(res.content[0].text)
    assert.equal(data.amount, -200)

    const row = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [data.id])
    assert.ok(row)
    assert.equal(row.amount, -200)
  } finally {
    await env.teardown()
  }
})

// C3: 金額0円、小数金額、1000万超、不正日付、存在しない費目コード、無効type、収入負額がバリデーションエラーになりDBに影響しないこと
test('C3: 金額0円、小数金額、1000万超、不正日付、存在しない費目コード、無効type、収入負額がバリデーションエラーになりDBに影響しないこと', async () => {
  const env = await setupTestEnvironment()
  try {
    // (a) 金額0円
    const resZero = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 0,
        type: 'EXPENSE',
        category_code: 100,
        description: '0円テスト',
      },
    })
    assert.equal(resZero.isError, true, '金額0円はエラーになること')

    // (b) 小数金額 (12.5) -> int バリデーションで弾かれる
    const resDecimal = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 12.5,
        type: 'EXPENSE',
        category_code: 100,
        description: '小数テスト',
      },
    })
    assert.equal(resDecimal.isError, true, '小数はエラーになること')

    // (c) 1,000万円超過 (10000001)
    const resOverMax = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 10000001,
        type: 'EXPENSE',
        category_code: 100,
        description: '上限超過',
      },
    })
    assert.equal(resOverMax.isError, true, '1,000万円超はエラーになること')

    // (d) カレンダー上実在しない日付 (2026-02-30)
    const resInvalidDate = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-02-30',
        amount: 100,
        type: 'EXPENSE',
        category_code: 100,
        description: '存在しない日',
      },
    })
    assert.equal(resInvalidDate.isError, true, '存在しない日はエラーになること')

    // (e) スラッシュ区切り日付 ("2026/10/01")
    const resSlashDate = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026/10/01',
        amount: 100,
        type: 'EXPENSE',
        category_code: 100,
        description: 'スラッシュ日付',
      },
    })
    assert.equal(resSlashDate.isError, true, 'スラッシュ区切り日付はエラーになること')

    // (f) 無効な収支区分 ("OTHER")
    const resInvalidType = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 100,
        type: 'OTHER',
        category_code: 100,
        description: '不正区分',
      },
    })
    assert.equal(resInvalidType.isError, true, '無効なtypeはエラーになること')

    // (g) 存在しない費目コード
    const resInvalidCat = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 100,
        type: 'EXPENSE',
        category_code: 99999,
        description: '不正カテゴリ',
      },
    })
    assert.equal(resInvalidCat.isError, true, '存在しないカテゴリコードはエラーになること')

    // (h) 収入の負額
    const resNegativeIncome = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: -500,
        type: 'INCOME',
        category_code: 704,
        description: '負の収入',
      },
    })
    assert.equal(resNegativeIncome.isError, true, '収入の負額はエラーになること')

    // DB に1件も登録されていないことを確認
    const countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 0)
  } finally {
    await env.teardown()
  }
})

// C4: 固定費コード（604等）や給与コード（700）の登録が拒否され、専用ツールが案内されること
test('C4: 固定費コード（604等）や給与コード（700）の登録が拒否されること', async () => {
  const env = await setupTestEnvironment()
  try {
    // 固定費（604: 家賃）
    const resFixed = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 80000,
        type: 'EXPENSE',
        category_code: 604,
        description: '家賃',
      },
    })
    assert.equal(resFixed.isError, true, '固定費の登録は拒否されること')
    assert.match(resFixed.content[0].text, DEDICATED_TOOL_GUIDE_RE)

    // 給与（700: 給与）
    const resSalary = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-03-10',
        amount: 300000,
        type: 'INCOME',
        category_code: 700,
        description: '給与',
      },
    })
    assert.equal(resSalary.isError, true, '給与の登録は拒否されること')
    assert.match(resSalary.content[0].text, DEDICATED_TOOL_GUIDE_RE)

    // DB に1行も挿入されていないこと
    const countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 0)
  } finally {
    await env.teardown()
  }
})

// C5: update_transaction で日付変更時に fiscal_month が再計算されること
test('C5: update_transaction で日付変更時に fiscal_month が再計算されること', async () => {
  const env = await setupTestEnvironment()
  try {
    // 2026-04-10 (fiscal_month: '2026-04') で初期作成
    const createRes = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-04-10',
        amount: 2000,
        type: 'EXPENSE',
        category_code: 100,
        description: '買い物',
      },
    })
    assert.ok(!createRes.isError)
    const created = JSON.parse(createRes.content[0].text)
    assert.equal(created.fiscal_month, '2026-04')

    // 2026-04-23 (23日以降 -> fiscal_month: '2026-05') に更新
    const updateRes = await env.client.callTool({
      name: 'update_transaction',
      arguments: {
        id: created.id,
        date: '2026-04-23',
        description: '更新後買い物',
      },
    })
    assert.ok(!updateRes.isError, 'isError should be false')
    const updateData = JSON.parse(updateRes.content[0].text)

    assert.equal(updateData.before.fiscal_month, '2026-04')
    assert.equal(updateData.after.fiscal_month, '2026-05')
    assert.equal(updateData.after.date, '2026-04-23')
    assert.equal(updateData.after.description, '更新後買い物')

    // DB 上の整合性確認
    const row = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [created.id])
    assert.equal(row.fiscal_month, '2026-05')
    assert.equal(row.date, '2026-04-23')
  } finally {
    await env.teardown()
  }
})

// C6: 存在しない ID の更新、および更新項目なし時の検証エラー
test('C6: 存在しない ID の更新、および更新項目なし時の検証エラー', async () => {
  const env = await setupTestEnvironment()
  try {
    // (a) 存在しない ID
    const resNotFound = await env.client.callTool({
      name: 'update_transaction',
      arguments: {
        id: 999999,
        description: '存在しない行',
      },
    })
    assert.equal(resNotFound.isError, true, '存在しないIDの更新はエラーになること')
    assert.match(resNotFound.content[0].text, /999999/)

    // (b) 更新項目なし ({ id: 1 } のみ)
    const resNoFields = await env.client.callTool({
      name: 'update_transaction',
      arguments: {
        id: 1,
      },
    })
    assert.equal(resNoFields.isError, true, '更新項目なしはエラーになること')
    assert.match(resNoFields.content[0].text, /更新項目が指定されていません/)
  } finally {
    await env.teardown()
  }
})

// C7: 固定費・給与行に対する更新・削除が拒否されること
test('C7: 固定費・給与行に対する更新・削除が拒否されること', async () => {
  const env = await setupTestEnvironment()
  try {
    // DB に直接固定費行と給与行を投入
    const fixedRun = await env.dbAsync.run(
      'INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) VALUES (?, ?, ?, ?, ?, ?)',
      ['2026-04-01', '2026-04', 80000, 'EXPENSE', 604, '家賃']
    )
    const fixedId = fixedRun.lastID

    const salaryRun = await env.dbAsync.run(
      'INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) VALUES (?, ?, ?, ?, ?, ?)',
      ['2026-04-25', '2026-05', 300000, 'INCOME', 700, '給与']
    )
    const salaryId = salaryRun.lastID

    // 通常行も1件投入
    const normalRun = await env.dbAsync.run(
      'INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) VALUES (?, ?, ?, ?, ?, ?)',
      ['2026-04-15', '2026-04', 1000, 'EXPENSE', 100, '通常食費']
    )
    const normalId = normalRun.lastID

    // (a) 固定費行の更新拒否
    const updateFixedRes = await env.client.callTool({
      name: 'update_transaction',
      arguments: { id: fixedId, amount: 85000 },
    })
    assert.equal(updateFixedRes.isError, true, '固定費行の更新は拒否されること')
    assert.match(updateFixedRes.content[0].text, DEDICATED_TOOL_GUIDE_RE)

    // (b) 給与行の更新拒否
    const updateSalaryRes = await env.client.callTool({
      name: 'update_transaction',
      arguments: { id: salaryId, amount: 350000 },
    })
    assert.equal(updateSalaryRes.isError, true, '給与行の更新は拒否されること')
    assert.match(updateSalaryRes.content[0].text, DEDICATED_TOOL_GUIDE_RE)

    // (c) 通常行のカテゴリを固定費コードに変更する更新拒否
    const changeToFixedRes = await env.client.callTool({
      name: 'update_transaction',
      arguments: { id: normalId, category_code: 604 },
    })
    assert.equal(changeToFixedRes.isError, true, '固定費カテゴリへの変更は拒否されること')
    assert.match(changeToFixedRes.content[0].text, DEDICATED_TOOL_GUIDE_RE)

    // (d) 固定費行の削除拒否
    const deleteFixedRes = await env.client.callTool({
      name: 'delete_transaction',
      arguments: { id: fixedId, confirm: true },
    })
    assert.equal(deleteFixedRes.isError, true, '固定費行の削除は拒否されること')
    assert.match(deleteFixedRes.content[0].text, DEDICATED_TOOL_GUIDE_RE)

    // (e) 給与行の削除拒否
    const deleteSalaryRes = await env.client.callTool({
      name: 'delete_transaction',
      arguments: { id: salaryId, confirm: true },
    })
    assert.equal(deleteSalaryRes.isError, true, '給与行の削除は拒否されること')
    assert.match(deleteSalaryRes.content[0].text, DEDICATED_TOOL_GUIDE_RE)
  } finally {
    await env.teardown()
  }
})

// C8: delete_transaction で confirm: true が無ければ拒否され、指定時は削除前データが返ること
test('C8: delete_transaction で confirm: true が無ければ拒否され、指定時は削除前データが返ること', async () => {
  const env = await setupTestEnvironment()
  try {
    // 通常行を作成
    const createRes = await env.client.callTool({
      name: 'create_transaction',
      arguments: {
        date: '2026-04-10',
        amount: 2500,
        type: 'EXPENSE',
        category_code: 100,
        description: '削除テスト用食材',
      },
    })
    assert.ok(!createRes.isError)
    const created = JSON.parse(createRes.content[0].text)

    // (a) confirm: false -> 拒否
    const resFalseConfirm = await env.client.callTool({
      name: 'delete_transaction',
      arguments: { id: created.id, confirm: false },
    })
    assert.equal(resFalseConfirm.isError, true, 'confirm: false はエラーになること')

    // (b) confirm: true -> 正常削除
    const resDelete = await env.client.callTool({
      name: 'delete_transaction',
      arguments: { id: created.id, confirm: true },
    })
    assert.ok(!resDelete.isError, 'isError should be false')
    const deleteData = JSON.parse(resDelete.content[0].text)
    assert.equal(deleteData.deleted_transaction.id, created.id)
    assert.equal(deleteData.deleted_transaction.description, '削除テスト用食材')

    // DB から削除されていることを確認
    const row = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [created.id])
    assert.equal(row, undefined, 'DB から削除されていること')

    // 存在しない ID の削除
    const resNotFound = await env.client.callTool({
      name: 'delete_transaction',
      arguments: { id: 999999, confirm: true },
    })
    assert.equal(resNotFound.isError, true, '存在しないIDの削除はエラーになること')
  } finally {
    await env.teardown()
  }
})

// D1: create_transactions_batch で複数明細が一括登録され、store が memo に展開されること
test('D1: create_transactions_batch で複数明細が一括登録され、store が memo に展開されること', async () => {
  const env = await setupTestEnvironment()
  try {
    const res = await env.client.callTool({
      name: 'create_transactions_batch',
      arguments: {
        date: '2026-05-10',
        store: 'スーパーライフ',
        items: [
          { amount: 500, category_code: 100, description: '野菜' },
          { amount: 300, category_code: 100, description: '肉', memo: '割引シール付き' },
          { date: '2026-05-25', amount: 800, category_code: 200, description: '洗剤' },
        ],
      },
    })

    assert.ok(!res.isError, 'isError should be false')
    const data = JSON.parse(res.content[0].text)

    assert.equal(data.count, 3)
    assert.equal(data.total_amount, 1600)
    assert.deepEqual(data.fiscal_months, ['2026-05', '2026-06'])

    // 明細 1: store が memo に展開、date は全体日付、fiscal_month は 2026-05
    assert.equal(data.items[0].date, '2026-05-10')
    assert.equal(data.items[0].memo, 'スーパーライフ')
    assert.equal(data.items[0].fiscal_month, '2026-05')
    assert.equal(data.items[0].category_name, '食費')

    // 明細 2: 固有の memo が優先
    assert.equal(data.items[1].date, '2026-05-10')
    assert.equal(data.items[1].memo, '割引シール付き')
    assert.equal(data.items[1].fiscal_month, '2026-05')

    // 明細 3: 固有の date (25日 -> 翌月 2026-06)
    assert.equal(data.items[2].date, '2026-05-25')
    assert.equal(data.items[2].memo, 'スーパーライフ')
    assert.equal(data.items[2].fiscal_month, '2026-06')
    assert.equal(data.items[2].category_name, '日用品・雑費')

    // DB に 3 件正しく登録されていること
    const rows = await env.dbAsync.all('SELECT * FROM transactions ORDER BY id ASC')
    assert.equal(rows.length, 3)
    assert.equal(rows[0].memo, 'スーパーライフ')
    assert.equal(rows[1].memo, '割引シール付き')
    assert.equal(rows[2].fiscal_month, '2026-06')
  } finally {
    await env.teardown()
  }
})

// D2: バッチ登録中に複数行に不正がある場合、全行チェックされ行番号付きエラー一覧が返ること。全件ロールバックされること
test('D2: バッチ登録中に複数行に不正がある場合、全行チェックされ行番号付きエラー一覧が返ること。全件ロールバックされること', async () => {
  const env = await setupTestEnvironment()
  try {
    // 2行目と3行目に不正があるバッチ
    const res = await env.client.callTool({
      name: 'create_transactions_batch',
      arguments: {
        date: '2026-05-10',
        items: [
          { amount: 500, category_code: 100, description: '正常パン' },
          { amount: 300, category_code: 99999, description: '不正費目明細' }, // 2行目不正
          { amount: 80000, category_code: 604, description: '固定費明細' }, // 3行目不正
        ],
      },
    })

    assert.equal(res.isError, true, 'isError should be true')
    const errText = res.content[0].text
    // 複数行のエラーが両方含まれていること
    assert.match(errText, /items\[1\]\.category_code: 存在しない費目コードです \(99999\)/)
    assert.match(
      errText,
      /items\[2\]\.category_code: 固定費・給与の登録はできません。固定費・給与は専用ツールを使ってください/
    )

    // DB に 1 行も挿入されていないこと
    const countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 0)
  } finally {
    await env.teardown()
  }
})

// D3: dry_run: true で登録を行わずに計算結果が返り、続けて dry_run: false で正常登録されること
test('D3: dry_run: true で登録を行わずに計算結果が返り、続けて dry_run: false で正常登録されること', async () => {
  const env = await setupTestEnvironment()
  try {
    const payload = {
      date: '2026-05-10',
      store: 'テスト店舗',
      items: [
        { amount: 1000, category_code: 100, description: '食材1' },
        { amount: 2000, category_code: 200, description: '日用品1' },
      ],
    }

    // 1. dry_run: true の実行
    const dryRunRes = await env.client.callTool({
      name: 'create_transactions_batch',
      arguments: {
        ...payload,
        dry_run: true,
      },
    })

    assert.ok(!dryRunRes.isError, 'isError should be false')
    const dryRunData = JSON.parse(dryRunRes.content[0].text)

    assert.equal(dryRunData.dry_run, true)
    assert.equal(dryRunData.count, 2)
    assert.equal(dryRunData.total_amount, 3000)
    assert.deepEqual(dryRunData.fiscal_months, ['2026-05'])
    assert.equal(dryRunData.items.length, 2)

    // DB には 1 件も登録されていないこと
    let countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 0)

    // 2. 続けて dry_run: false で同一ペイロードを実行
    const execRes = await env.client.callTool({
      name: 'create_transactions_batch',
      arguments: {
        ...payload,
        dry_run: false,
      },
    })

    assert.ok(!execRes.isError, 'isError should be false')
    const execData = JSON.parse(execRes.content[0].text)
    assert.equal(execData.count, 2)
    assert.equal(execData.total_amount, 3000)
    assert.ok(execData.items[0].id)
    assert.ok(execData.items[1].id)

    // DB に 2 件正しく登録されていること
    countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 2)
  } finally {
    await env.teardown()
  }
})

// D4: 200行上限の境界値検証（201行超過でエラー、200行正常登録）
test('D4: 200行上限の境界値検証（201行超過でエラー、200行が1トランザクションで正常登録）', async () => {
  const env = await setupTestEnvironment()
  try {
    // (a) 201 行作成して検証エラーになること
    const items201 = Array.from({ length: 201 }, (_, i) => ({
      amount: 100,
      category_code: 100,
      description: `商品${i + 1}`,
    }))

    const res201 = await env.client.callTool({
      name: 'create_transactions_batch',
      arguments: {
        date: '2026-05-10',
        items: items201,
      },
    })
    assert.equal(res201.isError, true, '201行は上限超過でエラーになること')

    let countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 0, 'DB には 1 行も挿入されていないこと')

    // (b) 200 行が 1 トランザクションで正常登録されること
    const items200 = Array.from({ length: 200 }, (_, i) => ({
      amount: 100 + i,
      category_code: 100,
      description: `商品${i + 1}`,
    }))

    const res200 = await env.client.callTool({
      name: 'create_transactions_batch',
      arguments: {
        date: '2026-05-10',
        items: items200,
      },
    })
    assert.ok(!res200.isError, '200行は正常に登録されること')
    const data200 = JSON.parse(res200.content[0].text)
    assert.equal(data200.count, 200)

    countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 200, 'DB に 200 件すべて登録されていること')
  } finally {
    await env.teardown()
  }
})

// P1-1: 並行トランザクション分離テスト（直列化キューにより相互破壊や部分コミットが起きないこと）
test('P1-1: 並行トランザクション分離テスト（直列化キューにより相互破壊や部分コミットが起きないこと）', async () => {
  const env = await setupTestEnvironment()
  try {
    // Batch A: 正常な 10 件のバッチ
    const itemsValid = Array.from({ length: 10 }, (_, i) => ({
      amount: 1000 + i,
      category_code: 100,
      description: `正常明細A-${i + 1}`,
    }))

    // Batch B: 途中に不正行（存在しない費目コード）が含まれる 10 件のバッチ
    const itemsInvalid = Array.from({ length: 10 }, (_, i) => ({
      amount: 2000 + i,
      category_code: i === 5 ? 99999 : 100,
      description: `明細B-${i + 1}`,
    }))

    // 2 つのバッチ登録を同時に Promise.all で発火
    const [resA, resB] = await Promise.all([
      env.client.callTool({
        name: 'create_transactions_batch',
        arguments: {
          date: '2026-06-01',
          store: '店舗A',
          items: itemsValid,
        },
      }),
      env.client.callTool({
        name: 'create_transactions_batch',
        arguments: {
          date: '2026-06-01',
          store: '店舗B',
          items: itemsInvalid,
        },
      }),
    ])

    // Batch A は成功していること
    assert.ok(!resA.isError, 'Batch A は正常終了すること')
    const dataA = JSON.parse(resA.content[0].text)
    assert.equal(dataA.count, 10)

    // Batch B は失敗していること
    assert.equal(resB.isError, true, 'Batch B はエラーになること')

    // DB の検証: 正常な Batch A の 10 件のみが存在し、Batch B は 1 件もコミットされていないこと
    const rows = await env.dbAsync.all('SELECT * FROM transactions')
    assert.equal(rows.length, 10, 'DB には Batch A の 10 件のみが存在すること')
    for (const r of rows) {
      assert.match(r.description, /^正常明細A-/)
    }
  } finally {
    await env.teardown()
  }
})

// P1-1-reg: 共有接続側で別トランザクション (BEGIN/ROLLBACK) が実行されても insertBatch の専用接続が独立して正常コミットされること
test('P1-1-reg: 共有接続側で別トランザクション (BEGIN/ROLLBACK) が実行されても insertBatch の専用接続が独立して正常コミットされること', async () => {
  const env = await setupTestEnvironment()
  try {
    const items = Array.from({ length: 50 }, (_, i) => ({
      amount: 100 + i,
      category_code: 100,
      description: `独立接続テスト明細-${i + 1}`,
    }))

    // 共有接続側で BEGIN TRANSACTION してすぐに ROLLBACK するタスクを並行実行
    const simulateSharedConnectionActivity = async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        try {
          await env.dbAsync.run('BEGIN TRANSACTION')
          await env.dbAsync.run('SELECT COUNT(*) FROM categories')
          await env.dbAsync.run('ROLLBACK')
        } catch {
          // 衝突やタイミング例外は無視
        }
      }
    }

    const [batchRes] = await Promise.all([
      env.client.callTool({
        name: 'create_transactions_batch',
        arguments: {
          date: '2026-06-15',
          store: '専用接続店舗',
          items,
        },
      }),
      simulateSharedConnectionActivity(),
    ])

    assert.ok(!batchRes.isError, 'insertBatch は共有接続のトランザクションに妨げられず成功すること')
    const data = JSON.parse(batchRes.content[0].text)
    assert.equal(data.count, 50)

    // DB に 50 件すべて登録されていること（共有接続の ROLLBACK で巻き戻されていない）
    const countRow = await env.dbAsync.get('SELECT COUNT(*) as count FROM transactions')
    assert.equal(countRow.count, 50, '共有接続側の ROLLBACK に影響されず全件コミットされていること')
  } finally {
    await env.teardown()
  }
})
