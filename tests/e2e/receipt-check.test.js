const { test, expect } = require('@playwright/test');

// シード DB の既存データに依存せず、自前で投入した取引だけを使って照合する。
// 会計月は 2019-04（前月23日〜当月22日 = 2019-03-23〜2019-04-22）とし、
// 既存シードデータと衝突しにくい過去日付・ユニークな memo を選ぶ。
const MATCHED_MEMO = `E2E照合アークス${Date.now()}`;
const MATCHED_DATE = '2019-03-24';
const MATCHED_FILE = `20190324-${MATCHED_MEMO}_001.pdf`;

const MISSING_STORE = `E2E照合ドンキ${Date.now()}`;
const MISSING_DATE = '2019-03-25';
const MISSING_FILE = `20190325-${MISSING_STORE}_004.pdf`;

const FISCAL_MONTH = '2019-04';

let createdTransactionId;

async function openReceiptCheckTab(page) {
  await page.getByRole('button', { name: 'レシート照合' }).click();
}

async function openDashboardTab(page) {
  await page.getByRole('button', { name: '日々の記録' }).click();
}

test.describe.serial('レシート照合タブ', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/transactions', {
      data: {
        date: MATCHED_DATE,
        amount: 3000,
        type: 'EXPENSE',
        category_code: 100,
        description: 'E2E照合テスト用取引',
        memo: MATCHED_MEMO,
      },
    });
    const body = await res.json();
    createdTransactionId = body.data && body.data.id;
  });

  test.afterAll(async ({ request }) => {
    if (createdTransactionId) {
      await request.post('/api/transactions/batch_delete', { data: { ids: [createdTransactionId] } });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  });

  test('ファイル名から登録済み・入れ忘れ候補・解析不能を判定して表示する', async ({ page }) => {
    await openReceiptCheckTab(page);

    await page.locator('main input[type="file"]').setInputFiles([
      { name: MATCHED_FILE, mimeType: 'application/pdf', buffer: Buffer.from('dummy') },
      { name: MISSING_FILE, mimeType: 'application/pdf', buffer: Buffer.from('dummy') },
      { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('dummy') },
    ]);

    await page.locator('[data-testid="receipt-check-month"]').selectOption(FISCAL_MONTH);
    await page.getByRole('button', { name: '照合する' }).click();

    const matched = page.locator('[data-testid="receipt-check-matched"]');
    await expect(matched).toContainText(MATCHED_MEMO);

    const missing = page.locator('[data-testid="receipt-check-missing"]');
    await expect(missing).toContainText(MISSING_STORE);

    const unparsed = page.locator('[data-testid="receipt-check-unparsed"]');
    await expect(unparsed).toContainText('memo.txt');
  });

  test('入れ忘れ候補の「登録する」から日々の記録フォームに日付・店名が入り、再訪しても再適用されない', async ({ page }) => {
    await openReceiptCheckTab(page);

    await page.locator('main input[type="file"]').setInputFiles([
      { name: MISSING_FILE, mimeType: 'application/pdf', buffer: Buffer.from('dummy') },
    ]);

    await page.locator('[data-testid="receipt-check-month"]').selectOption(FISCAL_MONTH);
    await page.getByRole('button', { name: '照合する' }).click();

    const missing = page.locator('[data-testid="receipt-check-missing"]');
    await expect(missing).toContainText(MISSING_STORE);
    await missing.getByRole('button', { name: '登録する' }).click();

    // 日々の記録タブへ切り替わり、フォームに日付・店名が反映される
    const form = page.locator('form').first();
    await expect(form.locator('input[type="date"]')).toHaveValue(MISSING_DATE);
    await expect(form.getByPlaceholder('メモ')).toHaveValue(MISSING_STORE);

    // 反映後にユーザーが店名を書き換える
    const rewrittenMemo = 'ユーザーが書き換えた店名';
    await form.getByPlaceholder('メモ').fill(rewrittenMemo);

    // レシート照合タブへ行って日々の記録タブへ戻る
    await openReceiptCheckTab(page);
    await openDashboardTab(page);

    // タブを戻ってもフォームは初期状態に戻り、古い prefill（日付・店名）が
    // 再適用されていないこと（新しいフォームは今日の日付・空の店名になる）
    const formAfterReturn = page.locator('form').first();
    const today = new Date().toISOString().split('T')[0];
    await expect(formAfterReturn.locator('input[type="date"]')).toHaveValue(today);
    await expect(formAfterReturn.getByPlaceholder('メモ')).toHaveValue('');
    // 少なくとも、書き換え前の古い prefill 日付・店名ではないことを明示的に確認する
    await expect(formAfterReturn.locator('input[type="date"]')).not.toHaveValue(MISSING_DATE);
    await expect(formAfterReturn.getByPlaceholder('メモ')).not.toHaveValue(MISSING_STORE);
  });

  test('ファイル未選択では照合ボタンが無効になる', async ({ page }) => {
    await openReceiptCheckTab(page);

    await expect(page.getByRole('button', { name: '照合する' })).toBeDisabled();
  });
});
