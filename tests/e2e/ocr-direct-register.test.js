const { test, expect } = require('@playwright/test')

const today = new Date().toISOString().slice(0, 10)

async function openDashboard(page) {
  await page.goto('http://localhost:5173')
  await page.waitForLoadState('networkidle')
}

async function stubOcrModels(page) {
  await page.route('**/api/ocr/models', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }] }),
    })
  })
}

async function openOcrModalWithFile(page) {
  await page.getByRole('button', { name: /レシート読取/ }).click()
  const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' })
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake receipt image'),
  })
  await modal.getByRole('button', { name: '解析開始' }).click()
  return { modal }
}

test.describe('OCR直接登録 (一括登録) と未保存ガード (#77)', () => {
  test('OCR直接登録: 「このまま登録する (一括)」で一括保存され一覧と履歴に反映される', async ({
    page,
  }) => {
    const item1Desc = `りんご-${Date.now()}`
    const item2Desc = `石鹸-${Date.now()}`

    await stubOcrModels(page)
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'テストスーパー',
          store_category_hint: 'grocery',
          date: today,
          tax_included: 'included',
          items: [
            { description: item1Desc, amount: 300, category_hint: 'food' },
            { description: item2Desc, amount: 200, category_hint: 'daily_goods' },
          ],
        }),
      })
    })

    await openDashboard(page)
    const { modal } = await openOcrModalWithFile(page)

    // 解析結果テーブルが表示されていることを確認
    await expect(modal.getByText('解析結果の確認・修正')).toBeVisible()

    // 「このまま登録する (一括)」ボタンをクリック
    const directRegisterBtn = modal.getByRole('button', { name: 'このまま登録する (一括)' })
    await expect(directRegisterBtn).toBeVisible()
    await directRegisterBtn.click()

    // モーダルが閉じる
    await expect(modal).not.toBeVisible()

    // 「最近の履歴からコピー」エリアにアイテムが表示される
    const recentHistory = page.locator('text=最近の履歴からコピー').locator('..')
    await expect(recentHistory.getByText(item1Desc)).toBeVisible()
    await expect(recentHistory.getByText(item2Desc)).toBeVisible()

    // 取引一覧テーブルにも反映されていることを確認
    await expect(page.locator('tbody tr').filter({ hasText: item1Desc })).toBeVisible()
    await expect(page.locator('tbody tr').filter({ hasText: item2Desc })).toBeVisible()
  })

  test('割引明細（マイナス金額）を含むレシートが正しくマイナスで一括登録される', async ({
    page,
  }) => {
    const bentoDesc = `特製弁当-${Date.now()}`
    const discountDesc = `夕方割引き-${Date.now()}`

    await stubOcrModels(page)
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: '割引スーパー',
          store_category_hint: 'grocery',
          date: today,
          tax_included: 'included',
          items: [
            { description: bentoDesc, amount: 600, category_hint: 'food' },
            { description: discountDesc, amount: -150, category_hint: 'food' },
          ],
        }),
      })
    })

    await openDashboard(page)
    const { modal } = await openOcrModalWithFile(page)

    // 「このまま登録する (一括)」ボタンをクリック
    await modal.getByRole('button', { name: 'このまま登録する (一括)' }).click()
    await expect(modal).not.toBeVisible()

    // 履歴と一覧に「夕方割引き」およびマイナス金額が登録されていること
    const recentHistory = page.locator('text=最近の履歴からコピー').locator('..')
    const discountRow = recentHistory.locator('li').filter({ hasText: discountDesc })
    await expect(discountRow).toBeVisible()
    await expect(discountRow.getByText('¥-150')).toBeVisible()

    await expect(page.locator('tbody tr').filter({ hasText: discountDesc })).toBeVisible()
  })

  test('「内訳に反映 (微調整)」を選んだ場合はモーダルが閉じフォームの内訳にセットされる', async ({
    page,
  }) => {
    await stubOcrModels(page)
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: '本屋ABC',
          store_category_hint: 'entertainment',
          date: today,
          tax_included: 'included',
          items: [{ description: '雑誌', amount: 800, category_hint: 'entertainment' }],
        }),
      })
    })

    await openDashboard(page)
    const { modal } = await openOcrModalWithFile(page)

    // 「内訳に反映 (微調整)」ボタンをクリック
    const applyBtn = modal.getByRole('button', { name: '内訳に反映 (微調整)' })
    await expect(applyBtn).toBeVisible()
    await applyBtn.click()

    // モーダルが閉じる
    await expect(modal).not.toBeVisible()

    // 内訳ボタンのバッジが +1 になっていること
    const splitterBtn = page.getByRole('button', { name: /内訳/ })
    await expect(splitterBtn.getByText('+1')).toBeVisible()
  })

  test('未保存データがある状態でレシート読取を起動した際の確認ダイアログ制御', async ({ page }) => {
    await stubOcrModels(page)
    await openDashboard(page)

    // 金額を入力
    const amountInput = page.getByPlaceholder('0')
    await amountInput.fill('1500')

    // 1. ダイアログを「キャンセル」した場合: モーダルは開かず、入力内容は保持される
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: /レシート読取/ }).click()

    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' })
    await expect(modal).not.toBeVisible()
    await expect(amountInput).toHaveValue('1500')

    // 2. ダイアログを「OK」した場合: モーダルが開く
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.accept()
    })
    await page.getByRole('button', { name: /レシート読取/ }).click()

    await expect(modal).toBeVisible()
  })

  test('未保存の内訳データがある状態でも確認ダイアログが表示される', async ({ page }) => {
    await stubOcrModels(page)
    await openDashboard(page)

    // 内訳モーダルを開いて明細を1件入力して適用
    await page.getByRole('button', { name: /内訳/ }).click()
    const splitterModal = page.locator('div.fixed').filter({ hasText: 'レシート内訳計算' })
    await expect(splitterModal).toBeVisible()
    const firstRow = splitterModal.locator('tbody tr').first()
    await firstRow.locator('select').first().selectOption({ index: 1 })
    await firstRow.locator('input[type="text"]').fill('内訳アイテム')
    await firstRow.locator('input[type="number"]').fill('500')
    await splitterModal.getByRole('button', { name: '決定して反映' }).click()
    await expect(splitterModal).not.toBeVisible()

    const splitterBtn = page.getByRole('button', { name: /内訳/ })
    await expect(splitterBtn.getByText('+1')).toBeVisible()

    // ダイアログをキャンセル
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: /レシート読取/ }).click()

    const ocrModal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' })
    await expect(ocrModal).not.toBeVisible()
    await expect(splitterBtn.getByText('+1')).toBeVisible()
  })

  test('品名やメモのみ入力がある状態での読取起動およびドロップ時の確認ダイアログ制御', async ({
    page,
  }) => {
    await stubOcrModels(page)
    await openDashboard(page)

    const descInput = page.getByPlaceholder('品名')
    const memoInput = page.getByPlaceholder('メモ')
    const formCard = page.getByRole('heading', { name: '新規入力' }).locator('..')
    const modal = page.locator('div.fixed').filter({ hasText: 'レシート自動解析' })

    // 1. 品名のみ入力時: レシート読取クリックで確認ダイアログ
    await descInput.fill('未保存の品名')

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: /レシート読取/ }).click()
    await expect(modal).not.toBeVisible()
    await expect(descInput).toHaveValue('未保存の品名')

    // ダイアログOKで開く
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.accept()
    })
    await page.getByRole('button', { name: /レシート読取/ }).click()
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'キャンセル' }).last().click()
    await expect(modal).not.toBeVisible()

    // フォームをリセット（品名を空にし、メモのみ入力）
    await descInput.fill('')
    await memoInput.fill('未保存のメモ')

    // 2. メモのみ入力時: フォームカードにファイルドロップで確認ダイアログ
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer()
      const file = new File(['dummy receipt'], 'receipt-drop.png', { type: 'image/png' })
      dt.items.add(file)
      return dt
    })

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.dismiss()
    })
    await formCard.dispatchEvent('drop', { dataTransfer })
    await expect(modal).not.toBeVisible()
    await expect(memoInput).toHaveValue('未保存のメモ')

    // ドロップでOKを選択した場合
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('入力中のデータがあります')
      await dialog.accept()
    })
    await formCard.dispatchEvent('drop', { dataTransfer })
    await expect(modal).toBeVisible()
    await expect(page.locator('text=receipt-drop.png')).toBeVisible()
    await modal.getByRole('button', { name: 'キャンセル' }).last().click()
    await expect(modal).not.toBeVisible()

    // 3. 空白文字（スペースのみ）の場合は未保存と判定されず、ダイアログなしで開く
    await descInput.fill('   ')
    await memoInput.fill('   ')
    let dialogTriggered = false
    page.once('dialog', async (dialog) => {
      dialogTriggered = true
      await dialog.accept()
    })
    await page.getByRole('button', { name: /レシート読取/ }).click()
    await expect(modal).toBeVisible()
    expect(dialogTriggered).toBe(false)
  })

  test('0円明細が含まれている場合に除外されて正常明細のみ登録される', async ({ page }) => {
    const validDesc = `有効明細-${Date.now()}`
    const zeroDesc = `0円明細-${Date.now()}`

    await stubOcrModels(page)
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: 'バリデーション検証スーパー',
          store_category_hint: 'grocery',
          date: today,
          tax_included: 'included',
          items: [
            { description: validDesc, amount: 450, category_hint: 'food' },
            { description: zeroDesc, amount: 0, category_hint: 'food' },
          ],
        }),
      })
    })

    await openDashboard(page)
    const { modal } = await openOcrModalWithFile(page)

    // 「このまま登録する (一括)」ボタンをクリック
    await modal.getByRole('button', { name: 'このまま登録する (一括)' }).click()

    // モーダルが閉じる
    await expect(modal).not.toBeVisible()

    // 有効明細は登録され、0円明細は登録されていないことを確認
    const recentHistory = page.locator('text=最近の履歴からコピー').locator('..')
    await expect(recentHistory.getByText(validDesc)).toBeVisible()
    await expect(recentHistory.getByText(zeroDesc)).not.toBeVisible()

    await expect(page.locator('tbody tr').filter({ hasText: validDesc })).toBeVisible()
    await expect(page.locator('tbody tr').filter({ hasText: zeroDesc })).not.toBeVisible()
  })

  test('有効な明細が0件（0円明細のみ）の場合は警告が表示され登録が中断される', async ({ page }) => {
    const zeroDesc = `無料サンプル-${Date.now()}`

    await stubOcrModels(page)
    await page.route('**/api/ocr/analyze', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          store: '無料配布スーパー',
          store_category_hint: 'grocery',
          date: today,
          tax_included: 'included',
          items: [{ description: zeroDesc, amount: 0, category_hint: 'food' }],
        }),
      })
    })

    await openDashboard(page)
    const { modal } = await openOcrModalWithFile(page)

    // 「このまま登録する (一括)」ボタンをクリックすると警告ダイアログが表示される
    let alertMessage = ''
    page.once('dialog', async (dialog) => {
      alertMessage = dialog.message()
      await dialog.accept()
    })

    await modal.getByRole('button', { name: 'このまま登録する (一括)' }).click()

    expect(alertMessage).toContain('登録可能な明細がありません。金額と費目を確認してください。')

    // モーダルは閉じずに留まっている
    await expect(modal).toBeVisible()

    // 一覧にも登録されていないことを確認
    await expect(page.locator('tbody tr').filter({ hasText: zeroDesc })).not.toBeVisible()
  })

  test('サーバー側バリデーション: /api/transactions/batch で amount=0 や不正フィールド送信時は 400 を返す', async ({
    request,
  }) => {
    // 1. amount === 0 の場合は 400
    const resZero = await request.post('/api/transactions/batch', {
      data: {
        transactions: [
          {
            date: today,
            amount: 0,
            type: 'EXPENSE',
            category_code: 100,
            description: '0円テスト',
          },
        ],
      },
    })
    expect(resZero.status()).toBe(400)
    const errZero = await resZero.json()
    expect(errZero.error).toContain('Missing or invalid required fields')

    // 2. amount が文字列など非数値の場合は 400
    const resStr = await request.post('/api/transactions/batch', {
      data: {
        transactions: [
          {
            date: today,
            amount: 'not-a-number',
            type: 'EXPENSE',
            category_code: 100,
            description: '不正amountテスト',
          },
        ],
      },
    })
    expect(resStr.status()).toBe(400)

    // 3. date が欠損している場合は 400
    const resNoDate = await request.post('/api/transactions/batch', {
      data: {
        transactions: [
          {
            amount: 300,
            type: 'EXPENSE',
            category_code: 100,
            description: '日付なしテスト',
          },
        ],
      },
    })
    expect(resNoDate.status()).toBe(400)
  })
})
