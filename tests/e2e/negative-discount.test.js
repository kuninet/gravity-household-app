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

async function openDashboard(page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
}

function transactionRow(page, description) {
  return page.locator('tbody tr').filter({ hasText: description });
}

test.describe('割引のマイナス金額', () => {
  test('内訳の手入力で割引明細を税込の負数として保存できる', async ({ page }) => {
    const marker = `E2E割引手入力-${Date.now()}`;
    const remainderDescription = `${marker}-残額`;
    const itemDescription = `${marker}-日用品`;
    const discountDescription = `${marker}-割引`;

    await openDashboard(page);
    await cleanupTransactions(page, marker);
    await page.reload();
    await page.waitForLoadState('networkidle');

    const form = page.locator('form').first();
    await form.locator('select').nth(1).selectOption('100');
    await form.getByRole('textbox', { name: '品名' }).fill(remainderDescription);
    await form.getByRole('textbox', { name: 'メモ' }).fill(marker);
    await form.getByRole('button', { name: /内訳/ }).click();

    const modal = page.locator('div.fixed').filter({ hasText: 'レシート内訳計算' });
    await modal.locator('input[type="number"]').first().fill('1000');

    const firstRow = modal.locator('tbody tr').nth(0);
    await firstRow.locator('select').nth(0).selectOption('200');
    await firstRow.locator('input[type="text"]').fill(itemDescription);
    await firstRow.locator('input[type="number"]').fill('300');

    await modal.getByRole('button', { name: '+ 行を追加' }).click();
    const discountRow = modal.locator('tbody tr').nth(1);
    await discountRow.locator('select').nth(0).selectOption('100');
    await discountRow.locator('input[type="text"]').fill(discountDescription);
    await discountRow.locator('input[type="number"]').fill('-50');

    await expect(discountRow.locator('select').nth(1)).toHaveValue('INCLUDED');
    await expect(discountRow.locator('select').nth(1)).toBeDisabled();
    await expect(modal.getByText('¥720')).toBeVisible();

    await modal.getByRole('button', { name: '決定して反映' }).click();
    await form.getByRole('button', { name: '登録する (一括)' }).click();

    await expect(transactionRow(page, discountDescription)).toContainText('¥-50');
    await expect(transactionRow(page, itemDescription)).toContainText('¥330');
    await expect(transactionRow(page, remainderDescription)).toContainText('¥720');

    await cleanupTransactions(page, marker);
  });

  test('OCR結果の割引明細を税抜モードでも税込の負数として保存できる', async ({ page }) => {
    const marker = `E2E割引OCR-${Date.now()}`;
    const itemDescription = `${marker}-牛乳`;
    const discountDescription = `${marker}-クーポン割引`;

    await page.route('**/api/ocr/models', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }]
        })
      });
    });

    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: marker,
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: itemDescription, amount: 1000 },
            { description: discountDescription, amount: -100 }
          ]
        })
      });
    });

    await openDashboard(page);
    await cleanupTransactions(page, marker);
    await page.reload();
    await page.waitForLoadState('networkidle');

    const form = page.locator('form').first();
    await form.locator('select').nth(1).selectOption('100');
    await page.getByRole('button', { name: /レシート読取/ }).click();

    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' });
    await modal.locator('input[type="radio"][value="EXCLUDED"]').check();
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake receipt image')
    });
    await modal.getByRole('button', { name: '解析開始' }).click();

    await expect(modal.locator('tbody tr').nth(0).locator('input[type="text"]')).toHaveValue(itemDescription);
    await expect(modal.locator('tbody tr').nth(1).locator('input[type="text"]')).toHaveValue(discountDescription);
    await expect(modal.getByText('合計: 980')).toBeVisible();

    await modal.getByRole('button', { name: '決定して反映' }).click();
    await form.getByRole('button', { name: '登録する (一括)' }).click();

    await expect(transactionRow(page, itemDescription)).toContainText('¥1,080');
    await expect(transactionRow(page, discountDescription)).toContainText('¥-100');

    await cleanupTransactions(page, marker);
  });
});
