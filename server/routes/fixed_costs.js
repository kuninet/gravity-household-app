const express = require('express')
const router = express.Router()
const db = require('../db')

// 給与・固定費関連の定数は fixedCostCodes に集約
const { isFixedIncome } = require('../lib/fixedCostCodes')
// 書き込みロジックは fixedCostService に集約し、MCP の専用ツールと共有する
const {
  getFixedCostMatrix,
  setFixedCostCell,
  addSalaryItem,
  updateSalaryItem,
  deleteSalaryItem,
  resolveInsertDate,
  resolveDescription,
  normalizeSalaryDescription,
  isClearAmount,
} = require('../services/fixedCostService')

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0
}

function isValidMonth(v) {
  return Number.isInteger(v) && v >= 1 && v <= 12
}

function isValidYear(v) {
  return Number.isInteger(v) && v >= 2000 && v <= 2999
}

// リクエスト body の amount を数値に正規化する。
// 数値/文字列いずれで来ても Number 変換した結果が正の整数であること。
// (update_cell が文字列 raw を送るパターンとの整合を保つ)
function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'boolean') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (!isPositiveInt(n)) return null
  return n
}

// Get matrix data for a specific year
router.get('/matrix', async (req, res) => {
  try {
    const result = await getFixedCostMatrix(db, req.query)
    res.json(result)
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: err.message })
  }
})

// Bulk update/insert for a specific cell (Year-Month + Category)
router.post('/update_cell', async (req, res) => {
  const { year, month, category_code, amount } = req.body
  const type = req.body.type || 'EXPENSE'

  if (!year || !month || !category_code) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // 給与 (INCOME/700) は複数明細対応の専用エンドポイントに誘導する。
  // update_cell は (fiscal_month, category_code, type) で 1 行に集約してしまうため、
  // 複数明細を許容する給与では使えない。
  if (type === 'INCOME' && isFixedIncome(category_code)) {
    return res.status(400).json({ error: 'Use /fixed_costs/salary endpoints for salary rows' })
  }

  const fiscal_month = `${year}-${String(month).padStart(2, '0')}`

  try {
    // REST は従来どおり amount を検証せずそのまま渡し、既存行が複数あれば先頭行を対象にする
    const result = await setFixedCostCell(db, { fiscal_month, category_code, amount, type })
    if (result.status === 'created') {
      return res.json({ status: 'created', id: result.id })
    }
    res.json({ status: result.status })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/batch_update', async (req, res) => {
  const { year, cells } = req.body // cells: [{ month, category_code, amount, type }]

  if (!year || !cells || !Array.isArray(cells)) {
    return res.status(400).json({ error: 'Invalid data format' })
  }

  const dbRun = (sql, params) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err)
        else resolve(this)
      })
    })

  const dbGet = (sql, params) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })

  try {
    await dbRun('BEGIN TRANSACTION')

    let processedCount = 0

    for (const cell of cells) {
      const { month, category_code, amount } = cell
      const type = cell.type || 'EXPENSE'

      // 給与 (INCOME/700) は複数明細対応の専用エンドポイント経由でのみ書き換え可能。
      if (type === 'INCOME' && isFixedIncome(category_code)) {
        await dbRun('ROLLBACK')
        return res.status(400).json({ error: 'Use /fixed_costs/salary endpoints for salary rows' })
      }

      const fiscal_month = `${year}-${String(month).padStart(2, '0')}`

      const row = await dbGet(
        'SELECT id FROM transactions WHERE fiscal_month = ? AND category_code = ? AND type = ?',
        [fiscal_month, category_code, type]
      )

      if (isClearAmount(amount)) {
        if (row) {
          await dbRun('DELETE FROM transactions WHERE id = ?', [row.id])
        }
      } else {
        const insertDate = resolveInsertDate(fiscal_month, type)
        const description = resolveDescription(type)
        if (row) {
          await dbRun(
            'UPDATE transactions SET amount = ?, date = ?, description = ? WHERE id = ?',
            [amount, insertDate, description, row.id]
          )
        } else {
          await dbRun(
            `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
                         VALUES (?, ?, ?, ?, ?, ?)`,
            [insertDate, fiscal_month, amount, type, category_code, description]
          )
        }
      }
      processedCount++
    }

    await dbRun('COMMIT')
    res.json({ message: 'Batch update completed', count: processedCount })
  } catch (err) {
    try {
      await dbRun('ROLLBACK')
    } catch (e) {
      console.error('Rollback failed:', e)
    }
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// 給与 (INCOME/700) 専用エンドポイント: 1 会計月に複数明細を許容するため、
// (fiscal_month, category_code, type) の一意化を前提とする update_cell 系とは
// 別ルートで id ベースの CRUD を提供する。
// ---------------------------------------------------------------------------

// POST /fixed_costs/salary : 給与明細を 1 行追加
router.post('/salary', async (req, res) => {
  const { year, month, description } = req.body || {}

  if (!isValidYear(year)) {
    return res.status(400).json({ error: 'year must be an integer between 2000 and 2999' })
  }
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: 'month must be an integer between 1 and 12' })
  }
  const amount = parseAmount(req.body ? req.body.amount : undefined)
  if (amount === null) {
    return res.status(400).json({ error: 'amount must be a positive integer' })
  }
  const desc = normalizeSalaryDescription(description)
  if (desc === null) {
    return res.status(400).json({ error: 'description must be a string of at most 200 chars' })
  }

  const fiscal_month = `${year}-${String(month).padStart(2, '0')}`

  try {
    const created = await addSalaryItem(db, { fiscal_month, amount, description: desc })
    res.json({ status: 'created', id: created.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /fixed_costs/salary/:id : 給与明細の金額/摘要を更新 (会計月は変更不可)
router.put('/salary/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!isPositiveInt(id)) {
    return res.status(400).json({ error: 'invalid id' })
  }
  const { description } = req.body || {}
  const amount = parseAmount(req.body ? req.body.amount : undefined)
  if (amount === null) {
    return res.status(400).json({ error: 'amount must be a positive integer' })
  }
  // REST では摘要の省略・空文字を既定値で上書きする (現行踏襲)
  const desc = normalizeSalaryDescription(description)
  if (desc === null) {
    return res.status(400).json({ error: 'description must be a string of at most 200 chars' })
  }

  try {
    // 給与行以外は null (=404)。月変更は削除+追加で行う仕様のため date/fiscal_month は触らない
    const updated = await updateSalaryItem(db, id, { amount, description: desc })
    if (!updated) {
      return res.status(404).json({ error: 'salary row not found' })
    }
    res.json({ status: 'updated' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /fixed_costs/salary/:id : 給与明細を削除
router.delete('/salary/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!isPositiveInt(id)) {
    return res.status(400).json({ error: 'invalid id' })
  }

  try {
    // 給与行以外・SELECT 後の競合削除はいずれも null (=404)
    const deleted = await deleteSalaryItem(db, id)
    if (!deleted) {
      return res.status(404).json({ error: 'salary row not found' })
    }
    res.json({ status: 'deleted' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
