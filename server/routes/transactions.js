const express = require('express')
const router = express.Router()
const db = require('../db')

// Helper to calculate fiscal month (23rd start)
function getFiscalMonth(dateStr) {
  const date = new Date(dateStr)
  const day = date.getDate()
  let year = date.getFullYear()
  let month = date.getMonth() + 1 // 0-indexed

  if (day >= 23) {
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return `${year}-${String(month).padStart(2, '0')}`
}

const FIXED_COST_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608]

// Get transactions (optional filter by fiscal_month)
router.get('/', (req, res) => {
  const { month, type } = req.query
  let sql = 'SELECT * FROM transactions'
  const params = []

  if (type === 'recent') {
    const placeholders = FIXED_COST_CODES.map(() => '?').join(',')
    sql += ` WHERE category_code NOT IN (${placeholders})`
    params.push(...FIXED_COST_CODES)
    sql += ' ORDER BY id DESC LIMIT 6'
  } else {
    if (month) {
      sql += ' WHERE fiscal_month = ?'
      params.push(month)
    }
    sql += ' ORDER BY date DESC, id DESC'
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message })
      return
    }
    res.json({ data: rows })
  })
})

// Create transaction
router.post('/', (req, res) => {
  const { date, amount, type, category_code, description, memo } = req.body

  if (!date || !amount || !type) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const fiscal_month = getFiscalMonth(date)

  const sql = `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
  const params = [date, fiscal_month, amount, type, category_code, description, memo]

  db.run(sql, params, function (err) {
    if (err) {
      res.status(500).json({ error: err.message })
      return
    }
    res.json({
      message: 'Transaction created',
      data: { id: this.lastID, ...req.body, fiscal_month },
    })
  })
})

// Create transactions in batch
router.post('/batch', (req, res) => {
  const { transactions } = req.body

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'transactions must be a non-empty array' })
  }

  for (const tx of transactions) {
    if (!tx.date || typeof tx.amount !== 'number' || tx.amount === 0 || !tx.type) {
      return res.status(400).json({ error: 'Missing or invalid required fields in transaction' })
    }
  }

  const inserted = []
  db.serialize(() => {
    db.run('BEGIN TRANSACTION', (beginErr) => {
      if (beginErr) {
        return res.status(500).json({ error: beginErr.message })
      }

      const sql = `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`
      const stmt = db.prepare(sql)
      let hasError = false

      for (const tx of transactions) {
        const fiscal_month = getFiscalMonth(tx.date)
        const params = [
          tx.date,
          fiscal_month,
          tx.amount,
          tx.type,
          tx.category_code ?? null,
          tx.description ?? '',
          tx.memo ?? '',
        ]

        stmt.run(params, function (err) {
          if (err) {
            hasError = true
          } else {
            inserted.push({ id: this.lastID, ...tx, fiscal_month })
          }
        })
      }

      stmt.finalize((finalizeErr) => {
        if (hasError || finalizeErr) {
          db.run('ROLLBACK', () => {
            res.status(500).json({ error: 'Failed to insert transactions in batch' })
          })
        } else {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              db.run('ROLLBACK', () => {
                res.status(500).json({ error: commitErr.message })
              })
            } else {
              res.json({
                message: 'Transactions created',
                count: inserted.length,
                data: inserted,
              })
            }
          })
        }
      })
    })
  })
})

// Update transaction
router.put('/:id', (req, res) => {
  const { date, amount, type, category_code, description, memo } = req.body
  const id = req.params.id

  if (!date || !amount || !type) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const fiscal_month = getFiscalMonth(date)

  const sql = `UPDATE transactions 
                 SET date = ?, fiscal_month = ?, amount = ?, type = ?, category_code = ?, description = ?, memo = ?
                 WHERE id = ?`
  const params = [date, fiscal_month, amount, type, category_code, description, memo, id]

  db.run(sql, params, function (err) {
    if (err) {
      res.status(500).json({ error: err.message })
      return
    }
    res.json({
      message: 'Transaction updated',
      changes: this.changes,
      data: { id, ...req.body, fiscal_month },
    })
  })
})

// Delete transaction
router.delete('/:id', (req, res) => {
  const sql = 'DELETE FROM transactions WHERE id = ?'
  db.run(sql, req.params.id, function (err) {
    if (err) {
      res.status(500).json({ error: err.message })
      return
    }
    res.json({ message: 'Transaction deleted', changes: this.changes })
  })
})

// Bulk Delete transactions
router.post('/batch_delete', express.json(), (req, res) => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No IDs provided' })
  }

  const placeholders = ids.map(() => '?').join(',')
  const sql = `DELETE FROM transactions WHERE id IN (${placeholders})`

  db.run(sql, ids, function (err) {
    if (err) {
      res.status(500).json({ error: err.message })
      return
    }
    res.json({ message: 'Transactions deleted', changes: this.changes })
  })
})

module.exports = router
