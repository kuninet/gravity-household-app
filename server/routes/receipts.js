const express = require('express');
const router = express.Router();
const db = require('../db');
const {
    parseFileName,
    getFiscalMonthRange,
    shiftDateStr,
    loadAliases,
    matchReceipts,
    groupDbOnlyTransactions,
} = require('../lib/receiptMatcher');

// 別名表はサーバー起動時（モジュール読み込み時）に一度だけ読み込んで使い回す。
// 編集内容を反映するにはサーバーの再起動が必要（README にも明記）。
let aliases;
try {
    aliases = loadAliases();
} catch (err) {
    console.error(`別名表の読み込みに失敗しました: ${err.message}`);
    aliases = {};
}

const MAX_FILE_NAMES = 2000;
const MAX_FILENAME_LENGTH = 255;

// fileNames の入力検証。1〜MAX_FILE_NAMES 件、各要素は 1〜MAX_FILENAME_LENGTH 文字の string。
// 違反時はエラーメッセージを返し、問題なければ null を返す。
function validateFileNames(fileNames) {
    if (!Array.isArray(fileNames) || fileNames.length === 0) {
        return 'fileNames は 1 件以上を含む配列で指定してください。';
    }
    if (fileNames.length > MAX_FILE_NAMES) {
        return `fileNames は ${MAX_FILE_NAMES} 件以下で指定してください。`;
    }
    for (const name of fileNames) {
        if (typeof name !== 'string' || name.length < 1 || name.length > MAX_FILENAME_LENGTH) {
            return `fileNames の各要素は 1〜${MAX_FILENAME_LENGTH} 文字の文字列で指定してください。`;
        }
    }
    return null;
}

// レシートファイル名一覧と DB の支出取引を突合する。
// CLI (scripts/check-receipts.js) と同じロジックを共有する。
//
// リクエスト body: { fileNames: string[], month?: 'YYYY-MM' }
// month を指定すると、その会計月（前月23日〜当月22日）の範囲で突合する。
// 省略時は fileNames から解析できた日付の最小〜最大を範囲とする。
router.post('/check', (req, res) => {
    const { fileNames, month } = req.body || {};

    const validationError = validateFileNames(fileNames);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (month !== undefined && month !== null && month !== '' && !/^\d{4}-\d{2}$/.test(month)) {
        res.status(400).json({ error: 'month は YYYY-MM 形式で指定してください。' });
        return;
    }

    let fiscalRange = null;
    let reportingRange = null;
    let dbStart = null;
    let dbEnd = null;

    if (month) {
        fiscalRange = getFiscalMonthRange(month);
        reportingRange = fiscalRange;
        // ±1 日分は境界日のファイルとの照合候補としてのみ使うため広めに取得する
        dbStart = shiftDateStr(fiscalRange.start, -1);
        dbEnd = shiftDateStr(fiscalRange.end, 1);
    } else {
        const parsedDates = fileNames
            .map((name) => parseFileName(name))
            .filter(Boolean)
            .map((f) => f.date);

        if (parsedDates.length === 0) {
            // 解析可能ファイルが 0 件なら DB 照会せず空結果を返す
            res.json({
                range: null,
                matched: [],
                missing: [],
                outOfRange: [],
                dbOnly: [],
                unparsed: fileNames,
                summary: {
                    matched: 0,
                    missing: 0,
                    outOfRange: 0,
                    dbOnly: 0,
                    dbOnlyGroups: 0,
                    unparsed: fileNames.length,
                    noMemo: 0,
                },
            });
            return;
        }

        const minDate = parsedDates.reduce((a, b) => (a < b ? a : b));
        const maxDate = parsedDates.reduce((a, b) => (a > b ? a : b));
        reportingRange = { start: minDate, end: maxDate };
        dbStart = shiftDateStr(minDate, -1);
        dbEnd = shiftDateStr(maxDate, 1);
    }

    const sql = "SELECT id, date, memo, amount FROM transactions WHERE type = 'EXPENSE' AND date BETWEEN ? AND ?";
    db.all(sql, [dbStart, dbEnd], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const result = matchReceipts(fileNames, rows, aliases, fiscalRange, reportingRange);
        const { matchedFiles, missingFiles, unparsedFiles, outOfRangeFiles, dbOnly, noMemoCount } = result;

        const dbOnlyGroups = groupDbOnlyTransactions(dbOnly, aliases);

        res.json({
            range: reportingRange,
            matched: matchedFiles.map((m) => ({
                filename: m.file.filename,
                date: m.file.date,
                store: m.file.store,
                transactionCount: m.transactions.length,
                totalAmount: m.transactions.reduce((sum, t) => sum + t.amount, 0),
                warning: m.warning || null,
            })),
            missing: missingFiles.map((f) => ({
                filename: f.filename,
                date: f.date,
                store: f.store,
            })),
            outOfRange: outOfRangeFiles.map((f) => ({
                filename: f.filename,
                date: f.date,
                store: f.store,
            })),
            dbOnly: dbOnlyGroups.map((g) => ({
                date: g.date,
                memo: g.memo,
                count: g.count,
                totalAmount: g.total,
            })),
            unparsed: unparsedFiles,
            summary: {
                matched: matchedFiles.length,
                missing: missingFiles.length,
                outOfRange: outOfRangeFiles.length,
                dbOnly: dbOnly.length,
                dbOnlyGroups: dbOnlyGroups.length,
                unparsed: unparsedFiles.length,
                noMemo: noMemoCount,
            },
        });
    });
});

module.exports = router;
