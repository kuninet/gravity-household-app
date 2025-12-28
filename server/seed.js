const db = require('./db');

const categories = [
    { code: 100, name: '食費', group: '食費' },
    { code: 103, name: '外食費', group: '食費' },
    { code: 105, name: '酒', group: '食費' },
    { code: 200, name: '日用品・雑費', group: '日用品' },
    { code: 201, name: 'クリーニング', group: '日用品' },
    { code: 300, name: '交通費', group: '交通費' },
    { code: 400, name: '交際費・娯楽', group: '交際費' },
    { code: 401, name: '映画', group: '交際費' },
    { code: 402, name: '本', group: '交際費' },
    { code: 500, name: '医療費', group: '医療費' },
    { code: 900, name: 'その他', group: 'その他' },
    { code: 901, name: '小遣い', group: 'その他' },
    // Fixed Costs
    { code: 600, name: '家賃・光熱費', group: '固定費' }, // General category? User might not use this if specific ones exist. Using 604 for Rent.
    { code: 601, name: '電気', group: '固定費' },
    { code: 602, name: '水道', group: '固定費' },
    { code: 603, name: 'ガス一般', group: '固定費' },
    { code: 604, name: '家賃', group: '固定費' },
    { code: 605, name: '固定電話・フレッツ', group: '固定費' },
    { code: 606, name: '食洗機', group: '固定費' },
    { code: 607, name: '携帯電話', group: '固定費' },
    { code: 608, name: '保険', group: '固定費' },
];

db.serialize(() => {
    const stmt = db.prepare('INSERT OR IGNORE INTO categories (code, name, group_name) VALUES (?, ?, ?)');
    categories.forEach(cat => {
        stmt.run(cat.code, cat.name, cat.group, (err) => {
            if (err) {
                console.error(`Error inserting ${cat.name}:`, err.message);
            }
        });
    });
    stmt.finalize(() => {
        console.log('Categories seeded.');
        db.close();
    });
});
