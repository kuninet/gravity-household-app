const { test, expect } = require('@playwright/test');

test.describe('家計簿アプリ - トランザクション入力', () => {
  test.beforeEach(async ({ page }) => {
    // サーバーが起動していることを前提
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  });

  test('新しいトランザクションを正常に登録できる', async ({ page }) => {
    // 費目を選択
    await page.getByRole('combobox').nth(1).selectOption(['100']);
    
    // 金額を入力
    await page.getByPlaceholder('0').fill('1500');
    
    // 品名を入力
    await page.getByRole('textbox', { name: '品名' }).fill('テスト商品E2E');
    
    // 備考を入力
    await page.getByRole('textbox', { name: 'メモ' }).fill('E2Eテスト');
    
    // 登録前の支出合計を取得
    const beforeAmount = await page.locator('text=支出').locator('..').locator('p').textContent();
    
    // 登録ボタンをクリック
    await page.getByRole('button', { name: '登録する (一括)' }).click();
    
    // 登録後の確認
    await expect(page.locator('text=テスト商品E2E')).toBeVisible();
    
    // 支出合計が更新されていることを確認
    const afterAmount = await page.locator('text=支出').locator('..').locator('p').textContent();
    expect(afterAmount).not.toBe(beforeAmount);
    
    // 最近の履歴に追加されていることを確認
    await expect(page.locator('text=最近の履歴からコピー').locator('..').locator('text=テスト商品E2E')).toBeVisible();
  });

  test('必須フィールドのバリデーション', async ({ page }) => {
    // 金額のみ入力して登録を試行
    await page.getByPlaceholder('0').fill('1000');
    await page.getByRole('button', { name: '登録する (一括)' }).click();
    
    // フォームが送信されないことを確認（費目が未選択のため）
    // ブラウザの標準バリデーションが働く
    const categorySelect = page.getByRole('combobox').nth(1);
    await expect(categorySelect).toHaveAttribute('required');
  });

  test('履歴からのコピー機能', async ({ page }) => {
    // 履歴の最初のアイテムをクリック
    const firstHistoryItem = page.locator('text=最近の履歴からコピー').locator('..').locator('li').first();
    await firstHistoryItem.click();
    
    // フォームに値がコピーされていることを確認
    const amountField = page.getByPlaceholder('0');
    const descriptionField = page.getByRole('textbox', { name: '品名' });
    
    await expect(amountField).not.toHaveValue('');
    await expect(descriptionField).not.toHaveValue('');
  });
});