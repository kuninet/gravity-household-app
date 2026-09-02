#!/usr/bin/env node

// レシートファイルと DB (transactions テーブル) の突合ツール。
// 指定フォルダ内のレシートファイル名から日付・店名を読み取り、
// DB の該当会計月（または日付範囲）の支出取引と照合して、
// 登録漏れの候補や DB にしかない取引を検出する。
//
// 使い方:
//   node scripts/check-receipts.js <フォルダ> [--db <path>] [--month YYYY-MM] [--aliases <path>]
//
// 突合ロジック本体は server/lib/receiptMatcher.js に切り出してあり、
// 画面版の API (server/routes/receipts.js) と共有している。
//
// 終了コード: 入れ忘れ候補あり = 1 / 引数・DB 関連のエラー = 2 / 問題なし = 0

const fs = require('fs');
const path = require('path');
const {
  parseFileName,
  normalizeStore,
  getFiscalMonthRange,
  shiftDateStr,
  matchReceipts,
  groupDbOnlyTransactions,
  DEFAULT_ALIASES_PATH,
} = require('../server/lib/receiptMatcher');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'server', 'household.db');

// ---- コンソール出力 ----------------------------------------------------

// 全角文字を幅 2 として文字列の表示幅を計算する（表の桁揃え用）
function displayWidth(str) {
  let width = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += isWide ? 2 : 1;
  }
  return width;
}

function padDisplay(str, targetWidth) {
  const w = displayWidth(str);
  return str + ' '.repeat(Math.max(0, targetWidth - w));
}

function printTable(headers, rows) {
  if (rows.length === 0) {
    console.log('  （該当なし）');
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(String(r[i] ?? ''))))
  );
  console.log(headers.map((h, i) => padDisplay(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(row.map((c, i) => padDisplay(String(c ?? ''), widths[i])).join('  '));
  }
}

function formatTransactionCell(transactions) {
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  return `${transactions.length}件 合計${total}円`;
}

// ---- CLI 本体 ----------------------------------------------------

const OPTIONS_WITH_VALUE = ['--db', '--month', '--aliases'];

function parseArgs(argv) {
  const result = { folder: null, db: null, month: null, aliases: null };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (!OPTIONS_WITH_VALUE.includes(a)) {
        fail(`不明なオプションです: ${a}`);
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`${a} には値を指定してください。`);
      }
      i++;
      if (a === '--db') result.db = value;
      else if (a === '--month') result.month = value;
      else if (a === '--aliases') result.aliases = value;
    } else {
      rest.push(a);
    }
  }
  result.folder = rest[0] || null;
  return result;
}

function fail(message, code = 2) {
  console.error(`エラー: ${message}`);
  process.exit(code);
}

// sqlite3 モジュールを読み込む。ルート直下に依存が無い構成のため、
// まず通常の require を試し、失敗したら server 側の node_modules を試す。
function loadSqlite3() {
  try {
    return require('sqlite3');
  } catch (rootErr) {
    try {
      return require(path.join(__dirname, '..', 'server', 'node_modules', 'sqlite3'));
    } catch (serverErr) {
      fail('sqlite3 モジュールが見つかりません。"npm run setup" を実行してください。');
      return undefined; // fail() が process.exit するためここには到達しない
    }
  }
}

function openDatabase(sqlite3, dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject({ db, error: err });
      } else {
        resolve(db);
      }
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }
    db.close(() => resolve());
  });
}

function queryAll(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function failAfterClose(db, message, code = 2) {
  await closeDatabase(db);
  console.error(`エラー: ${message}`);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.folder) {
    fail('レシートフォルダのパスを指定してください。使い方: node scripts/check-receipts.js <フォルダ> [--db <path>] [--month YYYY-MM] [--aliases <path>]');
  }
  const folder = path.resolve(args.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    fail(`フォルダが見つかりません: ${folder}`);
  }

  const dbPath = path.resolve(args.db || DEFAULT_DB_PATH);
  if (!fs.existsSync(dbPath)) {
    fail(`DB ファイルが見つかりません: ${dbPath}`);
  }

  if (args.month && !/^\d{4}-\d{2}$/.test(args.month)) {
    fail(`--month は YYYY-MM 形式で指定してください: ${args.month}`);
  }

  const aliasesPath = path.resolve(args.aliases || DEFAULT_ALIASES_PATH);
  if (!fs.existsSync(aliasesPath)) {
    fail(`別名表ファイルが見つかりません: ${aliasesPath}`);
  }
  let aliases;
  try {
    aliases = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));
  } catch (err) {
    fail(`別名表ファイルの読み込みに失敗しました: ${err.message}`);
  }

  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const fileNames = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name.normalize('NFC'));

  const sqlite3 = loadSqlite3();

  let fiscalRange = null;
  let reportingRange;
  let sql = "SELECT id, date, memo, amount FROM transactions WHERE type = 'EXPENSE'";
  const params = [];

  if (args.month) {
    fiscalRange = getFiscalMonthRange(args.month);
    reportingRange = fiscalRange;
    // ±1 日分は境界日のファイルとの照合候補としてのみ使うため広めに取得する
    sql += ' AND date BETWEEN ? AND ?';
    params.push(shiftDateStr(fiscalRange.start, -1), shiftDateStr(fiscalRange.end, 1));
  } else {
    const parsedDates = fileNames
      .map((name) => parseFileName(name))
      .filter(Boolean)
      .map((f) => f.date);
    if (parsedDates.length === 0) {
      fail('対象の会計月または日付範囲を決定できません（--month を指定するか、解析可能なファイルを用意してください）。');
    }
    const minDate = parsedDates.reduce((a, b) => (a < b ? a : b));
    const maxDate = parsedDates.reduce((a, b) => (a > b ? a : b));
    reportingRange = { start: minDate, end: maxDate };
    // ±1 日分は境界日のファイルとの照合候補としてのみ使うため広めに取得する
    sql += ' AND date BETWEEN ? AND ?';
    params.push(shiftDateStr(minDate, -1), shiftDateStr(maxDate, 1));
  }

  let db;
  try {
    db = await openDatabase(sqlite3, dbPath);
  } catch (e) {
    // オープンに失敗したハンドルは sqlite3 が close コールバックを呼ばないことがあるため、
    // close を待たずに直接エラー終了する。
    const message = e && e.error ? e.error.message : (e && e.message) || String(e);
    console.error(`エラー: DB を開けませんでした: ${message}`);
    process.exit(2);
    return;
  }

  let rows;
  try {
    rows = await queryAll(db, sql, params);
  } catch (err) {
    await failAfterClose(db, `DB の読み込みに失敗しました: ${err.message}`);
    return;
  }
  await closeDatabase(db);

  const result = matchReceipts(fileNames, rows, aliases, fiscalRange, reportingRange);
  printReport(result, aliases);

  process.exit(result.missingFiles.length > 0 ? 1 : 0);
}

function printReport(result, aliases) {
  const { matchedFiles, missingFiles, unparsedFiles, outOfRangeFiles, dbOnly, noMemoCount } = result;

  console.log('■ 登録済み');
  // 出力直前に日付（同日はファイル名）でソートする
  const sortedMatchedFiles = [...matchedFiles].sort((a, b) =>
    a.file.date === b.file.date ? a.file.filename.localeCompare(b.file.filename) : a.file.date.localeCompare(b.file.date)
  );
  printTable(
    ['ファイル名', '日付', '店名', '一致した取引', '警告'],
    sortedMatchedFiles.map((m) => [
      m.file.filename,
      m.file.date,
      m.file.store,
      formatTransactionCell(m.transactions),
      m.warning || '',
    ])
  );

  console.log('');
  console.log('■ 入れ忘れ候補');
  if (noMemoCount > 0 && missingFiles.length > 0) {
    console.log(`  （店名なし取引 ${noMemoCount} 件は照合対象外のため、誤検出の可能性があります）`);
  }
  printTable(
    ['ファイル名', '日付', '店名'],
    missingFiles.map((f) => [f.filename, f.date, f.store])
  );

  console.log('');
  console.log('■ 対象外（別会計月）');
  printTable(
    ['ファイル名', '日付'],
    outOfRangeFiles.map((f) => [f.filename, f.date])
  );

  console.log('');
  console.log('■ DB にのみ存在');
  const dbOnlyGroups = groupDbOnlyTransactions(dbOnly, aliases);
  printTable(
    ['日付', 'メモ', '件数', '合計金額'],
    dbOnlyGroups.map((g) => [g.date, g.memo || '', `${g.count}件`, `${g.total}円`])
  );

  console.log('');
  console.log('■ 解析不能ファイル');
  printTable(['ファイル名'], unparsedFiles.map((f) => [f]));

  console.log('');
  console.log('■ サマリ');
  console.log(`  登録済み: ${matchedFiles.length} 件`);
  console.log(`  入れ忘れ候補: ${missingFiles.length} 件`);
  console.log(`  対象外（別会計月）: ${outOfRangeFiles.length} 件`);
  console.log(`  DB にのみ存在: ${dbOnly.length} 件（${dbOnlyGroups.length} グループ）`);
  console.log(`  解析不能: ${unparsedFiles.length} 件`);
  console.log(`  店名なし取引: ${noMemoCount} 件（照合対象外）`);
}

if (require.main === module) {
  main();
}
