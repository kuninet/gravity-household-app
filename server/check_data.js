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


console.log('\n--- Testing "Recent" Query Logic ---');
const placeholders = FIXED_COST_CODES.map(() => '?').join(',');
const sql = `
    SELECT id, date, description, category_code, amount 
    FROM transactions 
    WHERE category_code NOT IN (${placeholders})
    ORDER BY id DESC 
    LIMIT 10
`;

db.all(sql, FIXED_COST_CODES, (err, rows) => {
    if (err) console.error(err);
    else {
        console.table(rows);
        // Verify no fixed cost codes are present
        const hasFixedCost = rows.some(r => FIXED_COST_CODES.includes(r.category_code));
        console.log(`Contains Fixed Costs: ${hasFixedCost}`);
    }
});
