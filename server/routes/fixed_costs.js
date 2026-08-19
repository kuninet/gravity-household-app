const express = require('express');
const router = express.Router();
const db = require('../db');

// 固定入力画面で扱うカテゴリ (支出/収入で分離)
const EXPENSE_FIXED_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608];
const INCOME_FIXED_CODES = [700];

// INSERT 時の date を決定する。
// EXPENSE: 会計月の 01 日 (現行踏襲)。
// INCOME: 会計月の前月 25 日。25 日は fiscal_month の切替 (23 日基点) の後側なので
// getFiscalMonth(date) と fiscal_month が一致する。
function resolveInsertDate(fiscalMonth, type) {
    if (type === 'INCOME') {
        const [y, m] = fiscalMonth.split('-').map(Number);
        let py = y;
        let pm = m - 1;
        if (pm < 1) {
            pm = 12;
            py -= 1;
        }
        return `${py}-${String(pm).padStart(2, '0')}-25`;
    }
    return `${fiscalMonth}-01`;
}

function resolveDescription(type) {
    return type === 'INCOME' ? '給与(固定入力)' : '固定費入力';
}

// Get matrix data for a specific year
router.get('/matrix', (req, res) => {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: 'Year is required' });

    const pattern = `${year}-%`;
    // (type, code) 対で絞る。逆 type の同一コード行 (例: 給与コード 700 に EXPENSE が付いた誤登録) を混入させない。
    // プレースホルダは固定の数値配列を map しているだけなので SQL 注入余地はない。
    const expensePlaceholder = EXPENSE_FIXED_CODES.map(() => '?').join(',');
    const incomePlaceholder = INCOME_FIXED_CODES.map(() => '?').join(',');

    const sql = `
        SELECT id, fiscal_month, category_code, amount, description, type
        FROM transactions
        WHERE fiscal_month LIKE ?
          AND (
            (type = 'EXPENSE' AND category_code IN (${expensePlaceholder}))
            OR (type = 'INCOME' AND category_code IN (${incomePlaceholder}))
          )
    `;

    db.all(
        sql,
        [pattern, ...EXPENSE_FIXED_CODES, ...INCOME_FIXED_CODES],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ data: rows });
        }
    );
});

// Bulk update/insert for a specific cell (Year-Month + Category)
router.post('/update_cell', (req, res) => {
    const { year, month, category_code, amount } = req.body;
    const type = req.body.type || 'EXPENSE';

    if (!year || !month || !category_code) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const fiscal_month = `${year}-${String(month).padStart(2, '0')}`;

    // (fiscal_month, category_code, type) で一意化。type が変わればそれは別レコード扱い
    // (逆 type の既存行を巻き込むと Analysis/Summary で誤分類されるため)。
    db.get(
        'SELECT id FROM transactions WHERE fiscal_month = ? AND category_code = ? AND type = ?',
        [fiscal_month, category_code, type],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (amount === '' || amount === null || amount === 0 || amount === '0') {
                if (row) {
                    db.run('DELETE FROM transactions WHERE id = ?', [row.id], function (err) {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ status: 'deleted' });
                    });
                } else {
                    res.json({ status: 'ignored' });
                }
            } else {
                const insertDate = resolveInsertDate(fiscal_month, type);
                const description = resolveDescription(type);
                if (row) {
                    // 既存行の date/description が古い type の値のまま残らないよう毎回上書き
                    db.run(
                        'UPDATE transactions SET amount = ?, date = ?, description = ? WHERE id = ?',
                        [amount, insertDate, description, row.id],
                        function (err) {
                            if (err) return res.status(500).json({ error: err.message });
                            res.json({ status: 'updated' });
                        }
                    );
                } else {
                    db.run(
                        `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [insertDate, fiscal_month, amount, type, category_code, description],
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
    const { year, cells } = req.body; // cells: [{ month, category_code, amount, type }]

    if (!year || !cells || !Array.isArray(cells)) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

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
            const type = cell.type || 'EXPENSE';
            const fiscal_month = `${year}-${String(month).padStart(2, '0')}`;

            const row = await dbGet(
                'SELECT id FROM transactions WHERE fiscal_month = ? AND category_code = ? AND type = ?',
                [fiscal_month, category_code, type]
            );

            if (amount === '' || amount === null || amount === 0 || amount === '0') {
                if (row) {
                    await dbRun('DELETE FROM transactions WHERE id = ?', [row.id]);
                }
            } else {
                const insertDate = resolveInsertDate(fiscal_month, type);
                const description = resolveDescription(type);
                if (row) {
                    await dbRun(
                        'UPDATE transactions SET amount = ?, date = ?, description = ? WHERE id = ?',
                        [amount, insertDate, description, row.id]
                    );
                } else {
                    await dbRun(
                        `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [insertDate, fiscal_month, amount, type, category_code, description]
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
