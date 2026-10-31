const {
  EXPENSE_FIXED_CODES,
  INCOME_FIXED_CODES,
  SALARY_CATEGORY_CODE,
  SALARY_TYPE,
  SALARY_DEFAULT_DESCRIPTION,
  SALARY_DESCRIPTION_MAX_LENGTH,
  isFixedIncome,
} = require('../lib/fixedCostCodes')
const { createDbAsync } = require('../lib/dbAsync')
const { runInWriteTransaction } = require('../lib/dbTransaction')
// 返却する明細の形は MCP の getTransaction と共通（category_name を含む）
const { selectTransactionRow } = require('../lib/transactionRow')

// INSERT 時の date を決定する。
// EXPENSE: 会計月の 01 日 (現行踏襲)。
// INCOME: 会計月の前月 25 日。25 日は fiscal_month の切替 (23 日基点) の後側なので
// getFiscalMonth(date) と fiscal_month が一致する。
function resolveInsertDate(fiscalMonth, type) {
  if (type === 'INCOME') {
    const [y, m] = fiscalMonth.split('-').map(Number)
    let py = y
    let pm = m - 1
    if (pm < 1) {
      pm = 12
      py -= 1
    }
    return `${py}-${String(pm).padStart(2, '0')}-25`
  }
  return `${fiscalMonth}-01`
}

function resolveDescription(type) {
  return type === 'INCOME' ? SALARY_DEFAULT_DESCRIPTION : '固定費入力'
}

// 給与の摘要を正規化する。未指定・空文字は既定値、不正値（文字列以外・上限超過）は null を返す。
function normalizeSalaryDescription(desc) {
  if (desc === undefined || desc === null || desc === '') {
    return SALARY_DEFAULT_DESCRIPTION
  }
  if (typeof desc !== 'string') return null
  if (desc.length > SALARY_DESCRIPTION_MAX_LENGTH) return null
  return desc
}

// 固定入力セルの「削除」とみなす金額 (REST update_cell / batch_update の現行判定を踏襲)
function isClearAmount(amount) {
  return amount === '' || amount === null || amount === 0 || amount === '0'
}

function isSalaryRow(row) {
  return Boolean(row) && row.category_code === SALARY_CATEGORY_CODE && row.type === SALARY_TYPE
}

function createError(message, statusCode) {
  const err = new Error(message)
  if (statusCode) err.statusCode = statusCode
  return err
}

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

/**
 * 固定入力セル (fiscal_month, category_code, type) の値を設定する。
 * 金額が '' / null / 0 / '0' のときはセルを削除し、それ以外は既存行の更新または新規作成を行う。
 * SELECT から書き込みまでを直列化キュー＋専用接続＋BEGIN IMMEDIATE で囲み、
 * 同時実行で同じセルに重複行ができないようにする。
 *
 * 金額・費目コードの形式検証は呼び出し側で行う（REST は現行の緩い挙動を維持し、MCP は zod で厳格に検証する）。
 * @param {import('sqlite3').Database} db
 * @param {object} cell
 * @param {string} cell.fiscal_month - 会計月 (YYYY-MM)
 * @param {number|string} cell.category_code - 費目コード
 * @param {number|string|null} cell.amount - 金額（'' / null / 0 / '0' はセル削除）
 * @param {string} [cell.type='EXPENSE'] - 収支区分
 * @param {object} [options]
 * @param {boolean} [options.strict=false] - true のとき、カテゴリの存在確認を行い、対象セルの既存行が複数ある場合はエラーにする。
 *   false のときは従来どおり先頭行（id 昇順）を対象にする。
 * @returns {Promise<{ status: 'created'|'updated'|'deleted'|'ignored', id?: number, previous_amount: number|null, transaction?: object }>}
 */
async function setFixedCostCell(db, cell, { strict = false } = {}) {
  const { fiscal_month, category_code, amount } = cell || {}
  const type = (cell && cell.type) || 'EXPENSE'

  // 給与は 1 会計月に複数明細を持てるため、セル単位の upsert では扱わない
  if (type === 'INCOME' && isFixedIncome(category_code)) {
    throw createError('Use /fixed_costs/salary endpoints for salary rows', 400)
  }

  return await runInWriteTransaction(db, async (txDb) => {
    if (strict) {
      const cat = await txDb.get('SELECT code FROM categories WHERE code = ?', [category_code])
      if (!cat) {
        throw createError(`存在しない費目コードです: ${category_code}`, 400)
      }
    }

    // (fiscal_month, category_code, type) で一意化。type が変わればそれは別レコード扱い
    // (逆 type の既存行を巻き込むと Analysis/Summary で誤分類されるため)。
    const rows =
      (await txDb.all(
        'SELECT id, amount FROM transactions WHERE fiscal_month = ? AND category_code = ? AND type = ? ORDER BY id ASC',
        [fiscal_month, category_code, type]
      )) || []

    if (strict && rows.length > 1) {
      throw createError(
        `同じ会計月・費目の固定費明細が複数あります（ID: ${rows.map((r) => r.id).join(', ')}）。固定入力画面で整理してください`,
        409
      )
    }

    const row = rows[0]
    const previous_amount = row ? row.amount : null

    if (isClearAmount(amount)) {
      if (!row) {
        return { status: 'ignored', previous_amount }
      }
      await txDb.run('DELETE FROM transactions WHERE id = ?', [row.id])
      return { status: 'deleted', id: row.id, previous_amount }
    }

    const insertDate = resolveInsertDate(fiscal_month, type)
    const description = resolveDescription(type)
    if (row) {
      // 既存行の date/description が古い type の値のまま残らないよう毎回上書き
      await txDb.run('UPDATE transactions SET amount = ?, date = ?, description = ? WHERE id = ?', [
        amount,
        insertDate,
        description,
        row.id,
      ])
      return {
        status: 'updated',
        id: row.id,
        previous_amount,
        transaction: await selectTransactionRow(txDb, row.id),
      }
    }

    const result = await txDb.run(
      `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [insertDate, fiscal_month, amount, type, category_code, description]
    )
    return {
      status: 'created',
      id: result.lastID,
      previous_amount,
      transaction: await selectTransactionRow(txDb, result.lastID),
    }
  })
}

/**
 * 給与明細 (INCOME/700) を 1 行追加する。日付は会計月の前月 25 日。
 * 金額の形式検証は呼び出し側で行う。
 * @param {import('sqlite3').Database} db
 * @param {object} item
 * @param {string} item.fiscal_month - 会計月 (YYYY-MM)
 * @param {number} item.amount - 金額
 * @param {string} [item.description] - 摘要（省略・空文字は既定値「給与(固定入力)」）
 * @returns {Promise<object>} 作成された明細（category_name 含む）
 */
async function addSalaryItem(db, { fiscal_month, amount, description } = {}) {
  const desc = normalizeSalaryDescription(description)
  if (desc === null) {
    throw createError('description must be a string of at most 200 chars', 400)
  }
  const insertDate = resolveInsertDate(fiscal_month, SALARY_TYPE)

  const dbAsync = createDbAsync(db)
  const result = await dbAsync.run(
    `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
    [insertDate, fiscal_month, amount, SALARY_TYPE, SALARY_CATEGORY_CODE, desc]
  )
  return await selectTransactionRow(dbAsync, result.lastID)
}

/**
 * 給与明細 (INCOME/700) の金額・摘要を更新する。会計月・日付は変更しない（月の付け替えは削除＋追加で行う）。
 * 未指定 (undefined) の項目は既存値のまま保持する。値の形式検証は呼び出し側で行う。
 * @param {import('sqlite3').Database} db
 * @param {number} id - 明細 ID
 * @param {object} fields
 * @param {number} [fields.amount]
 * @param {string} [fields.description]
 * @returns {Promise<object|null>} 更新後の明細。給与明細が見つからない場合は null
 */
async function updateSalaryItem(db, id, { amount, description } = {}) {
  const sets = []
  const params = []
  if (amount !== undefined) {
    sets.push('amount = ?')
    params.push(amount)
  }
  if (description !== undefined) {
    sets.push('description = ?')
    params.push(description)
  }
  if (sets.length === 0) {
    throw createError('更新項目が指定されていません', 400)
  }

  const dbAsync = createDbAsync(db)
  // 給与行以外を書き換えないよう type/category_code を検証
  const existing = await selectTransactionRow(dbAsync, id)
  if (!isSalaryRow(existing)) {
    return null
  }

  const result = await dbAsync.run(
    `UPDATE transactions SET ${sets.join(', ')} WHERE id = ? AND type = ? AND category_code = ?`,
    [...params, id, SALARY_TYPE, SALARY_CATEGORY_CODE]
  )
  // SELECT 後の競合削除に備え、書換 0 行も「見つからない」として扱う
  if (result.changes === 0) {
    return null
  }
  return await selectTransactionRow(dbAsync, id)
}

/**
 * 給与明細 (INCOME/700) を削除する。
 * @param {import('sqlite3').Database} db
 * @param {number} id - 明細 ID
 * @returns {Promise<object|null>} 削除前の明細。給与明細が見つからない場合は null
 */
async function deleteSalaryItem(db, id) {
  const dbAsync = createDbAsync(db)
  const existing = await selectTransactionRow(dbAsync, id)
  if (!isSalaryRow(existing)) {
    return null
  }
  const result = await dbAsync.run(
    'DELETE FROM transactions WHERE id = ? AND type = ? AND category_code = ?',
    [id, SALARY_TYPE, SALARY_CATEGORY_CODE]
  )
  // SELECT 後の競合削除に備え、書換 0 行も「見つからない」として扱う
  if (result.changes === 0) {
    return null
  }
  return existing
}

module.exports = {
  getFixedCostMatrix,
  setFixedCostCell,
  addSalaryItem,
  updateSalaryItem,
  deleteSalaryItem,
  resolveInsertDate,
  resolveDescription,
  normalizeSalaryDescription,
  isClearAmount,
}
