const db = require('./db');

const FIXED_COST_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608];

console.log('\n--- Checking 2026-02 ---');
db.all(`
    SELECT *
    FROM transactions 
    WHERE fiscal_month = '2026-02'
    AND category_code IN (${FIXED_COST_CODES.join(',')})
`, (err, rows) => {
    if (err) console.error(err);
    else console.table(rows);
});


console.log('\n--- Checking Income Groups ---');
db.all(`
    SELECT 
        c.group_name,
        SUM(t.amount) as total
    FROM transactions t
    JOIN categories c ON t.category_code = c.code
    WHERE t.type = 'INCOME'
    GROUP BY c.group_name
`, (err, rows) => {
    if (err) console.error(err);
    else console.table(rows);
});
