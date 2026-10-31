const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')
const fs = require('fs')

// ルートは require('../db') で共有 db を直接使うため、require 前に DB_PATH を一時ファイルへ向けて本番の household.db を保護する
const tempDbPath = path.join(
  os.tmpdir(),
  `fixed-costs-routes-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
)
process.env.DB_PATH = tempDbPath

const { express, startServer } = require('./mcp-helpers')
const db = require('../../server/db')
const { createDbAsync } = require('../../server/lib/dbAsync')
const fixedCostsRouter = require('../../server/routes/fixed_costs')

const dbAsync = createDbAsync(db)
let baseUrl
let closeServer

test.before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/fixed_costs', fixedCostsRouter)
  const started = await startServer(app)
  baseUrl = started.baseUrl
  closeServer = started.close
})

test.after(async () => {
  if (closeServer) await closeServer()
  await new Promise((resolve) => db.close(() => resolve()))
  for (const file of [tempDbPath, `${tempDbPath}-wal`, `${tempDbPath}-shm`]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch {
      // 一時ファイルの削除失敗は無視
    }
  }
})

test.beforeEach(async () => {
  await dbAsync.run('DELETE FROM transactions')
})

async function request(method, urlPath, body) {
  const res = await fetch(`${baseUrl}/api/fixed_costs${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function insertRow({ date, fiscal_month, amount, type, category_code, description }) {
  const result = await dbAsync.run(
    'INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) VALUES (?, ?, ?, ?, ?, ?)',
    [date, fiscal_month, amount, type, category_code, description]
  )
  return result.lastID
}

// R1: update_cell の必須項目不足と給与コードの拒否
test('R1: update_cell は必須項目不足と INCOME/700 を 400 で拒否する（レスポンス形不変）', async () => {
  const missing = await request('POST', '/update_cell', { year: 2027, month: 4 })
  assert.equal(missing.status, 400)
  assert.deepEqual(missing.body, { error: 'Missing required fields' })

  const salary = await request('POST', '/update_cell', {
    year: 2027,
    month: 4,
    category_code: 700,
    amount: 300000,
    type: 'INCOME',
  })
  assert.equal(salary.status, 400)
  assert.deepEqual(salary.body, { error: 'Use /fixed_costs/salary endpoints for salary rows' })

  const count = await dbAsync.get('SELECT COUNT(*) AS c FROM transactions')
  assert.equal(count.c, 0)
})

// R2: update_cell の created → updated → deleted → ignored のレスポンス形
test('R2: update_cell の created / updated / deleted / ignored のレスポンス形が従来どおりであること', async () => {
  const created = await request('POST', '/update_cell', {
    year: 2027,
    month: 4,
    category_code: 601,
    amount: 5000,
  })
  assert.equal(created.status, 200)
  assert.deepEqual(Object.keys(created.body).sort(), ['id', 'status'])
  assert.equal(created.body.status, 'created')
  assert.equal(typeof created.body.id, 'number')

  const row = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [created.body.id])
  assert.equal(row.date, '2027-04-01')
  assert.equal(row.fiscal_month, '2027-04')
  assert.equal(row.amount, 5000)
  assert.equal(row.type, 'EXPENSE')
  assert.equal(row.description, '固定費入力')

  // 文字列の金額もそのまま保存される（REST の緩い挙動を維持）
  const updated = await request('POST', '/update_cell', {
    year: 2027,
    month: 4,
    category_code: 601,
    amount: '6000',
  })
  assert.equal(updated.status, 200)
  assert.deepEqual(updated.body, { status: 'updated' })
  const updatedRow = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [created.body.id])
  assert.equal(updatedRow.amount, 6000)

  const deleted = await request('POST', '/update_cell', {
    year: 2027,
    month: 4,
    category_code: 601,
    amount: '0',
  })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body, { status: 'deleted' })

  const ignored = await request('POST', '/update_cell', {
    year: 2027,
    month: 4,
    category_code: 601,
    amount: '',
  })
  assert.equal(ignored.status, 200)
  assert.deepEqual(ignored.body, { status: 'ignored' })

  const count = await dbAsync.get('SELECT COUNT(*) AS c FROM transactions')
  assert.equal(count.c, 0)
})

// R3: 既存行が複数ある場合、REST は従来どおり先頭行（id が小さい行）を更新する
test('R3: update_cell は同じセルに複数行がある場合も先頭行を更新する（REST は従来挙動）', async () => {
  const firstId = await insertRow({
    date: '2027-04-01',
    fiscal_month: '2027-04',
    amount: 1000,
    type: 'EXPENSE',
    category_code: 602,
    description: '取込1',
  })
  const secondId = await insertRow({
    date: '2027-04-01',
    fiscal_month: '2027-04',
    amount: 2000,
    type: 'EXPENSE',
    category_code: 602,
    description: '取込2',
  })

  const res = await request('POST', '/update_cell', {
    year: 2027,
    month: 4,
    category_code: 602,
    amount: 3000,
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { status: 'updated' })

  const first = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [firstId])
  const second = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [secondId])
  assert.equal(first.amount, 3000)
  assert.equal(first.description, '固定費入力')
  assert.equal(second.amount, 2000)
})

// R4: 給与の追加 (POST /salary)
test('R4: POST /salary のバリデーションと created レスポンス', async () => {
  const badYear = await request('POST', '/salary', { year: 1999, month: 1, amount: 1000 })
  assert.equal(badYear.status, 400)
  assert.deepEqual(badYear.body, { error: 'year must be an integer between 2000 and 2999' })

  const badMonth = await request('POST', '/salary', { year: 2027, month: 13, amount: 1000 })
  assert.equal(badMonth.status, 400)
  assert.deepEqual(badMonth.body, { error: 'month must be an integer between 1 and 12' })

  const badAmount = await request('POST', '/salary', { year: 2027, month: 1, amount: 0 })
  assert.equal(badAmount.status, 400)
  assert.deepEqual(badAmount.body, { error: 'amount must be a positive integer' })

  const badDesc = await request('POST', '/salary', {
    year: 2027,
    month: 1,
    amount: 1000,
    description: 'あ'.repeat(201),
  })
  assert.equal(badDesc.status, 400)
  assert.deepEqual(badDesc.body, { error: 'description must be a string of at most 200 chars' })

  const created = await request('POST', '/salary', { year: 2027, month: 1, amount: '300000' })
  assert.equal(created.status, 200)
  assert.deepEqual(Object.keys(created.body).sort(), ['id', 'status'])
  assert.equal(created.body.status, 'created')

  const row = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [created.body.id])
  assert.equal(row.date, '2026-12-25')
  assert.equal(row.fiscal_month, '2027-01')
  assert.equal(row.amount, 300000)
  assert.equal(row.type, 'INCOME')
  assert.equal(row.category_code, 700)
  assert.equal(row.description, '給与(固定入力)')
})

// R5: 給与の更新 (PUT /salary/:id)
test('R5: PUT /salary/:id のバリデーション・404・updated レスポンス', async () => {
  const salaryId = await insertRow({
    date: '2027-03-25',
    fiscal_month: '2027-04',
    amount: 300000,
    type: 'INCOME',
    category_code: 700,
    description: '本給',
  })
  const expenseId = await insertRow({
    date: '2027-04-01',
    fiscal_month: '2027-04',
    amount: 5000,
    type: 'EXPENSE',
    category_code: 601,
    description: '固定費入力',
  })

  const badId = await request('PUT', '/salary/abc', { amount: 1000 })
  assert.equal(badId.status, 400)
  assert.deepEqual(badId.body, { error: 'invalid id' })

  const noAmount = await request('PUT', `/salary/${salaryId}`, { description: 'x' })
  assert.equal(noAmount.status, 400)
  assert.deepEqual(noAmount.body, { error: 'amount must be a positive integer' })

  const notSalary = await request('PUT', `/salary/${expenseId}`, { amount: 1000 })
  assert.equal(notSalary.status, 404)
  assert.deepEqual(notSalary.body, { error: 'salary row not found' })

  const notFound = await request('PUT', '/salary/999999', { amount: 1000 })
  assert.equal(notFound.status, 404)
  assert.deepEqual(notFound.body, { error: 'salary row not found' })

  const updated = await request('PUT', `/salary/${salaryId}`, {
    amount: 310000,
    description: '本給(改定)',
  })
  assert.equal(updated.status, 200)
  assert.deepEqual(updated.body, { status: 'updated' })
  let row = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [salaryId])
  assert.equal(row.amount, 310000)
  assert.equal(row.description, '本給(改定)')
  assert.equal(row.date, '2027-03-25')
  assert.equal(row.fiscal_month, '2027-04')

  // 摘要を省略すると既定値で上書きされる（REST の従来挙動）
  const omitted = await request('PUT', `/salary/${salaryId}`, { amount: 320000 })
  assert.equal(omitted.status, 200)
  assert.deepEqual(omitted.body, { status: 'updated' })
  row = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [salaryId])
  assert.equal(row.amount, 320000)
  assert.equal(row.description, '給与(固定入力)')

  // 給与以外の行は書き換わっていない
  const expense = await dbAsync.get('SELECT * FROM transactions WHERE id = ?', [expenseId])
  assert.equal(expense.amount, 5000)
})

// R6: 給与の削除 (DELETE /salary/:id)
test('R6: DELETE /salary/:id のバリデーション・404・deleted レスポンス', async () => {
  const salaryId = await insertRow({
    date: '2027-03-25',
    fiscal_month: '2027-04',
    amount: 300000,
    type: 'INCOME',
    category_code: 700,
    description: '本給',
  })
  const expenseId = await insertRow({
    date: '2027-04-01',
    fiscal_month: '2027-04',
    amount: 5000,
    type: 'EXPENSE',
    category_code: 601,
    description: '固定費入力',
  })

  const badId = await request('DELETE', '/salary/0')
  assert.equal(badId.status, 400)
  assert.deepEqual(badId.body, { error: 'invalid id' })

  const notSalary = await request('DELETE', `/salary/${expenseId}`)
  assert.equal(notSalary.status, 404)
  assert.deepEqual(notSalary.body, { error: 'salary row not found' })

  const deleted = await request('DELETE', `/salary/${salaryId}`)
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body, { status: 'deleted' })

  const again = await request('DELETE', `/salary/${salaryId}`)
  assert.equal(again.status, 404)
  assert.deepEqual(again.body, { error: 'salary row not found' })

  const remaining = await dbAsync.all('SELECT id FROM transactions')
  assert.deepEqual(
    remaining.map((r) => r.id),
    [expenseId]
  )
})

// R7: batch_update のレスポンス形と給与の拒否
test('R7: batch_update のレスポンス形と INCOME/700 の拒否が従来どおりであること', async () => {
  const ok = await request('POST', '/batch_update', {
    year: 2027,
    cells: [
      { month: 4, category_code: 601, amount: 5000 },
      { month: 5, category_code: 601, amount: 0 },
    ],
  })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { message: 'Batch update completed', count: 2 })

  const salary = await request('POST', '/batch_update', {
    year: 2027,
    cells: [{ month: 4, category_code: 700, amount: 300000, type: 'INCOME' }],
  })
  assert.equal(salary.status, 400)
  assert.deepEqual(salary.body, { error: 'Use /fixed_costs/salary endpoints for salary rows' })

  const rows = await dbAsync.all('SELECT * FROM transactions')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].date, '2027-04-01')
})
