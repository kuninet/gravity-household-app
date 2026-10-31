const { z } = require('zod')
const { isValidDateString } = require('../lib/fiscalMonth')
const { SALARY_DESCRIPTION_MAX_LENGTH } = require('../lib/fixedCostCodes')

const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const FISCAL_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

const dateSchema = z
  .string()
  .regex(DATE_REGEX, '日付は YYYY-MM-DD 形式で指定してください')
  .refine((val) => isValidDateString(val), '実在する有効な日付を指定してください')

const fiscalMonthSchema = z
  .string()
  .regex(FISCAL_MONTH_REGEX, '会計月は YYYY-MM 形式（01〜12月）で指定してください')

// 書き込み用の会計月。REST の固定入力 API (isValidYear) と同じく 2000〜2999 年に限定する。
// 境界: 2000-01 は許可（給与の日付は前月 25 日の 1999-12-25 になるが、REST も同じ値を保存するため揃える）。
const MIN_WRITABLE_YEAR = 2000
const MAX_WRITABLE_YEAR = 2999
const writableFiscalMonthSchema = fiscalMonthSchema.refine((val) => {
  const year = Number(val.slice(0, 4))
  return year >= MIN_WRITABLE_YEAR && year <= MAX_WRITABLE_YEAR
}, `会計月の年は${MIN_WRITABLE_YEAR}〜${MAX_WRITABLE_YEAR}年の範囲で指定してください`)

const typeSchema = z.enum(['EXPENSE', 'INCOME'], {
  errorMap: () => ({ message: '収支区分は EXPENSE または INCOME を指定してください' }),
})

const MAX_AMOUNT = 10000000

const amountSchema = z
  .number()
  .int('金額は整数で指定してください')
  .refine((v) => v !== 0, '金額に0は指定できません')
  .refine((v) => Math.abs(v) <= MAX_AMOUNT, '金額は絶対値1,000万円以内で指定してください')

const categoryCodeSchema = z
  .number()
  .int('費目コードは整数で指定してください')
  .positive('費目コードは正の整数で指定してください')

const descriptionSchema = z
  .string()
  .min(1, '品名・内容は1文字以上で指定してください')
  .max(200, '品名・内容は200文字以内で指定してください')

const memoSchema = z.string().max(500, 'メモは500文字以内で指定してください').optional()

// 固定費セルの金額（0 以上の整数。0 はセル削除）
const fixedCostAmountSchema = z
  .number()
  .int('金額は整数で指定してください')
  .min(0, '金額は0以上で指定してください（0はセルの削除）')
  .max(MAX_AMOUNT, '金額は1,000万円以内で指定してください')

// 給与明細の金額（正の整数）
const salaryAmountSchema = z
  .number()
  .int('金額は整数で指定してください')
  .positive('金額は1円以上で指定してください')
  .max(MAX_AMOUNT, '金額は1,000万円以内で指定してください')

// 給与明細の摘要
const salaryDescriptionSchema = z
  .string()
  .min(1, '摘要は1文字以上で指定してください')
  .max(
    SALARY_DESCRIPTION_MAX_LENGTH,
    `摘要は${SALARY_DESCRIPTION_MAX_LENGTH}文字以内で指定してください`
  )

// 取引 ID
const transactionIdSchema = z.number().int().positive('IDは正の整数で指定してください')

// バッチ用明細アイテムスキーマ
const batchItemSchema = z.object({
  date: dateSchema.optional().describe('取引日（YYYY-MM-DD）。省略時はバッチ全体の date を適用'),
  amount: amountSchema.describe('金額（0円不可、割引は負数）'),
  type: typeSchema.default('EXPENSE').optional().describe('収支区分（既定: EXPENSE）'),
  category_code: categoryCodeSchema.describe('カテゴリコード'),
  description: descriptionSchema.describe('品名・内容（1〜200文字）'),
  memo: memoSchema.describe('メモ（省略時はバッチ全体の store を適用）'),
})

module.exports = {
  DATE_REGEX,
  FISCAL_MONTH_REGEX,
  dateSchema,
  fiscalMonthSchema,
  writableFiscalMonthSchema,
  typeSchema,
  amountSchema,
  categoryCodeSchema,
  descriptionSchema,
  memoSchema,
  batchItemSchema,
  fixedCostAmountSchema,
  salaryAmountSchema,
  salaryDescriptionSchema,
  transactionIdSchema,
  MAX_AMOUNT,
}
