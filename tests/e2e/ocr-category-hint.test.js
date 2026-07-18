const { test, expect } = require('@playwright/test');

async function openDashboard(page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
}

async function stubOcrModels(page) {
  await page.route('**/api/ocr/models', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }] })
    });
  });
}

async function openOcrModalWithFile(page) {
  await page.getByRole('button', { name: /レシート読取/ }).click();
  const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' });
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake receipt image')
  });
  await modal.getByRole('button', { name: '解析開始' }).click();
  return { modal };
}

test.describe('OCR: 店名・明細ヒントからのデフォルト費目推定', () => {
  test('ドラッグストアのレシート: item ヒントが日用品/医療で正しく反映される', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'マツモトキヨシ',
          store_category_hint: 'drugstore',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: 'ティッシュ', amount: 300, category_hint: 'daily_goods' },
            { description: '風邪薬', amount: 800, category_hint: 'medical' },
            { description: 'おにぎり', amount: 150, category_hint: 'food' }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);

    const rows = modal.locator('tbody tr');
    // 費目 select はそれぞれ 200 (日用品), 500 (医療), 100 (食費)
    await expect(rows.nth(0).locator('select').first()).toHaveValue('200');
    await expect(rows.nth(1).locator('select').first()).toHaveValue('500');
    await expect(rows.nth(2).locator('select').first()).toHaveValue('100');
  });

  test('スーパーのレシート: item ヒントなしでも store hint (grocery) から食費に落ちる', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'ライフ',
          store_category_hint: 'grocery',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: '牛乳', amount: 200 },
            { description: '卵', amount: 250 }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);
    const rows = modal.locator('tbody tr');
    await expect(rows.nth(0).locator('select').first()).toHaveValue('100');
    await expect(rows.nth(1).locator('select').first()).toHaveValue('100');
  });

  test('ドラッグストア × item ヒントなし: store hint (drugstore) から日用品にフォールバック', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'ウエルシア',
          store_category_hint: 'drugstore',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: '洗剤', amount: 400 },
            { description: '歯ブラシ', amount: 200 }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);
    const rows = modal.locator('tbody tr');
    await expect(rows.nth(0).locator('select').first()).toHaveValue('200');
    await expect(rows.nth(1).locator('select').first()).toHaveValue('200');
  });

  test('ヒントが一切無い旧レスポンスでも食費 (100) にフォールバックしエラーにならない', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: '不明',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: 'なにか', amount: 100 }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);
    const rows = modal.locator('tbody tr');
    await expect(rows.nth(0).locator('select').first()).toHaveValue('100');
  });
});
