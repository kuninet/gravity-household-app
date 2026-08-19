const { test, expect } = require('@playwright/test');

// 本番データを汚さないため、翌年 (currentYear + 1) を使用する。
// 直近未来の年は固定入力のドロップダウン (availableYears) にも含まれるため UI から選択可能。
const TEST_YEAR = new Date().getFullYear() + 1;
const INCOME_CODES = [700];
const EXPENSE_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608];

async function clearFixedCells(request, year) {
  const cells = [];
  for (let m = 1; m <= 12; m++) {
    for (const code of INCOME_CODES) {
      cells.push({ month: m, category_code: code, amount: 0, type: 'INCOME' });
    }
    for (const code of EXPENSE_CODES) {
      cells.push({ month: m, category_code: code, amount: 0, type: 'EXPENSE' });
    }
  }
  await request.post('/api/fixed_costs/batch_update', { data: { year, cells } });
}

async function openFixedTab(page) {
  await page.getByRole('button', { name: '固定入力' }).click();
  await expect(page.getByRole('heading', { name: '毎月の固定入力（収入・支出）' })).toBeVisible();
}

async function selectTestYear(page) {
  const yearSelect = page
    .getByRole('heading', { name: '毎月の固定入力（収入・支出）' })
    .locator('..')
    .locator('select');
  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes('/api/fixed_costs/matrix') &&
      r.url().includes(`year=${TEST_YEAR}`)
  );
  await yearSelect.selectOption(String(TEST_YEAR));
  await respPromise;
}

function incomeTable(page) {
  return page
    .getByRole('heading', { name: '収入', exact: true })
    .locator('..')
    .locator('table');
}

function expenseTable(page) {
  return page
    .getByRole('heading', { name: '支出', exact: true })
    .locator('..')
    .locator('table');
}

function summaryTable(page) {
  return page
    .getByRole('heading', { name: '集計', exact: true })
    .locator('..')
    .locator('table');
}

// monthIndex は 0 起点 (0 = 1月)。colIndex はセクション内の 0 起点。
function incomeCell(page, monthIndex, colIndex = 0) {
  return incomeTable(page)
    .locator('tbody > tr')
    .nth(monthIndex)
    .locator('input[type="text"]')
    .nth(colIndex);
}

function expenseCell(page, monthIndex, colIndex = 0) {
  return expenseTable(page)
    .locator('tbody > tr')
    .nth(monthIndex)
    .locator('input[type="text"]')
    .nth(colIndex);
}

function summaryValueCell(page, rowLabel, monthIndex) {
  const row = summaryTable(page).locator('tr').filter({ hasText: rowLabel });
  // 先頭 td は行ラベル。以降 12 個が月ごとの値、最後が年計。
  return row.locator('td').nth(monthIndex + 1);
}

async function commitCell(page, locator, value) {
  await locator.click(); // フォーカスを当てて onFocus で生値化
  await locator.fill(value);
  const respPromise = page.waitForResponse((r) =>
    r.url().includes('/api/fixed_costs/update_cell')
  );
  // Tab で近接する要素にフォーカスが移ると副作用が読みづらいので、
  // 対象 input だけを blur させる。
  await locator.evaluate((el) => el.blur());
  await respPromise;
}

test.describe('固定入力画面 - 収入セクションと集計', () => {
  // 全テストが同じ年 (TEST_YEAR) の同じセルを共有するため、
  // 並列実行だと afterEach の clearFixedCells が他テストの中間データを消してしまう。
  // 直列実行に固定して衝突を防ぐ。
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, request }) => {
    await clearFixedCells(request, TEST_YEAR);
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await openFixedTab(page);
    await selectTestYear(page);
  });

  test.afterEach(async ({ request }) => {
    await clearFixedCells(request, TEST_YEAR);
  });

  test('T1: 「固定入力」タブから画面を開き画面タイトルが表示される', async ({ page }) => {
    // タブボタンが存在すること
    await expect(page.getByRole('button', { name: '固定入力' })).toBeVisible();
    // beforeEach でタブを開いており、h2 の見出しテキストが仕様通りであること
    const heading = page.getByRole('heading', {
      name: '毎月の固定入力（収入・支出）',
    });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('毎月の固定入力（収入・支出）');
  });

  test('T2: 収入セル (給与/1月) の入力・カンマ表示・生値復元・永続化', async ({ page }) => {
    const jan = incomeCell(page, 0);

    // 350000 を入力してフォーカスを外すと保存され、カンマ付きで表示される
    await commitCell(page, jan, '350000');
    await expect(jan).toHaveValue('350,000');

    // 再フォーカスすると生値 (350000) に戻る
    await jan.click();
    await expect(jan).toHaveValue('350000');
    // 値を変更せず blur すると再度カンマ付きに戻る (API は呼ばれない)
    await jan.evaluate((el) => el.blur());
    await expect(jan).toHaveValue('350,000');

    // リロード後もカンマ付きで再表示される
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openFixedTab(page);
    await selectTestYear(page);
    await expect(incomeCell(page, 0)).toHaveValue('350,000');
  });

  test('T3: 集計行 (収入合計 / 支出合計 / 差引) が入力値に応じて更新される', async ({ page }) => {
    // 収入 (給与) 1月 350000
    await commitCell(page, incomeCell(page, 0), '350000');
    await expect(incomeCell(page, 0)).toHaveValue('350,000');

    // 支出 (家賃) 1月 100000
    await commitCell(page, expenseCell(page, 0, 0), '100000');
    await expect(expenseCell(page, 0, 0)).toHaveValue('100,000');

    await expect(summaryValueCell(page, '収入合計', 0)).toHaveText('¥350,000');
    await expect(summaryValueCell(page, '支出合計', 0)).toHaveText('¥100,000');

    const netCell = summaryValueCell(page, '差引', 0);
    await expect(netCell).toHaveText('¥250,000');
    // 差引がプラスの場合は赤字クラスが付かない
    await expect(netCell).not.toHaveClass(/text-red-600/);
  });

  test('T4: 差引がマイナスの月は赤字表示 (text-red-600) になる', async ({ page }) => {
    // 2月 収入 50000 / 支出 100000 → 差引 -50000
    await commitCell(page, incomeCell(page, 1), '50000');
    await expect(incomeCell(page, 1)).toHaveValue('50,000');

    await commitCell(page, expenseCell(page, 1, 0), '100000');
    await expect(expenseCell(page, 1, 0)).toHaveValue('100,000');

    const netCell = summaryValueCell(page, '差引', 1);
    await expect(netCell).toHaveText('¥-50,000');
    await expect(netCell).toHaveClass(/text-red-600/);
  });

  test('T5: 収入セルを空にして blur すると削除され、リロード後も空のまま', async ({ page }) => {
    const jan = incomeCell(page, 0);

    // 一度 350000 を保存
    await commitCell(page, jan, '350000');
    await expect(jan).toHaveValue('350,000');

    // 空にして blur → DELETE
    await commitCell(page, jan, '');
    await expect(jan).toHaveValue('');

    // リロード後も空
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openFixedTab(page);
    await selectTestYear(page);
    await expect(incomeCell(page, 0)).toHaveValue('');

    // 集計テーブルの 1月列 も 0 円表示に戻る
    await expect(summaryValueCell(page, '収入合計', 0)).toHaveText('¥0');
  });

  test('T6: 支出セクション (家賃/3月) のリグレッション - 保存と集計反映', async ({ page }) => {
    const marRent = expenseCell(page, 2, 0); // 3月 家賃 (EXPENSE_FIXED_CODES 先頭 = 604)

    await commitCell(page, marRent, '80000');
    await expect(marRent).toHaveValue('80,000');

    // 集計テーブル 3月 支出合計
    await expect(summaryValueCell(page, '支出合計', 2)).toHaveText('¥80,000');

    // リロード後も残る
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openFixedTab(page);
    await selectTestYear(page);
    await expect(expenseCell(page, 2, 0)).toHaveValue('80,000');
    await expect(summaryValueCell(page, '支出合計', 2)).toHaveText('¥80,000');
  });
});
