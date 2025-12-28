const express = require('express');
const router = express.Router();
const db = require('../db');

// Get yearly analysis
router.get('/yearly', (req, res) => {
    const { year } = req.query;

    if (!year) {
        return res.status(400).json({ error: 'Year is required' });
    }

    const pattern = `${year}-%`;
    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const fullMonthKeys = monthKeys.map(m => `${year}-${m}`);

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
                fixed_cost_breakdown: transformToSeries(fixedRows, 'category_name')
            });
        });
    });
});

module.exports = router;
