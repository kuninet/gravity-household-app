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

// Promise wrapper around the callback-based sqlite3 API
function queryAll(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Group rows keyed by keyField into a series per period (fullMonthKeys or years), sorted by total desc
function transformToSeries(rows, keyField, periodKeys, periodField) {
    const groups = {};
    rows.forEach(r => {
        const key = r[keyField];
        if (!groups[key]) groups[key] = {};
        groups[key][r[periodField]] = r.total;
    });

    const result = Object.keys(groups).map(name => {
        const data = periodKeys.map(k => groups[name][k] || 0);
        return {
            name,
            data,
            total: data.reduce((a, b) => a + b, 0)
        };
    });
    result.sort((a, b) => b.total - a.total);
    return result;
}

// Build { keyValue: { 'YYYY': [12 monthly values, index 0 = month 01] } } from fiscal_month rows
function buildMonthlyIndex(rows, keyField) {
    const index = {};
    rows.forEach(r => {
        const key = r[keyField];
        const year = r.fiscal_month.slice(0, 4);
        const month = parseInt(r.fiscal_month.slice(5, 7), 10);
        if (!index[key]) index[key] = {};
        if (!index[key][year]) index[key][year] = new Array(12).fill(0);
        index[key][year][month - 1] = r.total;
    });
    return index;
}

// Project the current fiscal year's annual total by adding, for each unelapsed month,
// the average of that month across past years. Returns null when there is no past-year data.
function projectAnnual(actualCurrentYearTotal, monthlyByYear, currentFiscalYearNum, elapsedMonths) {
    const pastYears = Object.keys(monthlyByYear).filter(y => parseInt(y, 10) < currentFiscalYearNum);
    if (pastYears.length === 0) return null;

    let projectedRemainder = 0;
    for (let m = elapsedMonths; m < 12; m++) {
        const values = pastYears
            .map(y => monthlyByYear[y][m])
            .filter(v => v !== undefined && v !== null);
        if (values.length === 0) continue;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        projectedRemainder += avg;
    }
    return actualCurrentYearTotal + Math.round(projectedRemainder);
}

// Get yearly analysis
router.get('/yearly', (req, res) => {
    const { year } = req.query;

    if (!year) {
        return res.status(400).json({ error: 'Year is required' });
    }

    const pattern = `${year}-%`;
    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const fullMonthKeys = monthKeys.map(m => `${year}-${m}`);

    // Determine current fiscal month
    const currentFiscalMonth = getFiscalMonth(new Date().toISOString());

    // Query 1: Main Groups (e.g. Food, Fixed Costs, etc.)
    const sqlGroups = `
        SELECT
            t.fiscal_month,
            c.group_name,
            SUM(t.amount) as total
        FROM transactions t
        JOIN categories c ON t.category_code = c.code
        WHERE t.fiscal_month LIKE ? AND t.type = 'EXPENSE'
        GROUP BY t.fiscal_month, c.group_name
        ORDER BY t.fiscal_month ASC
    `;

    // Query 2: Fixed Cost Breakdown (Specific items where group_name = '固定費')
    const sqlFixedBreakdown = `
        SELECT
            t.fiscal_month,
            c.name as category_name,
            SUM(t.amount) as total
        FROM transactions t
        JOIN categories c ON t.category_code = c.code
        WHERE t.fiscal_month LIKE ?
          AND t.type = 'EXPENSE'
          AND c.group_name = '固定費'
        GROUP BY t.fiscal_month, c.name
        ORDER BY t.fiscal_month ASC
    `;

    db.all(sqlGroups, [pattern], (err, groupRows) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(sqlFixedBreakdown, [pattern], (err, fixedRows) => {
            if (err) return res.status(500).json({ error: err.message });

            // Query 3: Monthly Totals (Income/Expense)
            const sqlTotals = `
                SELECT
                    fiscal_month,
                    type,
                    SUM(amount) as total
                FROM transactions
                WHERE fiscal_month LIKE ?
                GROUP BY fiscal_month, type
            `;

            db.all(sqlTotals, [pattern], (err, totalRows) => {
                if (err) return res.status(500).json({ error: err.message });

                // Process Totals
                const summary = {
                    income: fullMonthKeys.map(m => {
                        const row = totalRows.find(r => r.fiscal_month === m && r.type === 'INCOME');
                        return row ? row.total : 0;
                    }),
                    expense: fullMonthKeys.map(m => {
                        const row = totalRows.find(r => r.fiscal_month === m && r.type === 'EXPENSE');
                        return row ? row.total : 0;
                    }),
                    balance: []
                };

                // Calculate Balance (Only for current or past fiscal months)
                summary.balance = summary.income.map((inc, i) => {
                    const fiscalMonth = fullMonthKeys[i];
                    if (fiscalMonth > currentFiscalMonth) return null; // Future month
                    return inc - summary.expense[i];
                });

                // Calculate Totals (Yearly)
                // Filter out nulls for balance total
                const validBalances = summary.balance.filter(b => b !== null);

                summary.total_income = summary.income.reduce((a, b) => a + b, 0);
                summary.total_expense = summary.expense.reduce((a, b) => a + b, 0);
                // Total Balance logic: simple sum of valid monthly balances? Or Total Income - Total Expense?
                // Request implies avoiding "future deficits".
                // If we sum valid balances, it reflects "Year to Date".
                // If we use Total Income - Total Expense, it includes future expenses (like annual fixed costs).
                // Let's use the sum of valid monthly balances to be consistent with the view.
                summary.total_balance = validBalances.reduce((a, b) => a + b, 0);

                res.json({
                    year,
                    months: monthKeys,
                    groups: transformToSeries(groupRows, 'group_name', fullMonthKeys, 'fiscal_month'),
                    fixed_cost_breakdown: transformToSeries(fixedRows, 'category_name', fullMonthKeys, 'fiscal_month'),
                    summary
                });
            });
        });
    });
});

// Get multi-year comparison analysis
router.get('/multi_year', async (req, res) => {
    try {
        const fromRaw = req.query.from;
        const toRaw = req.query.to;

        if (!/^\d{4}$/.test(fromRaw || '') || !/^\d{4}$/.test(toRaw || '')) {
            return res.status(400).json({ error: 'invalid from/to' });
        }

        const fromYear = parseInt(fromRaw, 10);
        const toYear = parseInt(toRaw, 10);

        if (fromYear > toYear || toYear - fromYear > 20) {
            return res.status(400).json({ error: 'invalid from/to' });
        }

        const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => String(fromYear + i));

        const currentFiscalMonth = getFiscalMonth(new Date().toISOString());
        const currentFiscalYear = currentFiscalMonth.slice(0, 4);
        const currentFiscalYearNum = parseInt(currentFiscalYear, 10);
        const elapsedMonths = parseInt(currentFiscalMonth.slice(5, 7), 10);
        const currentYearIndex = years.indexOf(currentFiscalYear);

        const yearlyFrom = `${fromYear}-01`;
        const yearlyTo = `${toYear}-12`;
        const monthlyFrom = `${fromYear}-01`;
        const monthlyTo = `${currentFiscalYear}-12`;

        const sqlGroupYearly = `
            SELECT substr(t.fiscal_month, 1, 4) AS fiscal_year,
                   c.group_name,
                   SUM(t.amount) AS total
            FROM transactions t
            JOIN categories c ON t.category_code = c.code
            WHERE t.fiscal_month BETWEEN ? AND ?
              AND t.type = 'EXPENSE'
            GROUP BY fiscal_year, c.group_name
            ORDER BY fiscal_year ASC
        `;

        const sqlTypeYearly = `
            SELECT substr(fiscal_month, 1, 4) AS fiscal_year,
                   type,
                   SUM(amount) AS total
            FROM transactions
            WHERE fiscal_month BETWEEN ? AND ?
            GROUP BY fiscal_year, type
        `;

        const sqlCategoryYearly = `
            SELECT substr(t.fiscal_month, 1, 4) AS fiscal_year,
                   c.name AS category_name,
                   SUM(t.amount) AS total
            FROM transactions t
            JOIN categories c ON t.category_code = c.code
            WHERE t.fiscal_month BETWEEN ? AND ?
              AND t.type = 'EXPENSE'
            GROUP BY fiscal_year, c.name
            ORDER BY fiscal_year ASC
        `;

        const sqlGroupMonthly = `
            SELECT t.fiscal_month,
                   c.group_name,
                   SUM(t.amount) AS total
            FROM transactions t
            JOIN categories c ON t.category_code = c.code
            WHERE t.fiscal_month BETWEEN ? AND ?
              AND t.type = 'EXPENSE'
            GROUP BY t.fiscal_month, c.group_name
        `;

        const sqlTypeMonthly = `
            SELECT fiscal_month, type, SUM(amount) AS total
            FROM transactions
            WHERE fiscal_month BETWEEN ? AND ?
            GROUP BY fiscal_month, type
        `;

        const sqlCategoryMonthly = `
            SELECT t.fiscal_month,
                   c.name AS category_name,
                   SUM(t.amount) AS total
            FROM transactions t
            JOIN categories c ON t.category_code = c.code
            WHERE t.fiscal_month BETWEEN ? AND ?
              AND t.type = 'EXPENSE'
            GROUP BY t.fiscal_month, c.name
        `;

        const [
            groupYearlyRows,
            typeYearlyRows,
            categoryYearlyRows,
            groupMonthlyRows,
            typeMonthlyRows,
            categoryMonthlyRows
        ] = await Promise.all([
            queryAll(sqlGroupYearly, [yearlyFrom, yearlyTo]),
            queryAll(sqlTypeYearly, [yearlyFrom, yearlyTo]),
            queryAll(sqlCategoryYearly, [yearlyFrom, yearlyTo]),
            currentYearIndex === -1 ? Promise.resolve([]) : queryAll(sqlGroupMonthly, [monthlyFrom, monthlyTo]),
            currentYearIndex === -1 ? Promise.resolve([]) : queryAll(sqlTypeMonthly, [monthlyFrom, monthlyTo]),
            currentYearIndex === -1 ? Promise.resolve([]) : queryAll(sqlCategoryMonthly, [monthlyFrom, monthlyTo])
        ]);

        const groupSeries = transformToSeries(groupYearlyRows, 'group_name', years, 'fiscal_year');
        const categorySeries = transformToSeries(categoryYearlyRows, 'category_name', years, 'fiscal_year');

        const incomeByYear = {};
        const expenseByYear = {};
        typeYearlyRows.forEach(r => {
            if (r.type === 'INCOME') incomeByYear[r.fiscal_year] = r.total;
            else if (r.type === 'EXPENSE') expenseByYear[r.fiscal_year] = r.total;
        });
        const income = years.map(y => incomeByYear[y] || 0);
        const expense = years.map(y => expenseByYear[y] || 0);
        const balance = years.map((y, i) => (y > currentFiscalYear ? null : income[i] - expense[i]));

        const groupMonthlyIndex = buildMonthlyIndex(groupMonthlyRows, 'group_name');
        const categoryMonthlyIndex = buildMonthlyIndex(categoryMonthlyRows, 'category_name');
        const typeMonthlyIndex = buildMonthlyIndex(typeMonthlyRows, 'type');

        const groups = groupSeries.map(g => {
            const projected = years.map(() => null);
            if (currentYearIndex !== -1) {
                const monthlyByYear = groupMonthlyIndex[g.name] || {};
                projected[currentYearIndex] = projectAnnual(
                    g.data[currentYearIndex],
                    monthlyByYear,
                    currentFiscalYearNum,
                    elapsedMonths
                );
            }
            return { ...g, projected };
        });

        const categories = categorySeries.map(c => {
            const projected = years.map(() => null);
            if (currentYearIndex !== -1) {
                const monthlyByYear = categoryMonthlyIndex[c.name] || {};
                projected[currentYearIndex] = projectAnnual(
                    c.data[currentYearIndex],
                    monthlyByYear,
                    currentFiscalYearNum,
                    elapsedMonths
                );
            }
            return { ...c, projected };
        });

        const income_projected = years.map(() => null);
        const expense_projected = years.map(() => null);
        const balance_projected = years.map(() => null);

        if (currentYearIndex !== -1) {
            const incomeMonthlyByYear = typeMonthlyIndex['INCOME'] || {};
            const expenseMonthlyByYear = typeMonthlyIndex['EXPENSE'] || {};

            income_projected[currentYearIndex] = projectAnnual(
                income[currentYearIndex],
                incomeMonthlyByYear,
                currentFiscalYearNum,
                elapsedMonths
            );
            expense_projected[currentYearIndex] = projectAnnual(
                expense[currentYearIndex],
                expenseMonthlyByYear,
                currentFiscalYearNum,
                elapsedMonths
            );

            if (income_projected[currentYearIndex] !== null && expense_projected[currentYearIndex] !== null) {
                balance_projected[currentYearIndex] = income_projected[currentYearIndex] - expense_projected[currentYearIndex];
            }
        }

        const validBalances = balance.filter(b => b !== null);

        res.json({
            from: fromYear,
            to: toYear,
            years,
            current_fiscal_year: currentFiscalYear,
            current_fiscal_month: currentFiscalMonth,
            elapsed_months_current_year: elapsedMonths,
            groups,
            categories,
            summary: {
                income,
                expense,
                balance,
                income_projected,
                expense_projected,
                balance_projected,
                total_income: income.reduce((a, b) => a + b, 0),
                total_expense: expense.reduce((a, b) => a + b, 0),
                total_balance: validBalances.reduce((a, b) => a + b, 0)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
