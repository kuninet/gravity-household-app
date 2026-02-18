const db = require('./db');

const year = '2026';
const pattern = `${year}-%`;
const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const fullMonthKeys = monthKeys.map(m => `${year}-${m}`);

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
    if (err) {
        console.error(err);
        return;
    }

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

    // Simulate Backend Logic for Balance
    const currentFiscalMonth = '2026-02'; // Hardcode for testing (Assume today is Feb 18, so fiscal is Feb)

    // Calculate Balance
    summary.balance = summary.income.map((inc, i) => {
        const fiscalMonth = fullMonthKeys[i];
        if (fiscalMonth > currentFiscalMonth) return null; // Future month
        return inc - summary.expense[i];
    });

    // Calculate Totals (Yearly)
    const validBalances = summary.balance.filter(b => b !== null);
    summary.total_income = summary.income.reduce((a, b) => a + b, 0);
    summary.total_expense = summary.expense.reduce((a, b) => a + b, 0);
    summary.total_balance = validBalances.reduce((a, b) => a + b, 0);

    console.log('--- Summary ---');
    console.log(JSON.stringify(summary, null, 2));
});
