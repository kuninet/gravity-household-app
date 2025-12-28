const express = require('express');
const router = express.Router();
const db = require('../db');

// List the specific codes used for Fixed Costs screen
const FIXED_COST_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608];

// Get matrix data for a specific year
router.get('/matrix', (req, res) => {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: 'Year is required' });

    const pattern = `${year}-%`;
    const codesPlaceholder = FIXED_COST_CODES.map(() => '?').join(',');

    // Fetch existing transactions for these codes in the given year
    const sql = `
        SELECT id, fiscal_month, category_code, amount, description
        FROM transactions
        WHERE fiscal_month LIKE ? 
          AND category_code IN (${codesPlaceholder})
          AND type = 'EXPENSE'
    `;

    db.all(sql, [pattern, ...FIXED_COST_CODES], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// Bulk update/insert for a specific cell (Year-Month + Category)
// Or arguably, we can just use the existing POST / DELETE endpoints if we do cell-by-cell saving.
// But a dedicated endpoint for "Update cell" that handles "Insert if new, Update if exists, Delete if empty" is better for UI.

router.post('/update_cell', (req, res) => {
    const { year, month, category_code, amount } = req.body;

    if (!year || !month || !category_code) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const fiscal_month = `${year}-${String(month).padStart(2, '0')}`;

    // Check if exists
    db.get(
        'SELECT id FROM transactions WHERE fiscal_month = ? AND category_code = ?',
        [fiscal_month, category_code],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (amount === '' || amount === null || amount === 0 || amount === '0') {
                // Delete if empty/zero
                if (row) {
                    db.run('DELETE FROM transactions WHERE id = ?', [row.id], function (err) {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ status: 'deleted' });
                    });
                } else {
                    res.json({ status: 'ignored' });
                }
            } else {
                // Upsert
                if (row) {
                    db.run(
                        'UPDATE transactions SET amount = ? WHERE id = ?',
                        [amount, row.id],
                        function (err) {
                            if (err) return res.status(500).json({ error: err.message });
                            res.json({ status: 'updated' });
                        }
                    );
                } else {
                    // Start date is arbitrary, usually 1st or 23rd?
                    // To keep it simple, we use YYYY-MM-01. The fiscal_month is what matters for aggregation.
                    const dateDesc = `${fiscal_month}-01`;
                    db.run(
                        `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) 
                         VALUES (?, ?, ?, 'EXPENSE', ?, '固定費入力')`,
                        [dateDesc, fiscal_month, amount, category_code],
                        function (err) {
                            if (err) return res.status(500).json({ error: err.message });
                            res.json({ status: 'created', id: this.lastID });
                        }
                    );
                }
            }
        }
    );
});

router.post('/batch_update', async (req, res) => {
    const { year, cells } = req.body; // cells: [{ month, category_code, amount }]

    if (!year || !cells || !Array.isArray(cells)) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    // Promisify db functions for this scope
    const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err); else resolve(this);
        });
    });

    const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });

    try {
        await dbRun('BEGIN TRANSACTION');

        let processedCount = 0;

        for (const cell of cells) {
            const { month, category_code, amount } = cell;
            const fiscal_month = `${year}-${String(month).padStart(2, '0')}`;

            // Check existence
            const row = await dbGet(
                'SELECT id FROM transactions WHERE fiscal_month = ? AND category_code = ?',
                [fiscal_month, category_code]
            );

            if (amount === '' || amount === null || amount === 0 || amount === '0') {
                // Delete if exists
                if (row) {
                    await dbRun('DELETE FROM transactions WHERE id = ?', [row.id]);
                }
            } else {
                // Upsert
                if (row) {
                    await dbRun('UPDATE transactions SET amount = ? WHERE id = ?', [amount, row.id]);
                } else {
                    const dateDesc = `${fiscal_month}-01`;
                    await dbRun(
                        `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description) 
                         VALUES (?, ?, ?, 'EXPENSE', ?, '固定費入力')`,
                        [dateDesc, fiscal_month, amount, category_code]
                    );
                }
            }
            processedCount++;
        }

        await dbRun('COMMIT');
        res.json({ message: 'Batch update completed', count: processedCount });

    } catch (err) {
        try {
            await dbRun('ROLLBACK');
        } catch (e) {
            console.error('Rollback failed:', e);
        }
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;
