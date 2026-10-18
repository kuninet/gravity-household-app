const SALARY_CATEGORY_CODE = 700
const SALARY_TYPE = 'INCOME'
const SALARY_DEFAULT_DESCRIPTION = '給与(固定入力)'
const SALARY_DESCRIPTION_MAX_LENGTH = 200

// 固定入力画面で扱うカテゴリ (支出/収入で分離)
const EXPENSE_FIXED_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608]
const INCOME_FIXED_CODES = [SALARY_CATEGORY_CODE]

function isFixedExpense(code) {
  if (code === undefined || code === null) return false
  return EXPENSE_FIXED_CODES.includes(Number(code))
}

function isFixedIncome(code) {
  if (code === undefined || code === null) return false
  return INCOME_FIXED_CODES.includes(Number(code))
}

function isSalary(code) {
  if (code === undefined || code === null) return false
  return Number(code) === SALARY_CATEGORY_CODE
}

function isFixedCost(code, type) {
  if (type === 'INCOME') return isFixedIncome(code)
  if (type === 'EXPENSE') return isFixedExpense(code)
  return isFixedExpense(code) || isFixedIncome(code)
}

module.exports = {
  EXPENSE_FIXED_CODES,
  INCOME_FIXED_CODES,
  SALARY_CATEGORY_CODE,
  SALARY_TYPE,
  SALARY_DEFAULT_DESCRIPTION,
  SALARY_DESCRIPTION_MAX_LENGTH,
  isFixedExpense,
  isFixedIncome,
  isSalary,
  isFixedCost,
}
