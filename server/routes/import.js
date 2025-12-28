const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const db = require('../db');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// Helper: Get Fiscal Month for a date
// Reusing logic: 23rd starts new month.
// But wait, the Excel data is organized by "Sheet Month". 
// Does the user want strict date-based allocation or just trust the sheet?
// Requirement: "Sheet name is yyyy年m月"
// Usually, household ledgers manage "January Sheet" as "January Fiscal Month".
// Even if dates are Dec 23 - Jan 22, they are in the "January" sheet.
// So we should probably use the SHEET's month as the fiscal_month for all records in it,
// OR recalculate fiscal_month based on the actual date cell?
// Given existing logic uses strict date boundaries (23rd-22nd), we should calculate fiscal_month from the DATE itself
// to maintain consistency with the app's core logic.
// HOWEVER, user said: "Data sometimes has wrong year. That data should be read as THAT year's data."
// This implies we correct the DATE first, then calculate fiscal_month.

function getFiscalMonth(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    // Day >= 23 -> Next Month
    // Month is 0-indexed in JS
    let y = date.getFullYear();
    let m = date.getMonth() + 1;
    let d = date.getDate();

    if (d >= 23) {
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }
    return `${y}-${String(m).padStart(2, '0')}`;
}

// Convert Excel Serial Date to JS Date Object
function excelDateToJSDate(serial) {
    if (!serial) return null;
    // Excel base date is 1899-12-30 usually? xlsx library parses it if we just get value.
    // simpler to let xlsx utils handle it or just assume it reads as number.
    // Actually xlsx.utils.sheet_to_json with cellDates: true handles this.
    return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

const path = require('path');

// Store temp files mapping? Or just trust the filename if safe.
// For simplicity, we just use the multer uploaded path.
// Note: Multer temp files might be cleaned up if not handled? 
// Actually standard OS temp files stick around until reboot or explicit delete.
// We'll return the filename to client and client sends it back.

// Helper: Bulk Insert
async function bulkInsert(db, table, columns, rows, chunkSize = 50) {
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
        const values = chunk.flat();
        const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`;

        await new Promise((resolve, reject) => {
            db.run(sql, values, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

// 1. Analyze Endpoint
router.post('/analyze', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const summary = { daily: [], fixed: [] };

    // Streaming setup
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        // Immediate feedback
        res.write(JSON.stringify({ type: 'progress', message: 'Excelファイルを読み込み中... (ファイルサイズにより時間がかかります)' }) + '\n');
        await new Promise(r => setTimeout(r, 100)); // Flush

        const workbook = xlsx.readFile(filePath, {
            cellDates: true,
            cellFormula: false,
            cellHTML: false,
            cellStyles: false,
            sheetRows: 2500 // Cap to prevent huge parses
        });

        res.write(JSON.stringify({ type: 'progress', message: 'シート構成を解析中...' }) + '\n');

        // Use for...of to allow await inside loop
        for (const sheetName of workbook.SheetNames) {
            // Daily
            const matchDaily = sheetName.match(/^(\d{4})年(\d{1,2})月$/);
            if (matchDaily) {
                console.log(`[Analyze] Found Daily Sheet: ${sheetName}`);
                // Progress for each sheet
                res.write(JSON.stringify({ type: 'progress', message: `${sheetName} を解析中...` }) + '\n');

                // Allow buffer to flush to client before blocking CPU
                await new Promise(r => setTimeout(r, 20));

                const sheet = workbook.Sheets[sheetName];
                // Just count rows roughly
                console.log(`[Analyze] Parsing rows for ${sheetName}...`);
                const rows = xlsx.utils.sheet_to_json(sheet, { header: 'A', range: 11 });

                let validCount = 0;
                let consecutiveEmpty = 0;

                for (const row of rows) {
                    if (row['A']) { // Has Date
                        validCount++;
                        consecutiveEmpty = 0;
                    } else {
                        consecutiveEmpty++;
                        if (consecutiveEmpty >= 10) break;
                    }
                }

                console.log(`[Analyze] Parsed ${rows.length} raw rows, found ${validCount} valid rows for ${sheetName}.`);

                if (validCount > 0) {
                    summary.daily.push({
                        sheet: sheetName,
                        count: validCount,
                        year: matchDaily[1],
                        month: matchDaily[2]
                    });
                }
            }

            // Fixed (Standard)
            const matchFixed = sheetName.match(/^(\d{4})年公共料金等$/);
            if (matchFixed) {
                console.log(`[Analyze] Found Fixed Cost Sheet (Standard): ${sheetName}`);
                res.write(JSON.stringify({ type: 'progress', message: `${sheetName} (固定費) を解析中...` }) + '\n');
                await new Promise(r => setTimeout(r, 20));
                summary.fixed.push({ sheet: sheetName, year: matchFixed[1] });
            }

            // Fixed (Alternative: yyyy合計)
            const matchTotal = sheetName.match(/^(\d{4})合計$/);
            if (matchTotal) {
                console.log(`[Analyze] Found Fixed Cost Sheet (Alternative): ${sheetName}`);
                res.write(JSON.stringify({ type: 'progress', message: `${sheetName} (固定費・別形式) を解析中...` }) + '\n');
                await new Promise(r => setTimeout(r, 20));
                summary.fixed.push({ sheet: sheetName, year: matchTotal[1] });
            }
        }

        console.log('[Analyze] All sheets processed. Sending completion.');

        // Complete
        res.write(JSON.stringify({
            type: 'complete',
            data: {
                token: path.basename(filePath),
                summary
            }
        }) + '\n');
        res.end();

    } catch (e) {
        console.error('[Analyze] Error:', e);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        // Try/catch for res.write in case connection closed
        try {
            res.write(JSON.stringify({ type: 'error', error: e.message }) + '\n');
            res.end();
        } catch (err) { }
    }
});

// 2. Execute Endpoint
router.post('/execute', express.json(), async (req, res) => {
    const { token, targetYear } = req.body;
    if (!token) return res.status(400).json({ error: 'No token provided' });

    // Reconstruct path (SECURITY: Ensure no directory traversal)
    const fileName = path.basename(token);
    const filePath = path.join('uploads', fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Import session expired or file not found' });
    }

    // Streaming setup
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    const results = { daily: 0, fixed: 0 };

    try {
        console.log(`[Execute] Processing: ${filePath}`);

        // Immediate feedback
        res.write(JSON.stringify({ type: 'progress', message: 'データベースへの書き込みを開始します...' }) + '\n');
        await new Promise(r => setTimeout(r, 100)); // Flush

        const workbook = xlsx.readFile(filePath, {
            cellDates: true,
            cellFormula: false,
            sheetRows: 2500
        });

        // Transaction removed for stability
        // db.serialize(() => { db.run('BEGIN TRANSACTION'); });

        // Use async loop to allow progress updates flush
        for (const sheetName of workbook.SheetNames) {
            // Yield to event loop
            await new Promise(r => setTimeout(r, 20));
            // DAILY
            const matchDaily = sheetName.match(/^(\d{4})年(\d{1,2})月$/);
            if (matchDaily) {
                const year = parseInt(matchDaily[1], 10);

                // FILTER: Skip if targetYear is specified and mismatch
                if (targetYear && parseInt(targetYear, 10) !== year) {
                    continue;
                }

                res.write(JSON.stringify({ type: 'progress', message: `${sheetName} のデータを処理中...` }) + '\n');

                const sheet = workbook.Sheets[sheetName];
                const rows = xlsx.utils.sheet_to_json(sheet, { header: 'A', range: 11, raw: false, dateNF: 'yyyy-mm-dd' });

                // 1. DELETE existing data for this sheet's "Year-Month" (Roughly)
                // Requirement: "Delete data for this month"
                // Issue: Fiscal month definition. 
                // Strategy: We will delete by fiscal_month that corresponds to this sheet?
                // Or just delete by date range?
                // User said: "Delete DB data for the import period"
                // Simplest: Calculate fiscal_month for the sheet (e.g. 2025-05) and delete all.
                // But date range is 4/23 - 5/22?
                // Let's assume the strict Fiscal Month logic.
                // We need to know WHICH fiscal months are touched.
                // Actually, safest is: Delete nothing upfront, but delete PER RECORD or PER MONTH found?
                // User Request: "List stats per month, then delete those months."

                // Let's extract Fiscal Months from the data? Or just assume Sheet Month = Fiscal Month?
                // Implicitly, Sheet "2025年5月" means Fiscal Month "2025-05".
                const targetFiscalMonth = `${year}-${String(matchDaily[2]).padStart(2, '0')}`;

                // Delete existing (Async wrapper for db.run)
                await new Promise((resolve, reject) => {
                    db.run(`DELETE FROM transactions WHERE fiscal_month = ?`, [targetFiscalMonth], (err) => {
                        if (err) reject(err); else resolve();
                    });
                });

                const insertRows = [];
                let consecutiveEmpty = 0;

                for (const row of rows) {
                    if (!row['A']) {
                        consecutiveEmpty++;
                        if (consecutiveEmpty >= 10) break;
                        continue;
                    }
                    consecutiveEmpty = 0;

                    if (!row['B'] || !row['C']) continue;
                    let dateStr = row['A'];
                    let code = parseInt(row['B'], 10);
                    let amount = parseInt(String(row['C']).replace(/[^\d-]/g, ''), 10);
                    let desc = row['E'] || '';
                    let memo = row['F'] || '';

                    if (isNaN(amount) || isNaN(code)) continue;

                    let dateObj = new Date(dateStr);
                    if (!isNaN(dateObj.getTime())) {
                        dateObj.setFullYear(year);
                        const validY = dateObj.getFullYear();
                        const validM = String(dateObj.getMonth() + 1).padStart(2, '0');
                        const validD = String(dateObj.getDate()).padStart(2, '0');
                        dateStr = `${validY}-${validM}-${validD}`;

                        const fiscalMonth = getFiscalMonth(dateStr);

                        insertRows.push([dateStr, fiscalMonth, amount, 'EXPENSE', code, desc, memo]);
                        results.daily++;
                    }
                }

                if (insertRows.length > 0) {
                    await bulkInsert(db, 'transactions', ['date', 'fiscal_month', 'amount', 'type', 'category_code', 'description', 'memo'], insertRows);
                }
            }

            // FIXED COSTS MOVED TO PHASE 2
            // To prevent Daily sheets from deleting Fixed Data.
        }

        // PHASE 2: Process FIXED Sheets (Overlay)
        console.log('[Execute] Starting Phase 2: Fixed Costs');
        for (const sheetName of workbook.SheetNames) {
            await new Promise(r => setTimeout(r, 20));

            const matchFixed = sheetName.match(/^(\d{4})年公共料金等$/);
            if (matchFixed) {
                const year = parseInt(matchFixed[1], 10);

                // FILTER: Skip if targetYear is specified and mismatch
                if (targetYear && parseInt(targetYear, 10) !== year) {
                    continue;
                }

                res.write(JSON.stringify({ type: 'progress', message: `${sheetName} (固定費) を処理中...` }) + '\n');
                const sheet = workbook.Sheets[sheetName];

                console.log(`[Execute] Parsing Fixed Costs for ${sheetName}`);
                const rows = xlsx.utils.sheet_to_json(sheet, { header: 'A', range: 3 });
                console.log(`[Execute] Fixed Costs Rows Found: ${rows.length}`);

                const categoryMap = { 'B': 604, 'C': 601, 'D': 603, 'E': 606, 'F': 602, 'G': 605, 'H': 607, 'I': 901, 'J': 608 };

                let idx = 0;
                for (const row of rows) {
                    if (idx > 11) break;

                    const month = idx + 1;
                    const fiscalMonth = `${year}-${String(month).padStart(2, '0')}`;
                    const dateStr = `${fiscalMonth}-01`;

                    console.log(`[Execute] Processing Fixed Cost Row ${idx} (Month: ${month})`);

                    const fixedCodes = Object.values(categoryMap);
                    const placeholders = fixedCodes.map(() => '?').join(',');

                    // Async Delete (Specific to Fixed Codes)
                    await new Promise((resolve) => {
                        db.run(`DELETE FROM transactions WHERE fiscal_month = ? AND category_code IN (${placeholders})`, [fiscalMonth, ...fixedCodes], () => resolve());
                    });

                    for (const colKey of Object.keys(categoryMap)) {
                        if (row[colKey]) {
                            let amount = parseInt(String(row[colKey]).replace(/[^\d-]/g, ''), 10);
                            if (!isNaN(amount) && amount > 0) {
                                const code = categoryMap[colKey];
                                console.log(`  -> Inserting ${code}: ${amount}`);

                                await new Promise((resolve) => {
                                    db.run(`
                                        INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo)
                                        VALUES (?, ?, ?, 'EXPENSE', ?, 'ExcelImport', '固定費')
                                    `, [dateStr, fiscalMonth, amount, code], (err) => {
                                        if (err) console.error('Insert Failed:', err);
                                        resolve();
                                    });
                                });
                                results.fixed++;
                            }
                        }
                    }
                    idx++;
                }
            }

            // FIXED COSTS (Alternative: yyyy合計)
            const matchTotal = sheetName.match(/^(\d{4})合計$/);
            if (matchTotal) {
                const year = parseInt(matchTotal[1], 10);
                if (targetYear && parseInt(targetYear, 10) !== year) continue;

                res.write(JSON.stringify({ type: 'progress', message: `${sheetName} (固定費・別形式) を処理中...` }) + '\n');
                const sheet = workbook.Sheets[sheetName];

                // 3rd row is Header (Index 2), 4th row start Data (Index 3)
                const rows = xlsx.utils.sheet_to_json(sheet, { header: 'A', range: 3 });
                // range: 3 means start reading from Row 4 (0,1,2,3... index 3 is Row 4)

                // Column Map (0-based index in A,B,C...)
                // G(6): Rent(604), H(7): Elec(601), I(8)+J(9): Gas(603), K(10): Water(602)
                // L(11): Phone(605), M(12): Mobile(607), N(13): Pocket(901)
                const directMap = {
                    'G': 604, 'H': 601, 'K': 602, 'L': 605, 'M': 607, 'N': 901
                };

                let monthIdx = 0;
                for (const row of rows) {
                    if (monthIdx >= 12) break; // Max 12 months
                    const month = monthIdx + 1;
                    const fiscalMonth = `${year}-${String(month).padStart(2, '0')}`;
                    const dateStr = `${fiscalMonth}-01`;

                    console.log(`[Execute] Processing Alt Fixed Cost (Month: ${month})`);

                    // Prepare codes to delete for this month (All potential fixed costs in this format)
                    const fixedCodes = [604, 601, 603, 602, 605, 607, 901];
                    // Note: Insurance(608) and Dishwasher(606) not in this format, so we don't touch them?
                    // Or should we wipe them too to be safe/clean? 
                    // User said "Insurance/Dishwasher columns don't exist". 
                    // Safer to ONLY touch the codes we are importing. Leaving others alone implies they might be manually entered?
                    // But usually "Import" overwrites. 
                    // Let's stick to deleting only the codes we handle here. 

                    const placeholders = fixedCodes.map(() => '?').join(',');
                    await new Promise((resolve) => {
                        db.run(`DELETE FROM transactions WHERE fiscal_month = ? AND category_code IN (${placeholders})`, [fiscalMonth, ...fixedCodes], () => resolve());
                    });

                    // 1. Direct Mappings
                    for (const colKey of Object.keys(directMap)) {
                        if (row[colKey]) {
                            let amount = parseInt(String(row[colKey]).replace(/[^\d-]/g, ''), 10);
                            if (!isNaN(amount) && amount > 0) {
                                const code = directMap[colKey];
                                await new Promise((resolve) => {
                                    db.run(`INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo) VALUES (?, ?, ?, 'EXPENSE', ?, 'ExcelImport', '固定費(合計シート)')`,
                                        [dateStr, fiscalMonth, amount, code], () => resolve());
                                });
                                results.fixed++;
                            }
                        }
                    }

                    // 2. Gas (I + J)
                    let gasAmount = 0;
                    if (row['I']) gasAmount += (parseInt(String(row['I']).replace(/[^\d-]/g, ''), 10) || 0);
                    if (row['J']) gasAmount += (parseInt(String(row['J']).replace(/[^\d-]/g, ''), 10) || 0);

                    if (gasAmount > 0) {
                        await new Promise((resolve) => {
                            db.run(`INSERT INTO transactions (date, fiscal_month, amount, type, category_code, description, memo) VALUES (?, ?, ?, 'EXPENSE', ?, 'ExcelImport', '固定費(合計シート)')`,
                                [dateStr, fiscalMonth, gasAmount, 603], () => resolve());
                        });
                        results.fixed++;
                    }

                    monthIdx++;
                }
            }
        }

        res.write(JSON.stringify({ type: 'complete', results }) + '\n');
        res.end();
        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (e) {
        console.error('[Execute] Error:', e);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        try {
            res.write(JSON.stringify({ type: 'error', error: e.message }) + '\n');
            res.end();
        } catch (err) { }
    }
});

module.exports = router;
