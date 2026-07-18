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

  test('必須フィールドのバリデーション (内訳なし時は費目必須)', async ({ page }) => {
    const form = page.locator('form').first();

    // 金額のみ入力して登録を試行
    await form.locator('input[type="number"]').first().fill('1000');
    await page.getByRole('button', { name: '登録する (一括)' }).click();

    // 内訳なしでは費目 select が required
    const categorySelect = form.locator('select').nth(1);
    await expect(categorySelect).toHaveAttribute('required');
  });

  test('内訳ありなら親費目を選ばなくても登録でき、最大金額の費目が自動採用される', async ({ page }) => {
    const marker = `E2E自動費目-${Date.now()}`;
    const form = page.locator('form').first();

    await cleanupTransactions(page, marker);

    // 内訳モーダルを開く
    await form.getByRole('button', { name: /内訳/ }).click();

    // Splitter モーダルは h3 が「レシート内訳計算」
    const splitterHeading = page.getByRole('heading', { name: 'レシート内訳計算' });
    await expect(splitterHeading).toBeVisible();
    const splitter = splitterHeading.locator('..');

    // 開いた時点で 1 行あるので、もう 1 行追加
    await splitter.getByRole('button', { name: '+ 行を追加' }).click();

    const rows = splitter.locator('tbody tr');
    // 1行目: 食費 100, 300円 税込, 品名 marker-食
    await rows.nth(0).locator('select').first().selectOption('100');
    await rows.nth(0).locator('select').nth(1).selectOption('INCLUDED');
    await rows.nth(0).locator('input[type="text"]').fill(`${marker}-食`);
    await rows.nth(0).locator('input[type="number"]').fill('300');
    // 2行目: 日用品 200, 800円 税込, 品名 marker-日用品
    await rows.nth(1).locator('select').first().selectOption('200');
    await rows.nth(1).locator('select').nth(1).selectOption('INCLUDED');
    await rows.nth(1).locator('input[type="text"]').fill(`${marker}-日用品`);
    await rows.nth(1).locator('input[type="number"]').fill('800');

    // 支払合計を明細合計(1100)に一致させ、メイン金額=0 にする
    await splitter.locator('input[type="number"]').first().fill('1100');

    // 内訳確定
    await splitter.getByRole('button', { name: '決定して反映' }).click();

    // メモに marker (Splitter クローズ後に入れる)
    await form.getByRole('textbox', { name: 'メモ' }).fill(marker);

    // 親費目 select は required でないこと、値も空のままであること
    const categorySelect = form.locator('select').nth(1);
    await expect(categorySelect).not.toHaveAttribute('required');
    await expect(categorySelect).toHaveValue('');

    // そのまま登録
    await page.getByRole('button', { name: '登録する (一括)' }).click();

    // 内訳2件が登録され、両方一覧に出る
    await expect(page.locator('tbody tr').filter({ hasText: `${marker}-食` })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: `${marker}-日用品` })).toBeVisible();

    await cleanupTransactions(page, marker);
  });

  test('PDF をフォームにドロップするとレシートOCRモーダルが開きファイルが選択される', async ({ page }) => {
    // OCR モデル取得を止め、外部依存を作らない
    await page.route('**/api/ocr/models', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }] }) });
    });

    const formCard = page.getByRole('heading', { name: '新規入力' }).locator('..');

    // DataTransfer に PDF File を積んで dragenter → drop
    const dataTransfer = await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        const file = new File(['%PDF-1.4 dummy'], 'e2e-dropzone-receipt.pdf', { type: 'application/pdf' });
        dt.items.add(file);
        return dt;
    });

    await formCard.dispatchEvent('dragenter', { dataTransfer });
    await expect(page.locator('text=ここにレシート')).toBeVisible();

    await formCard.dispatchEvent('drop', { dataTransfer });

    // OCR モーダルが開く
    await expect(page.getByRole('heading', { name: 'レシート自動解析 (AI)' })).toBeVisible();
    // ドロップしたファイル名が表示される
    await expect(page.locator('text=e2e-dropzone-receipt.pdf')).toBeVisible();
    // 「解析開始」ボタンが有効化される
    await expect(page.getByRole('button', { name: '解析開始' })).toBeVisible();

    // 後片付け: モーダルを閉じる (フッターのキャンセル)
    await page.getByRole('button', { name: 'キャンセル' }).last().click();
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
