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

  test('飲食店のレシート: 酒類 (alcohol) は外食費 (103) に振り分けられる', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: '居酒屋 花',
          store_category_hint: 'restaurant',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: '生ビール', amount: 600, category_hint: 'alcohol' },
            { description: '唐揚げ', amount: 500, category_hint: 'dining_out' },
            { description: 'お通し', amount: 300 }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);
    const rows = modal.locator('tbody tr');
    await expect(rows.nth(0).locator('select').first()).toHaveValue('103');
    await expect(rows.nth(1).locator('select').first()).toHaveValue('103');
    await expect(rows.nth(2).locator('select').first()).toHaveValue('103');
  });

  test('スーパーのレシート: 酒類 (alcohol) は従来どおり酒 (105) のまま', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'ライフ',
          store_category_hint: 'grocery',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: '缶ビール', amount: 250, category_hint: 'alcohol' },
            { description: '牛乳', amount: 200, category_hint: 'food' }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);
    const rows = modal.locator('tbody tr');
    await expect(rows.nth(0).locator('select').first()).toHaveValue('105');
    await expect(rows.nth(1).locator('select').first()).toHaveValue('100');
  });

  test('飲食店の税抜レシート: 酒類は外食費(103)かつ10%課税、料理は8%', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: '居酒屋 花',
          store_category_hint: 'restaurant',
          tax_included: 'excluded',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: '生ビール', amount: 600, category_hint: 'alcohol' },
            { description: '唐揚げ', amount: 500, category_hint: 'dining_out' }
          ]
        })
      });
    });

    await openDashboard(page);
    const { modal } = await openOcrModalWithFile(page);
    const rows = modal.locator('tbody tr');

    // 費目は両方とも外食費 (103)
    await expect(rows.nth(0).locator('select').first()).toHaveValue('103');
    await expect(rows.nth(1).locator('select').first()).toHaveValue('103');

    // 生ビール(酒類, 10%): 600*1.10=660 / 唐揚げ(食費8%): 500*1.08=540 → 合計1200
    await expect(modal.getByText(/合計:\s*1,?200/)).toBeVisible();

    // 生ビールの費目を手動で食費(100)に変更すると酒類フラグが落ち、8%に切り替わる
    // (600*1.08=648 + 540 = 1188)
    await rows.nth(0).locator('select').first().selectOption('100');
    await expect(modal.getByText(/合計:\s*1,?188/)).toBeVisible();
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
