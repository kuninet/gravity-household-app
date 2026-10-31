const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const defaultDb = require('../db')
const { registerReadTools } = require('./tools/read')
const { registerWriteTools } = require('./tools/write')
const { registerFixedCostTools } = require('./tools/fixedCosts')

/**
 * MCP サーバーの生成とツールの登録
 * @param {import('sqlite3').Database} [db]
 */
function createMcpServer(db = defaultDb) {
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

  // 参照系ツール (7ツール) の登録
  registerReadTools(server, db)

  // 更新系ツール (8ツール) の登録
  // 汎用の取引明細ツール (4ツール): 固定費・給与コードの書き込みは拒否する
  registerWriteTools(server, db)
  // 固定費・給与の専用ツール (4ツール): 固定入力画面と同じ前提で書き込む
  registerFixedCostTools(server, db)

  return server
}

module.exports = {
  createMcpServer,
}
