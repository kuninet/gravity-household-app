const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const defaultDb = require('../db')
const { registerReadTools } = require('./tools/read')
const { registerWriteTools } = require('./tools/write')

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

  // 更新系ツール (4ツール) の登録
  registerWriteTools(server, db)

  return server
}

module.exports = {
  createMcpServer,
}
