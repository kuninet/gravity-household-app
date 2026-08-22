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

    // 給与 (INCOME/700) は複数明細対応の専用エンドポイントに誘導する。
    // update_cell は (fiscal_month, category_code, type) で 1 行に集約してしまうため、
    // 複数明細を許容する給与では使えない。
    if (type === 'INCOME' && INCOME_FIXED_CODES.includes(Number(category_code))) {
        return res.status(400).json({ error: 'Use /fixed_costs/salary endpoints for salary rows' });
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

            // 給与 (INCOME/700) は複数明細対応の専用エンドポイント経由でのみ書き換え可能。
            if (type === 'INCOME' && INCOME_FIXED_CODES.includes(Number(category_code))) {
                await dbRun('ROLLBACK');
                return res.status(400).json({ error: 'Use /fixed_costs/salary endpoints for salary rows' });
            }

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


// ---------------------------------------------------------------------------
// 給与 (INCOME/700) 専用エンドポイント: 1 会計月に複数明細を許容するため、
// (fiscal_month, category_code, type) の一意化を前提とする update_cell 系とは
// 別ルートで id ベースの CRUD を提供する。
// ---------------------------------------------------------------------------

const SALARY_CATEGORY_CODE = 700;
const SALARY_TYPE = 'INCOME';
const SALARY_DEFAULT_DESCRIPTION = '給与(固定入力)';
const SALARY_DESCRIPTION_MAX_LENGTH = 200;

function isPositiveInt(v) {
    return Number.isInteger(v) && v > 0;
}

function isValidMonth(v) {
    return Number.isInteger(v) && v >= 1 && v <= 12;
}

function normalizeSalaryDescription(desc) {
    if (desc === undefined || desc === null || desc === '') {
        return SALARY_DEFAULT_DESCRIPTION;
    }
    if (typeof desc !== 'string') return null;
    if (desc.length > SALARY_DESCRIPTION_MAX_LENGTH) return null;
    return desc;
}

// POST /fixed_costs/salary : 給与明細を 1 行追加
router.post('/salary', (req, res) => {
    const { year, month, amount, description } = req.body || {};

    if (!isPositiveInt(year)) {
        return res.status(400).json({ error: 'year must be a positive integer' });
    }
    if (!isValidMonth(month)) {
        return res.status(400).json({ error: 'month must be an integer between 1 and 12' });
    }
    if (!Number.isInteger(amount)) {
        return res.status(400).json({ error: 'amount must be an integer' });
    }
    const desc = normalizeSalaryDescription(description);
    if (desc === null) {
        return res.status(400).json({ error: 'description must be a string of at most 200 chars' });
    }

    const fiscal_month = `${year}-${String(month).padStart(2, '0')}`;
    const insertDate = resolveInsertDate(fiscal_month, SALARY_TYPE);

    db.run(
        `INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [insertDate, fiscal_month, amount, SALARY_TYPE, SALARY_CATEGORY_CODE, desc],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'created', id: this.lastID });
        }
    );
});

// PUT /fixed_costs/salary/:id : 給与明細の金額/摘要を更新 (会計月は変更不可)
router.put('/salary/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
        return res.status(400).json({ error: 'invalid id' });
    }
    const { amount, description } = req.body || {};
    if (!Number.isInteger(amount)) {
        return res.status(400).json({ error: 'amount must be an integer' });
    }
    const desc = normalizeSalaryDescription(description);
    if (desc === null) {
        return res.status(400).json({ error: 'description must be a string of at most 200 chars' });
    }

    // 給与行以外を書き換えないよう type/category_code を検証
    db.get(
        'SELECT id, category_code, type FROM transactions WHERE id = ?',
        [id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row || row.category_code !== SALARY_CATEGORY_CODE || row.type !== SALARY_TYPE) {
                return res.status(404).json({ error: 'salary row not found' });
            }

            // 月変更は削除+追加で行う仕様のため date/fiscal_month は触らない
            db.run(
                'UPDATE transactions SET amount = ?, description = ? WHERE id = ?',
                [amount, desc, id],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ status: 'updated' });
                }
            );
        }
    );
});

// DELETE /fixed_costs/salary/:id : 給与明細を削除
router.delete('/salary/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
        return res.status(400).json({ error: 'invalid id' });
    }

    db.get(
        'SELECT id, category_code, type FROM transactions WHERE id = ?',
        [id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row || row.category_code !== SALARY_CATEGORY_CODE || row.type !== SALARY_TYPE) {
                return res.status(404).json({ error: 'salary row not found' });
            }
            db.run('DELETE FROM transactions WHERE id = ?', [id], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ status: 'deleted' });
            });
        }
    );
});

module.exports = router;
