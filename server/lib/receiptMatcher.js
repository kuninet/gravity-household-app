// レシートファイルと DB (transactions テーブル) の突合ロジック。
// scripts/check-receipts.js (CLI) と server/routes/receipts.js (API) の両方から
// 参照される純粋なロジック部分をここに集約する。
//
// 店名の別名置換（別名表ファイル参照）は正規化後の文字列に対する 1 パスの
// 一括置換であり、置換結果が別のキーに再度マッチして連鎖することはない。

const fs = require('fs');
const path = require('path');

const DEFAULT_ALIASES_PATH = path.join(__dirname, 'receipt-store-aliases.json');
const RECEIPT_PREFIX = 'レシート-';

// ---- ファイル名解析 ----------------------------------------------------

// ファイル名（拡張子含む）から日付と店名を取り出す。
// パターン: YYYYMMDD-店名[_連番].拡張子
// 例: "20260715-スーパーアークス_027.pdf" -> { date: '2026-07-15', store: 'スーパーアークス' }
// 例: "20260729-レシート-ローソンユナイテッドシネマ.pdf" -> { date: '2026-07-29', store: 'ローソンユナイテッドシネマ' }
// パターンに一致しない場合は null を返す。
function parseFileName(filename) {
  if (typeof filename !== 'string') return null;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  const m = base.match(/^(\d{8})-(.+?)(?:_\d+)?$/);
  if (!m) return null;

  const [, dateDigits, rawStore] = m;
  const year = Number(dateDigits.slice(0, 4));
  const month = Number(dateDigits.slice(4, 6));
  const day = Number(dateDigits.slice(6, 8));

  // 実在する日付かどうかを検証する（例: 2月30日は不正）
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }

  let store = rawStore;
  if (store.startsWith(RECEIPT_PREFIX)) {
    store = store.slice(RECEIPT_PREFIX.length);
  }
  if (!store) return null;

  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { filename, date, store };
}

// ---- 店名正規化・照合 ----------------------------------------------------

// 表記ゆれ除去用の記号（ハイフン類・中黒・括弧）。長音「ー」は店名の一部として残す。
const NOISE_CHARS_RE = /[\s\-‐−–—‑・()（）]/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// NFKC 正規化 -> 小文字化 -> 空白・ハイフン類・中黒・括弧の除去。
function cleanStore(s) {
  return s.normalize('NFKC').toLowerCase().replace(NOISE_CHARS_RE, '');
}

// 別名表（キー・値とも cleanStore で正規化）から、正規化後の文字列に対する
// 1 本の一括置換関数を作る。長いキーから順にマッチさせ、置換は 1 パスのみ
// （置換結果に対して別のキーが再マッチして連鎖することはない）。
const aliasReplacerCache = new WeakMap();
function getAliasReplacer(aliases) {
  if (!aliases) return (s) => s;
  if (aliasReplacerCache.has(aliases)) return aliasReplacerCache.get(aliases);

  const entries = Object.entries(aliases)
    .map(([key, value]) => [cleanStore(key), cleanStore(value)])
    .filter(([key]) => key.length > 0)
    .sort((a, b) => b[0].length - a[0].length);

  let replacer;
  if (entries.length === 0) {
    replacer = (s) => s;
  } else {
    const valueMap = new Map(entries);
    const pattern = new RegExp(entries.map(([key]) => escapeRegExp(key)).join('|'), 'g');
    replacer = (s) => s.replace(pattern, (matched) => valueMap.get(matched));
  }

  aliasReplacerCache.set(aliases, replacer);
  return replacer;
}

// 店名を正規化する: NFKC正規化・小文字化・記号除去のうえ、別名表を 1 パスで適用する。
function normalizeStore(name, aliases) {
  if (!name) return '';
  return getAliasReplacer(aliases)(cleanStore(name));
}

// 正規化済みの店名同士を比較する。
// どちらかの文字数が 2 文字以下の場合は完全一致のみを一致とみなす（短い文字列同士の
// 誤爆を避けるため）。それ以外は、どちらかがどちらかを含んでいれば一致とみなす。
// 空文字同士・片方が空文字の場合は不一致。
function storeMatches(a, b) {
  if (!a || !b) return false;
  if (a.length <= 2 || b.length <= 2) {
    return a === b;
  }
  return a.includes(b) || b.includes(a);
}

// ---- 日付ユーティリティ ----------------------------------------------------

function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db_ = Date.UTC(by, bm - 1, bd);
  return Math.round((db_ - da) / 86400000);
}

// 会計月 (YYYY-MM) から実際の期間 (前月23日 - 当月22日) を返す。
// client/src/utils.js の getFiscalMonthRange と同じロジック。
// 例: "2026-08" -> { start: "2026-07-23", end: "2026-08-22" }
function getFiscalMonthRange(fiscalMonth) {
  const [y, m] = fiscalMonth.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, 22));
  const start = new Date(Date.UTC(y, m - 2, 23));
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
}

// ---- 別名表読み込み ----------------------------------------------------

// 別名表ファイルを読み込む。path 省略時は server/lib/receipt-store-aliases.json を使う。
function loadAliases(aliasesPath) {
  const resolved = path.resolve(aliasesPath || DEFAULT_ALIASES_PATH);
  const raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

// ---- 突合処理 ----------------------------------------------------

// fileNames: フォルダ直下のファイル名（拡張子つき）の配列
// transactions: { id, date, memo, amount } の配列（DB から取得した支出取引）
// aliases: 店名別名表
// fiscalRange: { start, end } (YYYY-MM-DD、両端含む) を指定すると、この範囲外の
//              日付のファイルは突合対象から外し outOfRangeFiles に分類する。
//              null/undefined の場合は全ファイルを対象にする（--month 省略時）。
// reportingRange: { start, end } (YYYY-MM-DD、両端含む)。dbOnly / noMemoCount の集計を
//              この範囲内の取引に限定する。transactions には照合候補として境界±1日分の
//              取引も含まれているため、レポートの集計対象からはその境界日分を除く。
//              null/undefined の場合は transactions 全体を対象にする。
//
// 戻り値:
//   matchedFiles:   [{ file, transactions, warning }]  登録済みと判定されたファイル
//   missingFiles:   [file]                              入れ忘れ候補
//   unparsedFiles:  [filename]                          ファイル名解析不能
//   outOfRangeFiles:[file]                               指定会計月の範囲外のファイル
//   dbOnly:         [transaction]                        どのファイルにも紐づかなかった取引（memo ありのみ）
//   noMemoCount:    number                               memo が空で照合対象外の取引数
//
// 照合は 2 段階で行う:
//   (a) 同日・同店（正規化後）のグループごとに、日付が完全一致する取引を割り当てる。
//   (b) (a) で 1 件も割り当たらなかったグループのみ、まだ割り当てられていない取引の中から
//       ±1 日以内で探す（見つかれば「隣接日の取引で一致」の警告を付ける）。
// 一度割り当てられた取引は他のグループには使い回さない（DB にのみ存在からも除外する）。
// 同日同店のファイルが 2 枚以上あるグループは、明細数と枚数が単純比較できないため
// 常に「同日同店 N枚（DB明細 M件）要目視確認」の警告を付ける。
function matchReceipts(fileNames, transactions, aliases, fiscalRange, reportingRange) {
  const parsedFiles = [];
  const unparsedFiles = [];

  for (const filename of fileNames) {
    const parsed = parseFileName(filename);
    if (!parsed) {
      unparsedFiles.push(filename);
    } else {
      parsedFiles.push(parsed);
    }
  }

  let outOfRangeFiles = [];
  if (fiscalRange) {
    outOfRangeFiles = parsedFiles.filter((f) => f.date < fiscalRange.start || f.date > fiscalRange.end);
  }
  const isInRange = (date) => !fiscalRange || (date >= fiscalRange.start && date <= fiscalRange.end);

  // 同日・同店（正規化後）のファイルをグループ化する。会計月範囲外のファイルも
  // グループ化して取引の「消費」だけは行う（境界日の取引が DB にのみ存在に
  // 残らないようにするため）。ただし表示（登録済み/入れ忘れ候補）には出さず、
  // 対象外（別会計月）のままにする。
  const groups = new Map();
  for (const file of parsedFiles) {
    const normStore = normalizeStore(file.store, aliases);
    const key = `${file.date}|${normStore}`;
    if (!groups.has(key)) {
      groups.set(key, { date: file.date, normStore, files: [] });
    }
    groups.get(key).files.push(file);
  }
  // 同日内では、より具体的な（正規化後の文字数が長い）店名を優先して先に候補を
  // 消費させる。同じ長さの場合は localeCompare で決定的な順序にする。
  const groupList = Array.from(groups.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.normStore.length !== b.normStore.length) return b.normStore.length - a.normStore.length;
    return a.normStore.localeCompare(b.normStore);
  });

  const targetTransactions = transactions.filter((t) => t.memo);
  const consumed = new Set();
  const availableTransactions = () => targetTransactions.filter((t) => !consumed.has(t.id));

  const countWarning = (group, matchCount) =>
    group.files.length > 1 ? `同日同店 ${group.files.length}枚（DB明細 ${matchCount}件）要目視確認` : null;

  const matchedFiles = [];
  const missingFiles = [];
  const unmatchedGroups = [];

  // (a) 日付完全一致で候補を割り当てる
  for (const group of groupList) {
    const candidates = availableTransactions().filter(
      (t) => t.date === group.date && storeMatches(group.normStore, normalizeStore(t.memo, aliases))
    );
    if (candidates.length > 0) {
      candidates.forEach((t) => consumed.add(t.id));
      if (isInRange(group.date)) {
        const warning = countWarning(group, candidates.length);
        for (const file of group.files) {
          matchedFiles.push({ file, transactions: candidates, warning });
        }
      }
    } else {
      unmatchedGroups.push(group);
    }
  }

  // (b) 未一致グループのみ、消費済みでない取引から ±1 日で探す
  for (const group of unmatchedGroups) {
    const candidates = availableTransactions().filter(
      (t) => Math.abs(diffDays(group.date, t.date)) <= 1 && storeMatches(group.normStore, normalizeStore(t.memo, aliases))
    );
    const inRange = isInRange(group.date);
    if (candidates.length > 0) {
      candidates.forEach((t) => consumed.add(t.id));
      if (inRange) {
        const warnings = ['隣接日の取引で一致', countWarning(group, candidates.length)].filter(Boolean);
        const warning = warnings.join(' / ');
        for (const file of group.files) {
          matchedFiles.push({ file, transactions: candidates, warning });
        }
      }
    } else if (inRange) {
      for (const file of group.files) {
        missingFiles.push(file);
      }
    }
  }

  // DB取得時は±1日分を照合候補として広めに取っているため（境界日のグループ照合用）、
  // 「DB にのみ存在」「店名なし取引」の集計はレポート対象範囲（reportingRange）内に限定する。
  // ±1日分はあくまで照合候補としてのみ使い、範囲外の取引は集計に含めない。
  const inReportingRange = (t) => !reportingRange || (t.date >= reportingRange.start && t.date <= reportingRange.end);

  const dbOnly = targetTransactions.filter((t) => !consumed.has(t.id) && inReportingRange(t));
  const noMemoCount = transactions.filter((t) => !t.memo && inReportingRange(t)).length;

  return { matchedFiles, missingFiles, unparsedFiles, outOfRangeFiles, dbOnly, noMemoCount };
}

// 「DB にのみ存在」の一覧を (日付, 正規化後メモ) 単位でまとめる。
// 1 枚のレシートに複数明細が並ぶのが通常のため、明細ごとに出すと読めなくなる。
function groupDbOnlyTransactions(transactions, aliases) {
  const groups = new Map();
  for (const t of transactions) {
    const key = `${t.date}|${normalizeStore(t.memo, aliases)}`;
    if (!groups.has(key)) {
      groups.set(key, { date: t.date, memo: t.memo, count: 0, total: 0 });
    }
    const g = groups.get(key);
    g.count += 1;
    g.total += t.amount;
  }
  return Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  RECEIPT_PREFIX,
  NOISE_CHARS_RE,
  DEFAULT_ALIASES_PATH,
  parseFileName,
  cleanStore,
  getAliasReplacer,
  normalizeStore,
  storeMatches,
  shiftDateStr,
  diffDays,
  getFiscalMonthRange,
  loadAliases,
  matchReceipts,
  groupDbOnlyTransactions,
};
