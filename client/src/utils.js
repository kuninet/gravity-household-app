export function getFiscalMonth(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate();
    let year = date.getFullYear();
    let month = date.getMonth() + 1; // 0-indexed

    if (day >= 23) {
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return `${year}-${String(month).padStart(2, '0')}`;
}

// 会計月 (YYYY-MM) から実際の期間 (前月23日 - 当月22日) を返す。
// 例: "2026-08" → { start: "2026-07-23", end: "2026-08-22" }
export function getFiscalMonthRange(fiscalMonth) {
    const [y, m] = fiscalMonth.split('-').map(Number);
    const end = new Date(y, m - 1, 22);
    const start = new Date(y, m - 2, 23);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(start), end: fmt(end) };
}

// 会計月レンジを短い表示形式で返す。例: "2026-08" → "7/23 – 8/22"
export function getFiscalMonthRangeLabel(fiscalMonth) {
    const { start, end } = getFiscalMonthRange(fiscalMonth);
    const [, sm, sd] = start.split('-').map(Number);
    const [, em, ed] = end.split('-').map(Number);
    return `${sm}/${sd} – ${em}/${ed}`;
}

// カテゴリコードからパレット色（Tailwind クラス接尾辞）を返す。
// 円グラフ・明細ピル・凡例で同じ色が使われるように一元化。
// server/seed.js のグループ (100:食費 / 200:日用品 / 300:交通費 / 400:交際費 /
// 500:医療費 / 600:固定費 / 700:収入 / 900:その他) と一致させる。
const CATEGORY_PALETTE_MAP = {
    100: 'food',
    200: 'other',
    300: 'trans',
    400: 'leisure',
    500: 'health',
    600: 'util',
    700: 'income',
    900: 'other',
};

export function getCategoryPaletteKey(code) {
    if (code == null) return 'other';
    const num = Number(code);
    if (Number.isFinite(num)) {
        const bucket = Math.floor(num / 100) * 100;
        if (CATEGORY_PALETTE_MAP[bucket]) return CATEGORY_PALETTE_MAP[bucket];
    }
    return 'other';
}

// group_name 文字列から色キーを推定するフォールバック（集計 API は group_name で返る）。
// カテゴリ seed の group を優先マッチさせる。
const GROUP_NAME_HINTS = [
    { key: 'food', re: /^食費$|食料|外食/ },
    { key: 'other', re: /^日用品$/ },
    { key: 'trans', re: /^交通費$|自動車|ガソリン/ },
    { key: 'leisure', re: /^交際費$|娯楽|レジャー|趣味/ },
    { key: 'health', re: /^医療費$|健康/ },
    { key: 'util', re: /^固定費$|光熱|水道|電気|ガス|家賃|通信|電話|保険/ },
    { key: 'income', re: /^収入$|給与|賞与|ボーナス|年金|配当/ },
];

export function getCategoryPaletteKeyByName(name) {
    if (!name) return 'other';
    for (const hint of GROUP_NAME_HINTS) {
        if (hint.re.test(name)) return hint.key;
    }
    return 'other';
}

// パレットキー → 実際の CSS 色（HEX）。Chart.js など Tailwind クラスを使えない箇所用。
// getComputedStyle で :root の CSS 変数を読むことでダーク時も自動追従。
export function getCategoryColor(key) {
    if (typeof window === 'undefined') return '#75726a';
    const styles = getComputedStyle(document.documentElement);
    const val = styles.getPropertyValue(`--color-cat-${key}`).trim();
    return val || '#75726a';
}

