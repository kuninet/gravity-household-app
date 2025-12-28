const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const fs = require('fs');
const iconv = require('iconv-lite');
const { stringify } = require('csv-stringify');
const { parse } = require('csv-parse');

const upload = multer({ dest: 'uploads/' });

// Promisify helper
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err); else resolve(rows);
    });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err); else resolve(this);
    });
});

// GET /export - Download Full Backup as SJIS CSV
router.get('/export', async (req, res) => {
    try {
        const rows = await dbAll('SELECT id, date, fiscal_month, amount, type, category_code, description, memo FROM transactions ORDER BY id ASC');

        // CSV Header Mapping
        const columns = [
            'id', 'date', 'fiscal_month', 'amount', 'type', 'category_code', 'description', 'memo'
        ];

        // Stringify
        stringify(rows, {
            header: true,
            columns: columns
        }, (err, output) => {
            if (err) {
                console.error('CSV Stringify Error:', err);
                return res.status(500).send('Export failed');
            }

            // Convert to SJIS
            const sjisBuffer = iconv.encode(output, 'Shift_JIS');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="gravity_backup_${new Date().toISOString().slice(0, 10)}.csv"`);
            res.send(sjisBuffer);
        });

    } catch (e) {
        console.error('Export Error:', e);
        res.status(500).send('Export failed');
    }
});

// POST /restore - Full Restore (Wipe & Replace)
router.post('/restore', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // Read file
        const buffer = fs.readFileSync(req.file.path);

        // Decode SJIS (try-catch implicit in logic if encoding wrong?)
        // Assuming user provides valid SJIS. If UTF8 provided, iconv might mangle or work partially.
        // Let's assume SJIS as requested.
        const csvContent = iconv.decode(buffer, 'Shift_JIS');

        // Parse CSV
        parse(csvContent, {
            columns: true, // Auto-detect headers from first line
            skip_empty_lines: true
        }, async (err, records) => {
            if (err) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Invalid CSV format' });
            }

            if (!records || records.length === 0) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'No records found' });
            }

            // Restore Logic: Transactional Wipe & Insert
            try {
                await dbRun('BEGIN TRANSACTION');

                // Wipe
                await dbRun('DELETE FROM transactions');
                // Reset Auto Increment? Optional but cleaner.
                // SQLite: DELETE FROM sqlite_sequence WHERE name='transactions';
                await dbRun("DELETE FROM sqlite_sequence WHERE name='transactions'");

                // Insert All
                const insertSql = `INSERT INTO transactions 
                    (id, date, fiscal_month, amount, type, category_code, description, memo) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

                for (const row of records) {
                    // row keys match columns from export
                    await dbRun(insertSql, [
                        row.id || null, // Allow auto-id if id missing, but backup has ID.
                        row.date,
                        row.fiscal_month,
                        row.amount,
                        row.type,
                        row.category_code,
                        row.description,
                        row.memo
                    ]);
                }

                await dbRun('COMMIT');

                // Cleanup
                fs.unlinkSync(req.file.path);

                res.json({ message: 'Restore completed', count: records.length });

            } catch (dbErr) {
                await dbRun('ROLLBACK');
                console.error('Restore DB Error:', dbErr);
                fs.unlinkSync(req.file.path);
                res.status(500).json({ error: 'Database error during restore: ' + dbErr.message });
            }
        });

    } catch (e) {
        if (req.file) fs.unlinkSync(req.file.path);
        console.error('Restore Error:', e);
        res.status(500).json({ error: 'Restore failed: ' + e.message });
    }
});

module.exports = router;
