const { test, expect } = require('@playwright/test');

async function cleanupTransactions(request, marker) {
  const res = await request.get('/api/transactions');
  const body = await res.json();
  const ids = (body.data || [])
    .filter((tx) => [tx.description, tx.memo].some((value) => String(value || '').includes(marker)))
    .map((tx) => tx.id);

  if (ids.length > 0) {
    await request.post('/api/transactions/batch_delete', { data: { ids } });
  }
}

async function createTransaction(request, data) {
  await request.post('/api/transactions', { data });
}

test.describe('複数年比較分析', () => {
  test.describe('ビュー表示・操作', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
    });

    test('ナビゲーションから複数年比較ビューへ切り替え、ダッシュボードに戻れる', async ({ page }) => {
      await page.getByRole('button', { name: '複数年比較' }).click();

      await expect(page.getByRole('heading', { name: '複数年比較分析' })).toBeVisible();
      await expect(page.locator('canvas').first()).toBeVisible();

      await page.getByRole('button', { name: '日々の記録' }).click();

      await expect(page.getByRole('heading', { name: '複数年比較分析' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '登録する (一括)' })).toBeVisible();
    });

    test('年範囲プリセットの変更でmulti_year APIが呼び出される', async ({ page }) => {
      await page.getByRole('button', { name: '複数年比較' }).click();
      await expect(page.getByRole('heading', { name: '複数年比較分析' })).toBeVisible();
      await page.waitForLoadState('networkidle');

      const [response] = await Promise.all([
        page.waitForResponse('**/api/analysis/multi_year**'),
        page.getByRole('button', { name: '直近5年' }).click()
      ]);

      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body).toHaveProperty('years');
      expect(body).toHaveProperty('groups');
      expect(body).toHaveProperty('categories');
      expect(body).toHaveProperty('summary');
    });

    test('系列トグルで積み上げ棒グラフの系列が非表示/再表示になる', async ({ page }) => {
      await page.getByRole('button', { name: '複数年比較' }).click();
      await expect(page.getByRole('heading', { name: '複数年比較分析' })).toBeVisible();

      const groupSection = page.locator('div.bg-white.rounded.shadow').filter({ hasText: 'グループ別支出推移' });
      const toggleButton = groupSection.getByRole('button').first();
      await expect(toggleButton).toBeVisible();

      await expect(toggleButton).not.toHaveClass(/border-dashed/);
      await toggleButton.click();
      await expect(toggleButton).toHaveClass(/border-dashed/);
      await expect(toggleButton).toHaveClass(/text-gray-400/);

      await toggleButton.click();
      await expect(toggleButton).not.toHaveClass(/border-dashed/);
    });
  });

  test.describe('APIレスポンスとDOM整合性', () => {
    test('groups/categoriesの名称が集計表・トグルボタンに反映される', async ({ page, request }) => {
      const res = await request.get('/api/analysis/multi_year?from=2024&to=2026');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.groups.length).toBeGreaterThan(0);
      expect(body.categories.length).toBeGreaterThan(0);

      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: '複数年比較' }).click();
      await expect(page.getByRole('heading', { name: '複数年比較分析' })).toBeVisible();

      // レスポンスと同じ期間をUI側にも明示的に設定し、表示内容を一致させる
      const selects = page.locator('select');
      await selects.nth(0).selectOption('2024');
      await selects.nth(1).selectOption('2026');

      const table = page.locator('table');
      await expect(table.getByText(body.groups[0].name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(body.categories[0].name, { exact: true }).first()).toBeVisible();
    });

    test('予測二重計上バグの回帰防止（家賃12ヶ月分の年計と予測値）', async ({ request }) => {
      const marker = `E2E-multi-year-${Date.now()}`;
      const currentYear = new Date().getFullYear();
      const years = [currentYear - 2, currentYear - 1, currentYear];
      const RENT_CODE = 604;
      const RENT_AMOUNT = 80000;
      const RENT_ANNUAL = RENT_AMOUNT * 12;

      // 既存の実データ（家賃の実運用データ等）が既に存在する環境でも成立するよう、
      // 投入前のベースラインを取得して差分で検証する
      const beforeRes = await request.get(`/api/analysis/multi_year?from=${years[0]}&to=${years[2]}`);
      const beforeBody = await beforeRes.json();
      const baselineRent = beforeBody.categories.find((c) => c.name === '家賃');
      const baselineData = baselineRent ? baselineRent.data.slice() : years.map(() => 0);

      const transactionsToInsert = [];
      years.forEach((year) => {
        for (let m = 1; m <= 12; m++) {
          const month = String(m).padStart(2, '0');
          transactionsToInsert.push({
            date: `${year}-${month}-10`,
            amount: RENT_AMOUNT,
            type: 'EXPENSE',
            category_code: RENT_CODE,
            description: `${marker}-家賃`,
            memo: marker
          });
        }
      });

      try {
        await Promise.all(transactionsToInsert.map((data) => createTransaction(request, data)));

        const afterRes = await request.get(`/api/analysis/multi_year?from=${years[0]}&to=${years[2]}`);
        expect(afterRes.status()).toBe(200);
        const afterBody = await afterRes.json();

        const rent = afterBody.categories.find((c) => c.name === '家賃');
        expect(rent).toBeTruthy();

        years.forEach((y, i) => {
          expect(rent.data[i]).toBe(baselineData[i] + RENT_ANNUAL);
        });

        const currentYearIndex = afterBody.years.indexOf(afterBody.current_fiscal_year);
        expect(currentYearIndex).toBe(2);

        const actualCurrentYear = rent.data[currentYearIndex];
        const projectedCurrentYear = rent.projected[currentYearIndex];

        expect(projectedCurrentYear).not.toBeNull();
        // 過去2年・当年とも月次の支払パターンが一定のため、予測は実績年計とほぼ一致するはず
        expect(Math.abs(projectedCurrentYear - actualCurrentYear)).toBeLessThanOrEqual(50000);
        // 二重計上バグが再発すると経過月分が二重に加算され約1.4倍に膨らむため、その混入がないことを確認
        expect(projectedCurrentYear).toBeLessThan(actualCurrentYear * 1.2);
      } finally {
        await cleanupTransactions(request, marker);
      }
    });
  });

  test.describe('エラーレスポンス', () => {
    test('fromがtoより大きい場合は400を返す', async ({ request }) => {
      const res = await request.get('/api/analysis/multi_year?from=2026&to=2024');
      expect(res.status()).toBe(400);
    });

    test('fromが数値でない場合は400を返す', async ({ request }) => {
      const res = await request.get('/api/analysis/multi_year?from=abc&to=2026');
      expect(res.status()).toBe(400);
    });
  });
});
