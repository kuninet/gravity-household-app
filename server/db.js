const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database
// Using a file named 'household.db' in the same directory as this file
const dbPath = path.resolve(__dirname, 'household.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Enable Write-Ahead Logging for better concurrency
        db.run('PRAGMA journal_mode = WAL');
        // Wait up to 5000ms if db is busy
        db.configure('busyTimeout', 5000);
    }
});

// Initialize database schema
db.serialize(() => {
    // Transactions table
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        fiscal_month TEXT NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        category_code INTEGER,
        description TEXT,
        memo TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Categories table
    db.run(`CREATE TABLE IF NOT EXISTS categories (
        code INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL
    )`);
});

module.exports = db;
