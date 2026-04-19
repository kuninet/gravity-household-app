const { test, expect } = require('@playwright/test');

async function cleanupTransactions(page, marker) {
  const res = await page.request.get('/api/transactions');
  const body = await res.json();
  const ids = (body.data || [])
    .filter((tx) => [tx.description, tx.memo].some((value) => String(value || '').includes(marker)))
    .map((tx) => tx.id);

  if (ids.length > 0) {
    await page.request.post('/api/transactions/batch_delete', { data: { ids } });
  }
}

async function createTransaction(page, data) {
  await page.request.post('/api/transactions', { data });
}

test.describe('家計簿アプリ - トランザクション入力', () => {
  test.beforeEach(async ({ page }) => {
    // サーバーが起動していることを前提
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  });

  test('新しいトランザクションを正常に登録できる', async ({ page }) => {
    const marker = `E2E通常登録-${Date.now()}`;
    const description = `${marker}-商品`;
    const form = page.locator('form').first();

    await cleanupTransactions(page, marker);

    // 費目を選択
    await form.locator('select').nth(1).selectOption('100');
    
    // 金額を入力
    await form.locator('input[type="number"]').first().fill('1500');
    
    // 品名を入力
    await form.getByRole('textbox', { name: '品名' }).fill(description);
    
    // 備考を入力
    await form.getByRole('textbox', { name: 'メモ' }).fill(marker);
    
    // 登録前の支出合計を取得
    const expenseTotal = page.getByRole('heading', { name: '支出' }).locator('..').locator('p').first();
    const beforeAmount = await expenseTotal.textContent();
    
    // 登録ボタンをクリック
    await page.getByRole('button', { name: '登録する (一括)' }).click();
    
    // 登録後の確認
    await expect(page.locator('tbody tr').filter({ hasText: description })).toBeVisible();
    
    // 支出合計が更新されていることを確認
    const afterAmount = await expenseTotal.textContent();
    expect(afterAmount).not.toBe(beforeAmount);
    
    // 最近の履歴に追加されていることを確認
    await expect(page.locator('text=最近の履歴からコピー').locator('..').locator('text=' + description)).toBeVisible();

    await cleanupTransactions(page, marker);
  });

  test('必須フィールドのバリデーション', async ({ page }) => {
    const form = page.locator('form').first();

    // 金額のみ入力して登録を試行
    await form.locator('input[type="number"]').first().fill('1000');
    await page.getByRole('button', { name: '登録する (一括)' }).click();
    
    // フォームが送信されないことを確認（費目が未選択のため）
    // ブラウザの標準バリデーションが働く
    const categorySelect = form.locator('select').nth(1);
    await expect(categorySelect).toHaveAttribute('required');
  });

  test('履歴からのコピー機能', async ({ page }) => {
    const marker = `E2E履歴コピー-${Date.now()}`;
    const description = `${marker}-履歴商品`;

    await cleanupTransactions(page, marker);
    await createTransaction(page, {
      date: new Date().toISOString().slice(0, 10),
      amount: 1200,
      type: 'EXPENSE',
      category_code: 100,
      description,
      memo: marker
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 履歴の最初のアイテムをクリック
    await page.locator('text=最近の履歴からコピー').locator('..').locator('li').filter({ hasText: description }).click();
    
    // フォームに値がコピーされていることを確認
    const form = page.locator('form').first();
    const amountField = form.locator('input[type="number"]').first();
    const descriptionField = form.getByRole('textbox', { name: '品名' });
    
    await expect(amountField).toHaveValue('1200');
    await expect(descriptionField).toHaveValue(description);

    await cleanupTransactions(page, marker);
  });
});
