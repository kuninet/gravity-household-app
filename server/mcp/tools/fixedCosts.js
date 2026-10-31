const { z } = require('zod')
const {
  writableFiscalMonthSchema,
  categoryCodeSchema,
  fixedCostAmountSchema,
  salaryAmountSchema,
  salaryDescriptionSchema,
  transactionIdSchema,
} = require('../schemas')
const { isFixedExpense, isSalary } = require('../../lib/fixedCostCodes')
const {
  setFixedCostCell,
  addSalaryItem,
  updateSalaryItem,
  deleteSalaryItem,
} = require('../../services/fixedCostService')

// 固定費コードの案内用表記（server/lib/fixedCostCodes.js の EXPENSE_FIXED_CODES と同期すること）
const EXPENSE_FIXED_CODES_LABEL = '601〜608, 901'

function successResult(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data),
      },
    ],
    structuredContent: data,
  }
}

function errorResult(message) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
  }
}

/**
 * 固定費・給与の専用更新ツール (4ツール) を MCP サーバーに登録する
 * 固定入力画面と同じ前提（固定費は (fiscal_month, category_code, type) ごとに 1 行、
 * 給与は 1 会計月に複数行・日付は前月 25 日）を守って書き込む。
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('sqlite3').Database} db
 */
function registerFixedCostTools(server, db) {
  // 1. set_fixed_cost_cell
  server.registerTool(
    'set_fixed_cost_cell',
    {
      title: '固定費セルの設定',
      description: `固定入力画面の固定費（支出）セル 1 つの金額を設定します。対象は固定費コード（${EXPENSE_FIXED_CODES_LABEL}）のみで、会計月・費目ごとに 1 明細として作成・更新され、金額 0 でセルを削除します。現在値は get_fixed_costs で確認できます。給与は add_salary_item / update_salary_item / delete_salary_item を使ってください。`,
      inputSchema: {
        fiscal_month: writableFiscalMonthSchema.describe('会計月（YYYY-MM、2000〜2999年）'),
        category_code: categoryCodeSchema.describe(
          `固定費の費目コード（${EXPENSE_FIXED_CODES_LABEL}）`
        ),
        amount: fixedCostAmountSchema.describe(
          '金額（0以上の整数、1,000万円以内。0 はセルを削除）'
        ),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ fiscal_month, category_code, amount }) => {
      try {
        if (isSalary(category_code)) {
          return errorResult(
            '給与は add_salary_item / update_salary_item / delete_salary_item を使ってください'
          )
        }
        if (!isFixedExpense(category_code)) {
          return errorResult(
            `固定費コードではありません（${EXPENSE_FIXED_CODES_LABEL}）。通常の明細は create_transaction を使ってください: ${category_code}`
          )
        }

        const result = await setFixedCostCell(
          db,
          { fiscal_month, category_code, amount, type: 'EXPENSE' },
          { strict: true }
        )
        const data = {
          status: result.status,
          fiscal_month,
          category_code,
          amount,
          previous_amount: result.previous_amount,
        }
        // created / updated / deleted では対象明細の ID を返す（ignored は対象なし）
        if (result.id !== undefined) {
          data.id = result.id
        }
        if (result.transaction) {
          data.transaction = result.transaction
        }
        return successResult(data)
      } catch (err) {
        return errorResult(err.message)
      }
    }
  )

  // 2. add_salary_item
  server.registerTool(
    'add_salary_item',
    {
      title: '給与明細の追加',
      description:
        '給与（収入・費目コード 700）の明細を 1 件追加します。同じ会計月に複数の明細を登録できます。日付は対象会計月の前月 25 日に自動設定されます。現在の給与明細は get_fixed_costs で確認できます。',
      inputSchema: {
        fiscal_month: writableFiscalMonthSchema.describe('会計月（YYYY-MM、2000〜2999年）'),
        amount: salaryAmountSchema.describe('金額（1円以上の整数、1,000万円以内）'),
        description: salaryDescriptionSchema
          .optional()
          .describe('摘要（1〜200文字、省略時は「給与(固定入力)」）'),
      },
      annotations: {
        destructiveHint: false,
      },
    },
    async ({ fiscal_month, amount, description }) => {
      try {
        const data = await addSalaryItem(db, { fiscal_month, amount, description })
        return successResult(data)
      } catch (err) {
        return errorResult(err.message)
      }
    }
  )

  // 3. update_salary_item
  server.registerTool(
    'update_salary_item',
    {
      title: '給与明細の更新',
      description:
        '指定された ID の給与明細の金額・摘要を更新します（少なくとも一方を指定）。会計月・日付は変更できません（変更する場合は削除して追加し直してください）。給与以外の明細は更新できません。',
      inputSchema: {
        id: transactionIdSchema.describe('更新対象の給与明細 ID'),
        amount: salaryAmountSchema.optional().describe('金額（1円以上の整数、1,000万円以内）'),
        description: salaryDescriptionSchema.optional().describe('摘要（1〜200文字）'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ id, amount, description }) => {
      try {
        if (amount === undefined && description === undefined) {
          return errorResult(
            '更新項目が指定されていません（amount または description を指定してください）'
          )
        }
        const data = await updateSalaryItem(db, id, { amount, description })
        if (!data) {
          return errorResult(`指定された給与明細が見つかりません: ${id}`)
        }
        return successResult(data)
      } catch (err) {
        return errorResult(err.message)
      }
    }
  )

  // 4. delete_salary_item
  server.registerTool(
    'delete_salary_item',
    {
      title: '給与明細の削除',
      description:
        '指定された ID の給与明細を削除します。誤削除防止のため confirm: true の指定が必須です。給与以外の明細は削除できません。',
      inputSchema: {
        id: transactionIdSchema.describe('削除対象の給与明細 ID'),
        confirm: z
          .literal(true, {
            errorMap: () => ({ message: '削除を実行するには confirm: true を指定してください' }),
          })
          .describe('削除確認フラグ（true 必須）'),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ id, confirm }) => {
      try {
        if (confirm !== true) {
          return errorResult('削除を実行するには confirm: true を指定してください')
        }
        const deleted = await deleteSalaryItem(db, id)
        if (!deleted) {
          return errorResult(`指定された給与明細が見つかりません: ${id}`)
        }
        return successResult({ deleted_transaction: deleted })
      } catch (err) {
        return errorResult(err.message)
      }
    }
  )
}

module.exports = {
  registerFixedCostTools,
}
