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


db.all(`
    SELECT type, COUNT(*) as count, SUM(amount) as total
    FROM transactions
    WHERE category_code IN (${FIXED_COST_CODES.join(',')})
    GROUP BY type
`, (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log('\n--- Summary of Fixed Cost Types ---');
    console.table(rows);
});
