const { z } = require('zod')
const { getFiscalMonthInfo, isValidDateString } = require('../../lib/fiscalMonth')
const summaryService = require('../../services/summaryService')
const fixedCostService = require('../../services/fixedCostService')
const priceTrendService = require('../../services/priceTrendService')
const { listCategories, listTransactions, getTransaction } = require('../services/transactions')

const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const FISCAL_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * 参照系ツール (7ツール) を MCP サーバーに登録する
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('sqlite3').Database} db
 */
function registerReadTools(server, db) {
  // 1. get_categories
  server.registerTool(
    'get_categories',
    {
      title: 'カテゴリ一覧取得',
      description:
        '家計簿の全カテゴリ一覧を取得します。固定費・給与コード判定（fixed: boolean）が含まれます。',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      try {
        const categories = await listCategories(db)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(categories),
            },
          ],
          structuredContent: { categories },
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `カテゴリ一覧の取得に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )

  // 2. get_transactions
  server.registerTool(
    'get_transactions',
    {
      title: '取引明細一覧取得',
      description:
        '取引明細の一覧を検索・取得します。会計月、収支区分、カテゴリ、期間、キーワード検索、固定費有無、ページネーションに対応しています。',
      inputSchema: {
        fiscal_month: z
          .string()
          .regex(FISCAL_MONTH_REGEX, '会計月は YYYY-MM 形式（01〜12月）で指定してください')
          .optional()
          .describe('会計月（YYYY-MM）'),
        from: z
          .string()
          .regex(DATE_REGEX, '開始日は YYYY-MM-DD 形式で指定してください')
          .refine((val) => isValidDateString(val), '実在する有効な日付を指定してください')
          .optional()
          .describe('開始日（YYYY-MM-DD）'),
        to: z
          .string()
          .regex(DATE_REGEX, '終了日は YYYY-MM-DD 形式で指定してください')
          .refine((val) => isValidDateString(val), '実在する有効な日付を指定してください')
          .optional()
          .describe('終了日（YYYY-MM-DD）'),
        type: z
          .enum(['INCOME', 'EXPENSE'])
          .optional()
          .describe('収支区分（INCOME または EXPENSE）'),
        category_code: z.number().int().optional().describe('カテゴリコード'),
        keyword: z
          .string()
          .max(100, 'キーワードは100文字以内で指定してください')
          .optional()
          .describe('品名またはメモの部分一致検索キーワード'),
        include_fixed: z
          .boolean()
          .default(true)
          .optional()
          .describe('固定費・給与行を含めるか（既定 true）'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500, '一度に取得できる件数は最大500件です')
          .default(100)
          .optional()
          .describe('取得件数上限（1〜500、既定100）'),
        offset: z.number().int().min(0).default(0).optional().describe('取得開始位置（既定0）'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args) => {
      try {
        if (args.from && args.to && args.from > args.to) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: '開始日（from）は終了日（to）以前の日付を指定してください。',
              },
            ],
          }
        }
        const result = await listTransactions(db, args)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `取引一覧の取得に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )

  // 3. get_transaction
  server.registerTool(
    'get_transaction',
    {
      title: '取引明細単件取得',
      description: '取引IDを指定して単一の明細を取得します。',
      inputSchema: {
        id: z.number().int().describe('取引ID'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ id }) => {
      try {
        const tx = await getTransaction(db, id)
        if (!tx) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `取引ID ${id} の取引明細は見つかりませんでした。`,
              },
            ],
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tx),
            },
          ],
          structuredContent: tx,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `取引明細の取得に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )

  // 4. get_summary
  server.registerTool(
    'get_summary',
    {
      title: '月次収支サマリ取得',
      description:
        '指定した会計月の収支サマリ、カテゴリ別内訳、前月比較データを取得します。会計月を省略した場合は現在の会計月が対象となります。',
      inputSchema: {
        fiscal_month: z
          .string()
          .regex(FISCAL_MONTH_REGEX, '会計月は YYYY-MM 形式（01〜12月）で指定してください')
          .optional()
          .describe('会計月（YYYY-MM）。未指定時は現在の会計月'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ fiscal_month } = {}) => {
      try {
        const summary = await summaryService.getMonthSummary(db, fiscal_month)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary),
            },
          ],
          structuredContent: summary,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `収支サマリの取得に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )

  // 5. get_fixed_costs
  server.registerTool(
    'get_fixed_costs',
    {
      title: '固定費マトリクス取得',
      description:
        '指定された年の固定費・固定収入（給与）の一覧（固定費マトリクス元データ）を取得します。',
      inputSchema: {
        year: z
          .number()
          .int()
          .min(2000, '年は2000年以上を指定してください')
          .max(2999, '年は2999年以下を指定してください')
          .optional()
          .describe('対象年（2000〜2999、未指定時は現在の年）'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ year } = {}) => {
      try {
        const targetYear = year ?? new Date().getFullYear()
        const result = await fixedCostService.getFixedCostMatrix(db, { year: targetYear })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `固定費一覧の取得に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )

  // 6. get_price_trends
  server.registerTool(
    'get_price_trends',
    {
      title: '品名価格推移取得',
      description:
        '品名キーワードによる支出取引の価格推移・統計（最安値、最高値、平均値、直近価格など）を取得します。',
      inputSchema: {
        keyword: z
          .string()
          .min(1, 'キーワードを指定してください')
          .max(100, 'キーワードは100文字以内で指定してください')
          .describe('品名検索キーワード'),
        mode: z
          .enum(['jev', 'simple'])
          .default('jev')
          .optional()
          .describe('品名マッチングモード（jev または simple）'),
        from: z
          .string()
          .regex(DATE_REGEX, '開始日は YYYY-MM-DD 形式で指定してください')
          .refine((val) => isValidDateString(val), '実在する有効な日付を指定してください')
          .optional()
          .describe('開始日（YYYY-MM-DD）'),
        to: z
          .string()
          .regex(DATE_REGEX, '終了日は YYYY-MM-DD 形式で指定してください')
          .refine((val) => isValidDateString(val), '実在する有効な日付を指定してください')
          .optional()
          .describe('終了日（YYYY-MM-DD）'),
        selected_items: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe('絞り込む品名（配列またはカンマ区切り文字列）'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args) => {
      try {
        if (args.from && args.to && args.from > args.to) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: '開始日（from）は終了日（to）以前の日付を指定してください。',
              },
            ],
          }
        }
        let normalizedSelectedItems = args.selected_items
        if (Array.isArray(args.selected_items)) {
          normalizedSelectedItems = args.selected_items.join(',')
        }
        const result = await priceTrendService.getPriceTrends(db, {
          ...args,
          selected_items: normalizedSelectedItems,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `価格推移の取得に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )

  // 7. get_fiscal_month
  server.registerTool(
    'get_fiscal_month',
    {
      title: '会計月計算',
      description:
        '日付（YYYY-MM-DD）から会計月（YYYY-MM）および会計月期間（前月23日〜当月22日）を取得します。',
      inputSchema: {
        date: z
          .string()
          .regex(DATE_REGEX, '日付は YYYY-MM-DD 形式で指定してください')
          .refine(
            (val) => isValidDateString(val),
            'カレンダー上に実在しない無効な日付です（例: 2026-02-30 など）'
          )
          .describe('日付（YYYY-MM-DD）'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ date }) => {
      try {
        const info = getFiscalMonthInfo(date)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(info),
            },
          ],
          structuredContent: info,
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `会計月の計算に失敗しました: ${err.message}`,
            },
          ],
        }
      }
    }
  )
}

module.exports = {
  registerReadTools,
}
