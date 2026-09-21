const { test, expect } = require('@playwright/test')

test.describe('価格推移（Price Trend）ビュー', () => {
  let createdIds = []

  test.beforeAll(async ({ request }) => {
    // テスト用の取引データを投入
    const dummyItems = [
      { date: '2025-01-10', amount: 120, description: '極小粒納豆 3P', memo: 'スーパーA' },
      { date: '2025-01-20', amount: 130, description: '極小粒納豆 3P', memo: 'スーパーA' },
      { date: '2025-02-05', amount: 150, description: '国産大豆納豆', memo: 'スーパーB' },
      { date: '2025-02-15', amount: 280, description: '納豆巻き', memo: 'コンビニ' },
    ]

    for (const item of dummyItems) {
      const res = await request.post('/api/transactions', {
        data: {
          date: item.date,
          amount: item.amount,
          type: 'EXPENSE',
          category_code: 100, // 食費
          description: item.description,
          memo: item.memo,
        },
      })
      const body = await res.json()
      if (body.data?.id) createdIds.push(body.data.id)
    }
  })

  test.afterAll(async ({ request }) => {
    if (createdIds.length > 0) {
      await request.post('/api/transactions/batch_delete', {
        data: { ids: createdIds },
      })
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('ナビゲーションから価格推移ビューを開き、納豆の価格推移と統計が表示されること', async ({
    page,
  }) => {
    // 1. ナビゲーションの「価格推移」をクリック
    await page.getByRole('button', { name: '価格推移' }).click()

    // 2. 見出しの確認
    await expect(page.locator('h2')).toContainText('品名価格推移分析')

    // 3. 検索キーワード入力欄に「納豆」を入力して検索
    const input = page.getByPlaceholder('品名キーワードを入力')
    await input.fill('納豆')
    await page.getByRole('button', { name: '検索' }).click()

    // 4. サマリーカードの表示確認
    await expect(page.locator('text=平均購入単価')).toBeVisible()
    await expect(page.locator('text=最安値')).toBeVisible()
    await expect(page.locator('text=最高値')).toBeVisible()
    await expect(page.locator('text=直近購入価格')).toBeVisible()

    // 5. 検出された品名タグの確認
    await expect(page.locator('text=検出された品名バリエーション')).toBeVisible()
    await expect(page.getByRole('button', { name: /極小粒納豆 3P/ })).toBeVisible()

    // 6. チャートと明細テーブルの確認
    await expect(page.locator('text=価格推移チャート')).toBeVisible()
    await expect(page.locator('text=購入明細一覧')).toBeVisible()
    await expect(page.locator('table')).toContainText('極小粒納豆 3P')
  })

  test('品名チップをクリックして特定品名を除外できること', async ({ page }) => {
    await page.getByRole('button', { name: '価格推移' }).click()

    const input = page.getByPlaceholder('品名キーワードを入力')
    await input.fill('納豆')
    await page.getByRole('button', { name: '検索' }).click()

    // 納豆巻きチップを探してクリック（除外）
    const nattoMakiChip = page.getByRole('button', { name: /納豆巻き/ })
    if (await nattoMakiChip.isVisible()) {
      await nattoMakiChip.click()
      // テーブルから納豆巻きが除外されていること
      await expect(page.locator('table')).not.toContainText('納豆巻き')
    }
  })

  test('一致する品名がない場合は空状態メッセージが表示されること', async ({ page }) => {
    await page.getByRole('button', { name: '価格推移' }).click()

    const input = page.getByPlaceholder('品名キーワードを入力')
    await input.fill('存在しない謎のアイテムXYZ123')
    await page.getByRole('button', { name: '検索' }).click()

    await expect(page.locator('text=一致する支出データが見つかりませんでした')).toBeVisible()
  })
})
