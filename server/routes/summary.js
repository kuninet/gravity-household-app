const express = require('express');
const router = express.Router();
const db = require('../db');

function getFiscalMonth(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate();
    let year = date.getFullYear();
    let month = date.getMonth() + 1;

    if (day >= 23) {
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return `${year}-${String(month).padStart(2, '0')}`;
}

function getPreviousMonth(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    let prevY = y;
    let prevM = m - 1;
    if (prevM < 1) {
        prevM = 12;
        prevY--;
    }
    return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

// Get monthly summary (totals by category group)
router.get('/', (req, res) => {
    const { month } = req.query;
    const targetMonth = month || getFiscalMonth(new Date().toISOString());
    const prevMonth = getPreviousMonth(targetMonth);

    // Query for both months
    const sql = `
        SELECT 
            t.fiscal_month,
            c.group_name, 
            SUM(t.amount) as total 
        FROM transactions t
        JOIN categories c ON t.category_code = c.code
        WHERE t.fiscal_month IN (?, ?) AND t.type = 'EXPENSE'
        GROUP BY t.fiscal_month, c.group_name
        ORDER BY total DESC
    `;

    db.all(sql, [targetMonth, prevMonth], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // Process Comparison Data
        const currentData = rows.filter(r => r.fiscal_month === targetMonth);
        const prevData = rows.filter(r => r.fiscal_month === prevMonth);

        // Merge logic
        const comparisonMap = new Map();

        currentData.forEach(r => {
            comparisonMap.set(r.group_name, { group: r.group_name, current: r.total, prev: 0 });
        });
        prevData.forEach(r => {
            if (!comparisonMap.has(r.group_name)) {
                comparisonMap.set(r.group_name, { group: r.group_name, current: 0, prev: r.total });
            } else {
                comparisonMap.get(r.group_name).prev = r.total;
            }
        });

        const comparison = Array.from(comparisonMap.values()).map(item => ({
            ...item,
            diff: item.current - item.prev
        }));

        // Total Summary (Existing logic for current month cards)
        const summarySql = `
            SELECT 
                type, 
                SUM(amount) as total 
            FROM transactions 
            WHERE fiscal_month = ? 
            GROUP BY type
        `;

        db.all(summarySql, [targetMonth], (err, summaryRows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            const income = summaryRows.find(r => r.type === 'INCOME')?.total || 0;
            const expense = summaryRows.find(r => r.type === 'EXPENSE')?.total || 0;

            res.json({
                month: targetMonth,
                prev_month: prevMonth,
                by_category: currentData, // Keep existing format for chart
                comparison: comparison,   // New comparison data
                total: {
                    income,
                    expense,
                    balance: income - expense
                }
            });
        });
    });
});

module.exports = router;
