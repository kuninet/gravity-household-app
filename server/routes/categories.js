const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all categories
router.get('/', (req, res) => {
    const sql = 'SELECT * FROM categories ORDER BY code ASC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ data: rows });
    });
});

module.exports = router;
