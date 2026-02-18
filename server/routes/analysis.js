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

                // Helper to transform rows to Series
                const transformToSeries = (rows, keyField) => {

                    const groups = {};
                    rows.forEach(r => {
                        const key = r[keyField];
                        if (!groups[key]) groups[key] = {};
                        groups[key][r.fiscal_month] = r.total;
                    });

                    const result = Object.keys(groups).map(name => {
                        const data = fullMonthKeys.map(m => groups[name][m] || 0);
                        return {
                            name: name,
                            data: data,
                            total: data.reduce((a, b) => a + b, 0)
                        };
                    });
                    result.sort((a, b) => b.total - a.total);
                    return result;
                };

                res.json({
                    year,
                    months: monthKeys,
                    groups: transformToSeries(groupRows, 'group_name'),
                    fixed_cost_breakdown: transformToSeries(fixedRows, 'category_name'),
                    summary
                });
            });
        });
    });
});

module.exports = router;
