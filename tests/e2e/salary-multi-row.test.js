const { test, expect } = require('@playwright/test');

// 本番データを汚さないため翌年 (currentYear + 1) を対象にする。
// 直近未来の年は固定入力のドロップダウン (availableYears) に含まれるため UI から選択可能。
const TEST_YEAR = new Date().getFullYear() + 1;
const SALARY_CATEGORY_CODE = 700;
const EXPENSE_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608];

// -------- API ヘルパ --------

// 給与 (INCOME/700) の明細を全月ぶん取得して DELETE。
// salary は複数明細許容なので matrix の各行を id ベースで消す必要がある。
async function clearSalaryEntries(request, year) {
  const res = await request.get(`/api/fixed_costs/matrix?year=${year}`);
  if (!res.ok()) return;
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  for (const row of rows) {
    if (row.type === 'INCOME' && Number(row.category_code) === SALARY_CATEGORY_CODE) {
      await request.delete(`/api/fixed_costs/salary/${row.id}`);
    }
  }
}

// 支出セル (fixed_income-manager 系と同じ流儀) を batch で 0 に。
async function clearFixedExpenseCells(request, year) {
  const cells = [];
  for (let m = 1; m <= 12; m++) {
    for (const code of EXPENSE_CODES) {
      cells.push({ month: m, category_code: code, amount: 0, type: 'EXPENSE' });
    }
  }
  await request.post('/api/fixed_costs/batch_update', { data: { year, cells } });
}

// -------- UI ヘルパ (fixed-income-manager.test.js と同流儀) --------

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

// monthIndex は 0 起点 (0 = 1月)。給与セルは収入テーブルの各行 2 番目 td (0: 月ラベル, 1: 給与, 2: 収入計)。
function salaryCellButton(page, monthIndex) {
  return incomeTable(page)
    .locator('tbody > tr')
    .nth(monthIndex)
    .locator('td')
    .nth(1)
    .locator('button');
}

// 支出セル (fixed-income-manager と同じ)
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

function salaryModal(page) {
  return page.getByRole('dialog');
}

async function openSalaryModal(page, monthIndex) {
  await salaryCellButton(page, monthIndex).click();
  await expect(salaryModal(page)).toBeVisible();
}

async function clickSaveInModal(page) {
  await salaryModal(page).getByRole('button', { name: '保存' }).click();
  // 保存完了でモーダルが閉じるのを待つ
  await expect(salaryModal(page)).toHaveCount(0);
}

async function addSalaryRow(page, amount) {
  await salaryModal(page).getByRole('button', { name: /明細を追加/ }).click();
  const inputs = salaryModal(page).locator('input[data-role="salary-amount"]');
  const last = inputs.last();
  await last.fill(String(amount));
}

// 月インデックス → セル上の期待テキスト
function expectedCellText(total, count) {
  if (!total || total <= 0) return '-';
  return `¥${total.toLocaleString('en-US')} (${count}件)`;
}

test.describe('固定入力画面 - 給与複数明細 (INCOME/700)', () => {
  // TEST_YEAR の給与行を全テストで共有するため、直列実行に固定して衝突を防ぐ。
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    await clearSalaryEntries(request, TEST_YEAR);
    await clearFixedExpenseCells(request, TEST_YEAR);
  });

  test.afterAll(async ({ request }) => {
    await clearSalaryEntries(request, TEST_YEAR);
    await clearFixedExpenseCells(request, TEST_YEAR);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await openFixedTab(page);
    await selectTestYear(page);
  });

  // S1: 初期状態 - 8 月の給与セルは 0 件 (`-`)
  test('S1: 初期状態は給与セルが `-` (0件)', async ({ page }) => {
    const cell = salaryCellButton(page, 7); // 8月
    await expect(cell).toHaveText('-');
  });

  // S2: モーダルオープン + 1件追加保存 → ¥300,000 (1件)
  test('S2: モーダルから1件追加すると ¥300,000 (1件) が反映される', async ({ page }) => {
    await openSalaryModal(page, 7); // 8月

    await addSalaryRow(page, 300000);
    await clickSaveInModal(page);

    const cell = salaryCellButton(page, 7);
    await expect(cell).toHaveText(expectedCellText(300000, 1));

    // 収入計 (収入テーブル 8月の最終列)
    const incomeSum = incomeTable(page)
      .locator('tbody > tr')
      .nth(7)
      .locator('td')
      .last();
    await expect(incomeSum).toHaveText('¥300,000');

    // 集計テーブル 8月 収入合計
    await expect(summaryValueCell(page, '収入合計', 7)).toHaveText('¥300,000');
  });

  // S3: 2 件目を追加 → ¥550,000 (2件)
  test('S3: 2 件目を追加すると ¥550,000 (2件) と集計に合算される', async ({ page }) => {
    await openSalaryModal(page, 7);

    await addSalaryRow(page, 250000);
    await clickSaveInModal(page);

    const cell = salaryCellButton(page, 7);
    await expect(cell).toHaveText(expectedCellText(550000, 2));

    await expect(summaryValueCell(page, '収入合計', 7)).toHaveText('¥550,000');

    // 年計 (集計行の最終列) にも反映
    const netRow = summaryTable(page).locator('tr').filter({ hasText: '収入合計' });
    await expect(netRow.locator('td').last()).toHaveText('¥550,000');
  });

  // S4: 1 件を削除 (確認ダイアログ) → ¥300,000 (1件) に戻る
  test('S4: 1 件を削除すると ¥300,000 (1件) に戻る', async ({ page }) => {
    await openSalaryModal(page, 7);

    // 既存行の × ボタン (id ありのため確認ダイアログが出る)
    page.once('dialog', (d) => d.accept());
    // 削除ボタンは各行に 1 つ。1 行目 (id 昇順の先頭 = ¥300,000) を消す。
    const deleteButtons = salaryModal(page).getByRole('button', { name: '削除' });
    await deleteButtons.first().click();

    await clickSaveInModal(page);

    const cell = salaryCellButton(page, 7);
    await expect(cell).toHaveText(expectedCellText(250000, 1));

    await expect(summaryValueCell(page, '収入合計', 7)).toHaveText('¥250,000');
  });

  // S5: 残っている 1 件の金額を書き換え → 集計反映
  test('S5: 既存 1 件の金額編集が反映される', async ({ page }) => {
    await openSalaryModal(page, 7);

    // 残り 1 件の amount input を書き換える
    const amountInput = salaryModal(page).locator('input[data-role="salary-amount"]').first();
    await amountInput.fill('400000');

    await clickSaveInModal(page);

    const cell = salaryCellButton(page, 7);
    await expect(cell).toHaveText(expectedCellText(400000, 1));

    await expect(summaryValueCell(page, '収入合計', 7)).toHaveText('¥400,000');
  });

  // S6: 明細追加後キャンセル (未保存確認 → 承諾) → セル値変わらず
  test('S6: 追加した明細をキャンセルで破棄するとセル値が変わらない', async ({ page }) => {
    await openSalaryModal(page, 7);

    // 追加行を作るが保存しない
    await addSalaryRow(page, 999999);

    // キャンセルボタン (未保存変更あり → 破棄確認 → 承諾)
    page.once('dialog', (d) => {
      expect(d.message()).toContain('破棄');
      d.accept();
    });
    await salaryModal(page).getByRole('button', { name: 'キャンセル' }).click();
    await expect(salaryModal(page)).toHaveCount(0);

    // S5 の状態 (¥400,000 / 1件) のまま
    const cell = salaryCellButton(page, 7);
    await expect(cell).toHaveText(expectedCellText(400000, 1));
    await expect(summaryValueCell(page, '収入合計', 7)).toHaveText('¥400,000');
  });

  // S7: 貼り付けで給与セルは触られない
  //
  // 給与セル自体は <button> のため paste イベントを直接発火できない。
  // FixedCostManager.vue の handlePaste 内でも sectionCategories が
  // 収入/支出セクションごとに分離されており、支出セクションからの
  // 貼り付けは EXPENSE_FIXED_CODES のみを対象とする。
  // ここでは「支出セクションへの複数セル paste が動く」ことと、
  // 「その操作の後も給与セルが影響を受けていない」ことを検証する。
  test('S7: 支出セクションへの paste 後も給与セルは変化しない', async ({ page }) => {
    // 事前条件: S5〜S6 経由で 8 月給与 = ¥400,000 (1件)
    const before = await salaryCellButton(page, 7).textContent();

    // 支出セクション: 1月 家賃 (col=0) を起点に 2 行 x 2 列の貼り付け
    const target = expenseCell(page, 0, 0);
    await target.click();

    const respPromise = page.waitForResponse((r) =>
      r.url().includes('/api/fixed_costs/batch_update')
    );

    // クリップボードデータを構築して paste イベントを発火
    await target.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '80000\t10000\n81000\t11000');
      const ev = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
    });

    await respPromise;

    // 支出側は反映されている (1月 家賃 = 80,000)
    await expect(expenseCell(page, 0, 0)).toHaveValue('80,000');

    // 給与セルは元のまま (paste は給与列に届かない)
    await expect(salaryCellButton(page, 7)).toHaveText(before);
  });

  // S8: サーバーガード - INCOME/700 で /update_cell を叩くと 400
  test('S8: /api/fixed_costs/update_cell に INCOME/700 を送ると 400', async ({ request }) => {
    const res = await request.post('/api/fixed_costs/update_cell', {
      data: {
        year: TEST_YEAR,
        month: 8,
        category_code: SALARY_CATEGORY_CODE,
        amount: 500000,
        type: 'INCOME',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.error || '')).toMatch(/salary/i);
  });
});
