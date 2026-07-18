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

test.describe('OCR モーダル: プレビュー表示と税込/税抜の解析後トグル (#26)', () => {
  test('画像を選択するとプレビュー <img> が表示され、解析前の税ラジオは無い', async ({ page }) => {
    await stubOcrModels(page);
    await openDashboard(page);

    await page.getByRole('button', { name: /レシート読取/ }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' });

    // Pre-analysis: no "税込 / 税抜 (食費8%/他10%)" radios
    await expect(modal.locator('input[type="radio"][value="INCLUDED"]')).toHaveCount(0);
    await expect(modal.locator('input[type="radio"][value="EXCLUDED"]')).toHaveCount(0);

    // 1x1 transparent PNG buffer so the browser actually renders it
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'preview-image-e2e.png',
      mimeType: 'image/png',
      buffer: pngBuffer
    });

    // Preview image is rendered with a blob: URL
    const previewImg = modal.locator('img[alt="画像プレビュー"]');
    await expect(previewImg).toBeVisible();
    await expect(previewImg).toHaveAttribute('src', /^blob:/);
    await expect(modal.locator('text=preview-image-e2e.png')).toBeVisible();
  });

  test('PDF を選択すると <iframe> プレビューが表示される', async ({ page }) => {
    await stubOcrModels(page);
    await openDashboard(page);

    await page.getByRole('button', { name: /レシート読取/ }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' });

    await modal.locator('input[type="file"]').setInputFiles({
      name: 'preview-pdf-e2e.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 dummy content')
    });

    const iframe = modal.locator('iframe[title="PDF プレビュー"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('src', /^blob:/);
  });

  test('解析後トグル: tax_included=included で税込プリセット、EXCLUDED に切替で全明細の税区分が変わる', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'イオン',
          store_category_hint: 'grocery',
          tax_included: 'included',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: '牛乳', amount: 200, category_hint: 'food' },
            { description: 'ティッシュ', amount: 300, category_hint: 'daily_goods' }
          ]
        })
      });
    });

    await openDashboard(page);
    await page.getByRole('button', { name: /レシート読取/ }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' });
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'r.png', mimeType: 'image/png', buffer: Buffer.from('x')
    });
    await modal.getByRole('button', { name: '解析開始' }).click();

    // 税込がプリセット
    await expect(modal.locator('input[type="radio"][value="INCLUDED"]')).toBeChecked();
    await expect(modal.getByText(/AI 判定: 税込/)).toBeVisible();
    // 合計 500 (税込のまま)
    await expect(modal.getByText(/合計:\s*500/)).toBeVisible();

    // 税抜に切り替えると 200 (食費 x 1.08) + 300 (日用品 x 1.10) = 216 + 330 = 546
    await modal.locator('input[type="radio"][value="EXCLUDED"]').check();
    await expect(modal.getByText(/合計:\s*546/)).toBeVisible();

    // 税込に戻すと 500 に戻る
    await modal.locator('input[type="radio"][value="INCLUDED"]').check();
    await expect(modal.getByText(/合計:\s*500/)).toBeVisible();
  });

  test('tax_included=excluded なら税抜プリセット、mixed なら警告が出る', async ({ page }) => {
    await stubOcrModels(page);
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'テスト',
          tax_included: 'mixed',
          date: new Date().toISOString().slice(0, 10),
          items: [
            { description: 'A', amount: 100, category_hint: 'food' }
          ]
        })
      });
    });

    await openDashboard(page);
    await page.getByRole('button', { name: /レシート読取/ }).click();
    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' });
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'r.png', mimeType: 'image/png', buffer: Buffer.from('x')
    });
    await modal.getByRole('button', { name: '解析開始' }).click();

    // mixed は INCLUDED にフォールバック
    await expect(modal.locator('input[type="radio"][value="INCLUDED"]')).toBeChecked();
    await expect(modal.getByText(/AI 判定: 混在/)).toBeVisible();
    await expect(modal.getByText(/税込\/税抜が混在の可能性/)).toBeVisible();
  });
});
