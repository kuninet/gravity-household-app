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
    call: (name, args) => client.callTool({ name, arguments: args }),
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

function parse(res) {
  return JSON.parse(res.content[0].text)
}

async function insertRow(
  dbAsync,
  { date, fiscal_month, amount, type, category_code, description }
) {
  const result = await dbAsync.run(
    'INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) VALUES (?, ?, ?, ?, ?, ?)',
    [date, fiscal_month, amount, type, category_code, description]
  )
  return result.lastID
}

async function countRows(dbAsync) {
  const row = await dbAsync.get('SELECT COUNT(*) AS c FROM transactions')
  return row.c
}

// F1: tools/list に 4 つの専用ツールが適切な annotations 付きで登録され、全体で 15 ツールになること
test('F1: tools/list に固定費・給与の専用ツール 4 つが登録され、全体で 15 ツールであること', async () => {
  const env = await setupTestEnvironment()
  try {
    const list = await env.client.listTools()
    assert.equal(list.tools.length, 15, 'ツール総数は 15 であること')

    const expected = [
      { name: 'set_fixed_cost_cell', destructive: true, idempotent: true },
      { name: 'add_salary_item', destructive: false, idempotent: undefined },
      { name: 'update_salary_item', destructive: true, idempotent: true },
      { name: 'delete_salary_item', destructive: true, idempotent: undefined },
    ]
    for (const exp of expected) {
      const tool = list.tools.find((t) => t.name === exp.name)
      assert.ok(tool, `${exp.name} が登録されていること`)
      assert.ok(tool.annotations, `${exp.name} に annotations があること`)
      assert.equal(tool.annotations.destructiveHint, exp.destructive)
      assert.equal(tool.annotations.idempotentHint, exp.idempotent)
    }

    const setTool = list.tools.find((t) => t.name === 'set_fixed_cost_cell')
    assert.match(setTool.description, /get_fixed_costs/)
    // type は引数に出さない
    assert.deepEqual(Object.keys(setTool.inputSchema.properties).sort(), [
      'amount',
      'category_code',
      'fiscal_month',
    ])
  } finally {
    await env.teardown()
  }
})

// F2: set_fixed_cost_cell の created → updated → deleted → ignored
test('F2: set_fixed_cost_cell が created → updated → deleted → ignored と遷移すること', async () => {
  const env = await setupTestEnvironment()
  try {
    const created = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 604,
      amount: 80000,
    })
    assert.ok(!created.isError, created.content[0].text)
    const createdData = parse(created)
    assert.equal(createdData.status, 'created')
    assert.equal(createdData.fiscal_month, '2026-04')
    assert.equal(createdData.category_code, 604)
    assert.equal(createdData.amount, 80000)
    assert.equal(createdData.previous_amount, null)
    assert.equal(createdData.transaction.date, '2026-04-01')
    assert.equal(createdData.transaction.fiscal_month, '2026-04')
    assert.equal(createdData.transaction.amount, 80000)
    assert.equal(createdData.transaction.type, 'EXPENSE')
    assert.equal(createdData.transaction.category_code, 604)
    assert.equal(createdData.transaction.category_name, '家賃')
    assert.equal(createdData.transaction.description, '固定費入力')
    assert.deepEqual(created.structuredContent, createdData)
    const id = createdData.transaction.id
    assert.equal(createdData.id, id, 'created では作成した明細の ID を返す')

    const updated = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 604,
      amount: 85000,
    })
    assert.ok(!updated.isError, updated.content[0].text)
    const updatedData = parse(updated)
    assert.equal(updatedData.status, 'updated')
    assert.equal(updatedData.amount, 85000)
    assert.equal(updatedData.previous_amount, 80000)
    assert.equal(updatedData.transaction.id, id)
    assert.equal(updatedData.id, id, 'updated では更新した明細の ID を返す')
    assert.equal(updatedData.transaction.amount, 85000)

    const deleted = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 604,
      amount: 0,
    })
    assert.ok(!deleted.isError, deleted.content[0].text)
    const deletedData = parse(deleted)
    assert.equal(deletedData.status, 'deleted')
    assert.equal(deletedData.id, id, 'deleted では削除した明細の ID を返す')
    assert.equal(deletedData.previous_amount, 85000)
    assert.equal(deletedData.transaction, undefined)
    assert.equal(await countRows(env.dbAsync), 0)

    const ignored = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 604,
      amount: 0,
    })
    assert.ok(!ignored.isError, ignored.content[0].text)
    const ignoredData = parse(ignored)
    assert.equal(ignoredData.status, 'ignored')
    assert.equal(ignoredData.id, undefined, 'ignored では ID を返さない')
    assert.equal(ignoredData.previous_amount, null)
    assert.equal(ignoredData.transaction, undefined)
    assert.equal(await countRows(env.dbAsync), 0)
  } finally {
    await env.teardown()
  }
})

// F3: set_fixed_cost_cell の入力拒否（給与・非固定費・存在しないコード・不正な金額・会計月）
test('F3: set_fixed_cost_cell が不正な入力を拒否し、DB を変更しないこと', async () => {
  const env = await setupTestEnvironment()
  try {
    const salary = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 700,
      amount: 300000,
    })
    assert.equal(salary.isError, true)
    assert.match(
      salary.content[0].text,
      /給与は add_salary_item \/ update_salary_item \/ delete_salary_item を使ってください/
    )

    for (const code of [100, 600, 99999]) {
      const res = await env.call('set_fixed_cost_cell', {
        fiscal_month: '2026-04',
        category_code: code,
        amount: 1000,
      })
      assert.equal(res.isError, true, `コード ${code} は拒否されること`)
      assert.match(res.content[0].text, /固定費コードではありません（601〜608, 901）/)
      assert.match(res.content[0].text, /create_transaction を使ってください/)
    }

    // 固定費コードだが categories テーブルに存在しない場合
    await env.dbAsync.run('DELETE FROM categories WHERE code = 608')
    const missing = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 608,
      amount: 1000,
    })
    assert.equal(missing.isError, true)
    assert.match(missing.content[0].text, /存在しない費目コードです: 608/)

    const invalidArgs = [
      { fiscal_month: '2026-04', category_code: 601, amount: -1 },
      { fiscal_month: '2026-04', category_code: 601, amount: 1.5 },
      { fiscal_month: '2026-04', category_code: 601, amount: 10000001 },
      { fiscal_month: '2026-13', category_code: 601, amount: 1000 },
      { fiscal_month: '2026/04', category_code: 601, amount: 1000 },
      { fiscal_month: '2026-04', category_code: 601, amount: '1000' },
    ]
    for (const args of invalidArgs) {
      const res = await env.call('set_fixed_cost_cell', args)
      assert.equal(res.isError, true, `不正な入力は拒否されること: ${JSON.stringify(args)}`)
    }

    // 上限ちょうどは許可される
    const max = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-04',
      category_code: 601,
      amount: 10000000,
    })
    assert.ok(!max.isError, max.content[0].text)

    const rows = await env.dbAsync.all('SELECT * FROM transactions')
    assert.equal(rows.length, 1, '上限ちょうどの 1 件だけが登録されていること')
    assert.equal(rows[0].amount, 10000000)
  } finally {
    await env.teardown()
  }
})

// F4: 既存セルに重複行がある場合は更新せずエラーにすること
test('F4: set_fixed_cost_cell は同じセルに既存行が複数ある場合エラーにし、DB を変更しないこと', async () => {
  const env = await setupTestEnvironment()
  try {
    const id1 = await insertRow(env.dbAsync, {
      date: '2026-04-01',
      fiscal_month: '2026-04',
      amount: 5000,
      type: 'EXPENSE',
      category_code: 601,
      description: '取込1',
    })
    const id2 = await insertRow(env.dbAsync, {
      date: '2026-04-10',
      fiscal_month: '2026-04',
      amount: 6000,
      type: 'EXPENSE',
      category_code: 601,
      description: '取込2',
    })
    const before = await env.dbAsync.all('SELECT * FROM transactions ORDER BY id')

    for (const amount of [7000, 0]) {
      const res = await env.call('set_fixed_cost_cell', {
        fiscal_month: '2026-04',
        category_code: 601,
        amount,
      })
      assert.equal(res.isError, true)
      assert.match(
        res.content[0].text,
        new RegExp(
          `同じ会計月・費目の固定費明細が複数あります（ID: ${id1}, ${id2}）。固定入力画面で整理してください`
        )
      )
    }

    const after = await env.dbAsync.all('SELECT * FROM transactions ORDER BY id')
    assert.deepEqual(after, before, 'DB が変更されていないこと')
  } finally {
    await env.teardown()
  }
})

// F5: 同一セルへの並行 set で重複行ができないこと
test('F5: 同じセルへ set_fixed_cost_cell を並行 10 回呼んでも明細は 1 行のみであること', async () => {
  const env = await setupTestEnvironment()
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        env.call('set_fixed_cost_cell', {
          fiscal_month: '2026-05',
          category_code: 607,
          amount: 1000 + i,
        })
      )
    )
    for (const res of results) {
      assert.ok(!res.isError, res.content[0].text)
    }
    const statuses = results.map((r) => parse(r).status)
    assert.equal(statuses.filter((s) => s === 'created').length, 1, 'created は 1 回だけ')
    assert.equal(statuses.filter((s) => s === 'updated').length, 9, '残りは updated')

    const rows = await env.dbAsync.all(
      "SELECT * FROM transactions WHERE fiscal_month = '2026-05' AND category_code = 607 AND type = 'EXPENSE'"
    )
    assert.equal(rows.length, 1, 'セルの明細は 1 行のみであること')
  } finally {
    await env.teardown()
  }
})

// F6: add_salary_item の日付・既定摘要・複数行追加・入力拒否
test('F6: add_salary_item が前月 25 日・既定摘要で登録され、同月に複数追加できること', async () => {
  const env = await setupTestEnvironment()
  try {
    const first = await env.call('add_salary_item', { fiscal_month: '2026-05', amount: 300000 })
    assert.ok(!first.isError, first.content[0].text)
    const firstData = parse(first)
    assert.equal(firstData.date, '2026-04-25')
    assert.equal(firstData.fiscal_month, '2026-05')
    assert.equal(firstData.amount, 300000)
    assert.equal(firstData.type, 'INCOME')
    assert.equal(firstData.category_code, 700)
    assert.equal(firstData.category_name, '給与')
    assert.equal(firstData.description, '給与(固定入力)')
    assert.ok(firstData.id)
    assert.deepEqual(first.structuredContent, firstData)

    const second = await env.call('add_salary_item', {
      fiscal_month: '2026-05',
      amount: 50000,
      description: '副業',
    })
    assert.ok(!second.isError, second.content[0].text)
    assert.equal(parse(second).description, '副業')
    assert.equal(parse(second).date, '2026-04-25')

    // 1 月は前年 12 月 25 日
    const january = await env.call('add_salary_item', { fiscal_month: '2027-01', amount: 300000 })
    assert.ok(!january.isError, january.content[0].text)
    assert.equal(parse(january).date, '2026-12-25')
    assert.equal(parse(january).fiscal_month, '2027-01')

    const mayRows = await env.dbAsync.all(
      "SELECT * FROM transactions WHERE fiscal_month = '2026-05' AND type = 'INCOME' AND category_code = 700"
    )
    assert.equal(mayRows.length, 2, '同じ会計月に 2 件登録されていること')

    const invalidArgs = [
      { fiscal_month: '2026-05', amount: 0 },
      { fiscal_month: '2026-05', amount: -100 },
      { fiscal_month: '2026-05', amount: 1.5 },
      { fiscal_month: '2026-05', amount: 10000001 },
      { fiscal_month: '2026-5', amount: 1000 },
      { fiscal_month: '2026-05', amount: 1000, description: '' },
      { fiscal_month: '2026-05', amount: 1000, description: 'あ'.repeat(201) },
    ]
    for (const args of invalidArgs) {
      const res = await env.call('add_salary_item', args)
      assert.equal(res.isError, true, `不正な入力は拒否されること: ${JSON.stringify(args)}`)
    }

    // 200 文字ちょうどは許可される
    const maxDesc = await env.call('add_salary_item', {
      fiscal_month: '2026-06',
      amount: 1000,
      description: 'あ'.repeat(200),
    })
    assert.ok(!maxDesc.isError, maxDesc.content[0].text)

    assert.equal(await countRows(env.dbAsync), 4)
  } finally {
    await env.teardown()
  }
})

// F7: update_salary_item の部分更新・項目なし・給与以外・会計月不変
test('F7: update_salary_item が部分更新でき、給与以外の ID を拒否し、会計月・日付を変えないこと', async () => {
  const env = await setupTestEnvironment()
  try {
    const salaryId = await insertRow(env.dbAsync, {
      date: '2026-04-25',
      fiscal_month: '2026-05',
      amount: 300000,
      type: 'INCOME',
      category_code: 700,
      description: '本給',
    })
    const fixedId = await insertRow(env.dbAsync, {
      date: '2026-05-01',
      fiscal_month: '2026-05',
      amount: 80000,
      type: 'EXPENSE',
      category_code: 604,
      description: '固定費入力',
    })
    const bonusId = await insertRow(env.dbAsync, {
      date: '2026-05-10',
      fiscal_month: '2026-05',
      amount: 500000,
      type: 'INCOME',
      category_code: 701,
      description: 'ボーナス',
    })

    // 金額のみ
    const amountOnly = await env.call('update_salary_item', { id: salaryId, amount: 310000 })
    assert.ok(!amountOnly.isError, amountOnly.content[0].text)
    let data = parse(amountOnly)
    assert.equal(data.id, salaryId)
    assert.equal(data.amount, 310000)
    assert.equal(data.description, '本給', '摘要は既存値のまま')
    assert.equal(data.category_name, '給与')

    // 摘要のみ
    const descOnly = await env.call('update_salary_item', { id: salaryId, description: '本給改定' })
    assert.ok(!descOnly.isError, descOnly.content[0].text)
    data = parse(descOnly)
    assert.equal(data.amount, 310000, '金額は既存値のまま')
    assert.equal(data.description, '本給改定')

    // 両方
    const both = await env.call('update_salary_item', {
      id: salaryId,
      amount: 320000,
      description: '本給再改定',
    })
    assert.ok(!both.isError, both.content[0].text)
    data = parse(both)
    assert.equal(data.amount, 320000)
    assert.equal(data.description, '本給再改定')
    assert.equal(data.date, '2026-04-25', '日付は変わらない')
    assert.equal(data.fiscal_month, '2026-05', '会計月は変わらない')

    // 項目なし
    const empty = await env.call('update_salary_item', { id: salaryId })
    assert.equal(empty.isError, true)
    assert.match(empty.content[0].text, /更新項目が指定されていません/)

    // 給与以外・存在しない ID
    for (const id of [fixedId, bonusId, 999999]) {
      const res = await env.call('update_salary_item', { id, amount: 1000 })
      assert.equal(res.isError, true)
      assert.match(res.content[0].text, new RegExp(`指定された給与明細が見つかりません: ${id}`))
    }

    // 不正な値
    for (const args of [
      { id: salaryId, amount: 0 },
      { id: salaryId, amount: -1 },
      { id: salaryId, description: 'あ'.repeat(201) },
      { id: 0, amount: 1000 },
    ]) {
      const res = await env.call('update_salary_item', args)
      assert.equal(res.isError, true, `不正な入力は拒否されること: ${JSON.stringify(args)}`)
    }

    const fixed = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [fixedId])
    assert.equal(fixed.amount, 80000)
    const bonus = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [bonusId])
    assert.equal(bonus.amount, 500000)
    const salary = await env.dbAsync.get('SELECT * FROM transactions WHERE id = ?', [salaryId])
    assert.equal(salary.amount, 320000)
    assert.equal(salary.description, '本給再改定')
  } finally {
    await env.teardown()
  }
})

// F8: delete_salary_item の confirm 必須・給与以外拒否・削除前データ返却
test('F8: delete_salary_item は confirm: true 必須で、給与以外を拒否し、削除前データを返すこと', async () => {
  const env = await setupTestEnvironment()
  try {
    const salaryId = await insertRow(env.dbAsync, {
      date: '2026-04-25',
      fiscal_month: '2026-05',
      amount: 300000,
      type: 'INCOME',
      category_code: 700,
      description: '本給',
    })
    const fixedId = await insertRow(env.dbAsync, {
      date: '2026-05-01',
      fiscal_month: '2026-05',
      amount: 80000,
      type: 'EXPENSE',
      category_code: 604,
      description: '固定費入力',
    })

    const noConfirm = await env.call('delete_salary_item', { id: salaryId })
    assert.equal(noConfirm.isError, true)
    const falseConfirm = await env.call('delete_salary_item', { id: salaryId, confirm: false })
    assert.equal(falseConfirm.isError, true)
    assert.match(falseConfirm.content[0].text, /confirm: true を指定してください/)
    assert.equal(await countRows(env.dbAsync), 2)

    const notSalary = await env.call('delete_salary_item', { id: fixedId, confirm: true })
    assert.equal(notSalary.isError, true)
    assert.match(
      notSalary.content[0].text,
      new RegExp(`指定された給与明細が見つかりません: ${fixedId}`)
    )
    assert.equal(await countRows(env.dbAsync), 2)

    const deleted = await env.call('delete_salary_item', { id: salaryId, confirm: true })
    assert.ok(!deleted.isError, deleted.content[0].text)
    const data = parse(deleted)
    assert.deepEqual(data, {
      deleted_transaction: {
        id: salaryId,
        date: '2026-04-25',
        fiscal_month: '2026-05',
        amount: 300000,
        type: 'INCOME',
        category_code: 700,
        category_name: '給与',
        description: '本給',
        memo: null,
      },
    })
    assert.deepEqual(deleted.structuredContent, data)

    const again = await env.call('delete_salary_item', { id: salaryId, confirm: true })
    assert.equal(again.isError, true)
    assert.match(again.content[0].text, /指定された給与明細が見つかりません/)

    const remaining = await env.dbAsync.all('SELECT id FROM transactions')
    assert.deepEqual(
      remaining.map((r) => r.id),
      [fixedId]
    )
  } finally {
    await env.teardown()
  }
})

// F9: 専用ツールの結果が get_fixed_costs に反映されること
test('F9: 専用ツールでの登録・更新・削除が get_fixed_costs の結果に反映されること', async () => {
  const env = await setupTestEnvironment()
  try {
    await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-06',
      category_code: 601,
      amount: 7000,
    })
    await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-06',
      category_code: 901,
      amount: 30000,
    })
    const salary1 = parse(
      await env.call('add_salary_item', { fiscal_month: '2026-06', amount: 300000 })
    )
    const salary2 = parse(
      await env.call('add_salary_item', {
        fiscal_month: '2026-06',
        amount: 20000,
        description: '手当',
      })
    )
    await env.call('update_salary_item', { id: salary1.id, amount: 305000 })
    await env.call('delete_salary_item', { id: salary2.id, confirm: true })
    await env.call('set_fixed_cost_cell', {
      fiscal_month: '2026-06',
      category_code: 901,
      amount: 0,
    })

    const res = await env.call('get_fixed_costs', { year: 2026 })
    assert.ok(!res.isError, res.content[0].text)
    const rows = parse(res).data
    const simplified = rows
      .map((r) => ({
        fiscal_month: r.fiscal_month,
        category_code: r.category_code,
        type: r.type,
        amount: r.amount,
      }))
      .sort((a, b) => a.category_code - b.category_code)
    assert.deepEqual(simplified, [
      { fiscal_month: '2026-06', category_code: 601, type: 'EXPENSE', amount: 7000 },
      { fiscal_month: '2026-06', category_code: 700, type: 'INCOME', amount: 305000 },
    ])
  } finally {
    await env.teardown()
  }
})

// F10: 書き込み系ツールの会計月は 2000〜2999 年に限定されること（REST の isValidYear と同じ範囲）
test('F10: set_fixed_cost_cell / add_salary_item は 2000〜2999 年以外の会計月を拒否すること', async () => {
  const env = await setupTestEnvironment()
  try {
    for (const fiscal_month of ['0000-01', '1999-12', '3000-01']) {
      const setRes = await env.call('set_fixed_cost_cell', {
        fiscal_month,
        category_code: 601,
        amount: 1000,
      })
      assert.equal(setRes.isError, true, `set_fixed_cost_cell: ${fiscal_month} は拒否されること`)
      assert.match(setRes.content[0].text, /会計月の年は2000〜2999年の範囲で指定してください/)

      const addRes = await env.call('add_salary_item', { fiscal_month, amount: 1000 })
      assert.equal(addRes.isError, true, `add_salary_item: ${fiscal_month} は拒否されること`)
      assert.match(addRes.content[0].text, /会計月の年は2000〜2999年の範囲で指定してください/)
    }
    assert.equal(await countRows(env.dbAsync), 0)

    // 境界: 2000-01 と 2999-12 は許可される。2000-01 の給与日付は前月 25 日の 1999-12-25（REST と同じ）
    const lowerSalary = await env.call('add_salary_item', { fiscal_month: '2000-01', amount: 1000 })
    assert.ok(!lowerSalary.isError, lowerSalary.content[0].text)
    assert.equal(parse(lowerSalary).date, '1999-12-25')
    assert.equal(parse(lowerSalary).fiscal_month, '2000-01')

    const upperSalary = await env.call('add_salary_item', { fiscal_month: '2999-12', amount: 1000 })
    assert.ok(!upperSalary.isError, upperSalary.content[0].text)
    assert.equal(parse(upperSalary).date, '2999-11-25')

    const lowerCell = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2000-01',
      category_code: 601,
      amount: 1000,
    })
    assert.ok(!lowerCell.isError, lowerCell.content[0].text)
    assert.equal(parse(lowerCell).transaction.date, '2000-01-01')

    const upperCell = await env.call('set_fixed_cost_cell', {
      fiscal_month: '2999-12',
      category_code: 601,
      amount: 1000,
    })
    assert.ok(!upperCell.isError, upperCell.content[0].text)
    assert.equal(parse(upperCell).transaction.date, '2999-12-01')

    assert.equal(await countRows(env.dbAsync), 4)
  } finally {
    await env.teardown()
  }
})
