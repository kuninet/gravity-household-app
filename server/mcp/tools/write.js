const { z } = require('zod')
const {
  dateSchema,
  typeSchema,
  amountSchema,
  categoryCodeSchema,
  descriptionSchema,
  memoSchema,
  batchItemSchema,
} = require('../schemas')
const { insertOne, insertBatch, updateById, deleteById } = require('../services/transactions')

/**
 * 汎用の更新系ツール (4ツール) を MCP サーバーに登録する
 * 固定費・給与の書き込みは専用ツール（tools/fixedCosts.js）で行う
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('sqlite3').Database} db
 */
function registerWriteTools(server, db) {
  // 1. create_transaction
  server.registerTool(
    'create_transaction',
    {
      title: '取引明細の登録',
      description:
        '家計簿に新しい取引明細を1件登録します。固定費・給与コードは登録できません（固定費は set_fixed_cost_cell、給与は add_salary_item を使ってください）。',
      inputSchema: {
        date: dateSchema.describe('取引日（YYYY-MM-DD）'),
        amount: amountSchema.describe('金額（0円不可、割引等のマイナスは支出のみ指定可能）'),
        type: typeSchema.describe('収支区分（EXPENSE または INCOME）'),
        category_code: categoryCodeSchema.describe('カテゴリコード'),
        description: descriptionSchema.describe('品名・内容（1〜200文字）'),
        memo: memoSchema.describe('メモ・店舗名等（最大500文字）'),
      },
      annotations: {
        destructiveHint: false,
      },
    },
    async (args) => {
      try {
        const data = await insertOne(db, args)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data),
            },
          ],
          structuredContent: data,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: err.message,
            },
          ],
        }
      }
    }
  )

  // 2. create_transactions_batch
  server.registerTool(
    'create_transactions_batch',
    {
      title: '取引明細の一括登録',
      description:
        'レシートや複数明細を一括で登録します（最大200件）。全明細がアトミックに挿入され、dry_run による事前検証も可能です。',
      inputSchema: {
        date: dateSchema.optional().describe('一括取引日（各明細の date が未指定の場合に適用）'),
        store: z
          .string()
          .max(200, '店舗名は200文字以内で指定してください')
          .optional()
          .describe('店舗名（各明細の memo が未指定の場合に適用）'),
        items: z
          .array(batchItemSchema)
          .min(1, '明細は1件以上指定してください')
          .max(200, '明細は最大200件まで指定できます')
          .describe('取引明細リスト（最大200件）'),
        dry_run: z
          .boolean()
          .default(false)
          .optional()
          .describe('ドライラン（true の場合は DB に反映せず計算結果のみ返却）'),
      },
      annotations: {
        destructiveHint: false,
      },
    },
    async (args) => {
      try {
        const data = await insertBatch(db, args)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data),
            },
          ],
          structuredContent: data,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: err.message,
            },
          ],
        }
      }
    }
  )

  // 3. update_transaction
  server.registerTool(
    'update_transaction',
    {
      title: '取引明細の更新',
      description:
        '指定された取引IDの明細を更新します。日付変更時は会計月が自動再計算されます。固定費・給与明細の更新はできません（固定費は set_fixed_cost_cell、給与は update_salary_item を使ってください）。',
      inputSchema: {
        id: z
          .number()
          .int()
          .positive('IDは正の整数で指定してください')
          .describe('更新対象の取引ID'),
        date: dateSchema.optional().describe('取引日（YYYY-MM-DD）'),
        amount: amountSchema.optional().describe('金額（0円不可）'),
        type: typeSchema.optional().describe('収支区分（EXPENSE または INCOME）'),
        category_code: categoryCodeSchema.optional().describe('カテゴリコード'),
        description: descriptionSchema.optional().describe('品名・内容（1〜200文字）'),
        memo: memoSchema.describe('メモ・店舗名等（最大500文字）'),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async (args) => {
      try {
        const { id, ...fields } = args
        const allowedKeys = ['date', 'amount', 'type', 'category_code', 'description', 'memo']
        const hasUpdateField = allowedKeys.some((key) => fields[key] !== undefined)
        if (!hasUpdateField) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: '更新項目が指定されていません',
              },
            ],
          }
        }
        const data = await updateById(db, id, fields)
        if (!data) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `指定された取引IDが見つかりません: ${id}`,
              },
            ],
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data),
            },
          ],
          structuredContent: data,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: err.message,
            },
          ],
        }
      }
    }
  )

  // 4. delete_transaction
  server.registerTool(
    'delete_transaction',
    {
      title: '取引明細の削除',
      description:
        '指定された取引IDの明細を削除します。誤削除防止のため confirm: true の指定が必須です。固定費・給与明細の削除はできません（固定費は set_fixed_cost_cell に金額 0、給与は delete_salary_item を使ってください）。',
      inputSchema: {
        id: z
          .number()
          .int()
          .positive('IDは正の整数で指定してください')
          .describe('削除対象の取引ID'),
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
    async (args) => {
      try {
        if (args.confirm !== true) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: '削除を実行するには confirm: true を指定してください',
              },
            ],
          }
        }
        const data = await deleteById(db, args.id)
        if (!data) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `指定された取引IDが見つかりません: ${args.id}`,
              },
            ],
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data),
            },
          ],
          structuredContent: data,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: err.message,
            },
          ],
        }
      }
    }
  )
}

module.exports = {
  registerWriteTools,
}
