const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { z } = require('zod')
const { getFiscalMonthInfo, isValidDateString } = require('../lib/fiscalMonth')

/**
 * MCP サーバーの生成とツールの登録
 * Sub-issue #80 では疎通確認用の get_fiscal_month のみを登録する
 */
function createMcpServer() {
  const server = new McpServer(
    {
      name: 'gravity-household-app',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // 疎通確認用ツール: get_fiscal_month
  server.registerTool(
    'get_fiscal_month',
    {
      description:
        '日付（YYYY-MM-DD）から会計月（YYYY-MM）および会計月期間（前月23日〜当月22日）を取得します。',
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で指定してください')
          .refine(
            (val) => isValidDateString(val),
            'カレンダー上に実在しない無効な日付です（例: 2026-02-30 など）'
          ),
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

  return server
}

module.exports = {
  createMcpServer,
}
