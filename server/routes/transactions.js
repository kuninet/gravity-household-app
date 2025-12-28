const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to calculate fiscal month (23rd start)
function getFiscalMonth(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate();
    let year = date.getFullYear();
    let month = date.getMonth() + 1; // 0-indexed

    if (day >= 23) {
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return `${year}-${String(month).padStart(2, '0')}`;
}

// Get transactions (optional filter by fiscal_month)
router.get('/', (req, res) => {
    const { month } = req.query;
    let sql = 'SELECT * FROM transactions';
    const params = [];

    if (month) {
        sql += ' WHERE fiscal_month = ?';
        params.push(month);
    }

    sql += ' ORDER BY date DESC, id DESC';

    db.all(sql, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ data: rows });
    });
});

// Create transaction
router.post('/', (req, res) => {
    const { date, amount, type, category_code, description, memo } = req.body;

    if (!date || !amount || !type) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const fiscal_month = getFiscalMonth(date);

    const sql = `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [date, fiscal_month, amount, type, category_code, description, memo];

    db.run(sql, params, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            message: 'Transaction created',
            data: { id: this.lastID, ...req.body, fiscal_month }
        });
    });
});

// Update transaction
router.put('/:id', (req, res) => {
    const { date, amount, type, category_code, description, memo } = req.body;
    const id = req.params.id;

    if (!date || !amount || !type) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const fiscal_month = getFiscalMonth(date);

    const sql = `UPDATE transactions 
                 SET date = ?, fiscal_month = ?, amount = ?, type = ?, category_code = ?, description = ?, memo = ?
                 WHERE id = ?`;
    const params = [date, fiscal_month, amount, type, category_code, description, memo, id];

    db.run(sql, params, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            message: 'Transaction updated',
            changes: this.changes,
            data: { id, ...req.body, fiscal_month }
        });
    });
});


// Delete transaction
router.delete('/:id', (req, res) => {
    const sql = 'DELETE FROM transactions WHERE id = ?';
    db.run(sql, req.params.id, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Transaction deleted', changes: this.changes });
    });
});

// Bulk Delete transactions
router.post('/batch_delete', express.json(), (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No IDs provided' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM transactions WHERE id IN (${placeholders})`;

    db.run(sql, ids, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Transactions deleted', changes: this.changes });
    });
});

module.exports = router;
