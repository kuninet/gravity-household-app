const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')
const fs = require('fs')

// 指摘 2: app を require する前に DB_PATH を設定して本番の household.db を保護
const tempDbPath = path.join(os.tmpdir(), `mcp-auth-test-${Date.now()}.db`)
process.env.DB_PATH = tempDbPath

const { express, startServer, createMcpClient } = require('./mcp-helpers')
const app = require('../../server/app')
const { createMcpRouter } = require('../../server/mcp')

const VALID_TOKEN = 'test-mcp-valid-token-32-characters-long!'
const INVALID_SAME_LEN = 'test-mcp-wrong-token-32-characters-long!'
const INVALID_DIFF_LEN = 'wrong-token'

test.after(() => {
  try {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath)
    const wal = `${tempDbPath}-wal`
    const shm = `${tempDbPath}-shm`
    if (fs.existsSync(wal)) fs.unlinkSync(wal)
    if (fs.existsSync(shm)) fs.unlinkSync(shm)
  } catch {
    // ignore cleanup error
  }
})

test('A1: MCP_AUTH_TOKEN 未設定時 -> POST /mcp は 503, GET /api/health は 200', async () => {
  const originalToken = process.env.MCP_AUTH_TOKEN
  delete process.env.MCP_AUTH_TOKEN

  const { baseUrl, close } = await startServer(app)
  try {
    // POST /mcp
    const mcpRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    assert.equal(mcpRes.status, 503)
    const mcpBody = await mcpRes.json()
    assert.deepEqual(mcpBody, { error: 'MCP is disabled' })

    // GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`)
    assert.equal(healthRes.status, 200)
    const healthBody = await healthRes.json()
    assert.equal(healthBody.status, 'ok')
  } finally {
    // 指摘 4: undefined の場合は delete して文字列 "undefined" になるバグを防止
    if (originalToken === undefined) {
      delete process.env.MCP_AUTH_TOKEN
    } else {
      process.env.MCP_AUTH_TOKEN = originalToken
    }
    await close()
  }
})

test('A2: Authorization ヘッダー未指定時 -> 401 と WWW-Authenticate ヘッダー', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })

    assert.equal(res.status, 401)
    assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="gravity-mcp"')
    const body = await res.json()
    assert.equal(body.error, 'Unauthorized')
  } finally {
    await close()
  }
})

test('A3: 誤トークン (同長・異長) -> 401 かつログにトークン値が出ない', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  // console.warn をキャプチャ
  const originalWarn = console.warn
  const capturedLogs = []
  console.warn = (...args) => {
    capturedLogs.push(args.join(' '))
  }

  try {
    // 同長トークン
    const resSame = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${INVALID_SAME_LEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    assert.equal(resSame.status, 401)

    // 異長トークン
    const resDiff = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${INVALID_DIFF_LEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
    })
    assert.equal(resDiff.status, 401)

    // ログ検証: 警告は出ているが、トークン文字列自体は含まれていないこと
    assert.ok(capturedLogs.length >= 2, 'Warn logs should be output')
    for (const log of capturedLogs) {
      assert.ok(!log.includes(INVALID_SAME_LEN), 'Token should not appear in log')
      assert.ok(!log.includes(INVALID_DIFF_LEN), 'Token should not appear in log')
      assert.ok(!log.includes(VALID_TOKEN), 'Valid token should not appear in log')
    }
  } finally {
    console.warn = originalWarn
    await close()
  }
})

test('A4: 正トークン -> SDK Client で initialize と tools/list が成功し get_fiscal_month が利用可能', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const { client } = await createMcpClient({
      baseUrl,
      token: VALID_TOKEN,
    })

    // tools/list
    const tools = await client.listTools()
    assert.ok(Array.isArray(tools.tools))
    const toolNames = tools.tools.map((t) => t.name)
    assert.ok(toolNames.includes('get_fiscal_month'), 'get_fiscal_month tool exists')

    // tools/call
    const result = await client.callTool({
      name: 'get_fiscal_month',
      arguments: { date: '2026-10-23' },
    })
    assert.ok(!result.isError)
    assert.ok(result.content && result.content.length > 0)
    const parsed = JSON.parse(result.content[0].text)
    assert.equal(parsed.fiscal_month, '2026-11')
    assert.equal(parsed.date, '2026-10-23')
    assert.deepEqual(parsed.range, { start: '2026-10-23', end: '2026-11-22' })

    await client.close()
  } finally {
    await close()
  }
})

test('A4-case: Authorization ヘッダーの小文字 bearer スキームも許容される', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `bearer ${VALID_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    })
    assert.equal(res.status, 200)
  } finally {
    await close()
  }
})

test('A5: クエリオプトイン (MCP_ALLOW_QUERY_TOKEN)', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  // 1. 未設定時 (既定) -> クエリトークンは 401
  delete process.env.MCP_ALLOW_QUERY_TOKEN
  const testApp1 = express()
  testApp1.use('/mcp', createMcpRouter())
  const s1 = await startServer(testApp1)

  try {
    const res = await fetch(`${s1.baseUrl}/mcp?token=${encodeURIComponent(VALID_TOKEN)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    })
    assert.equal(res.status, 401)
  } finally {
    await s1.close()
  }

  // 2. MCP_ALLOW_QUERY_TOKEN=true の時 -> クエリトークンで 200 成功
  process.env.MCP_ALLOW_QUERY_TOKEN = 'true'
  const testApp2 = express()
  testApp2.use('/mcp', createMcpRouter())
  const s2 = await startServer(testApp2)

  try {
    const res = await fetch(`${s2.baseUrl}/mcp?token=${encodeURIComponent(VALID_TOKEN)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.result.serverInfo.name, 'gravity-household-app')
  } finally {
    delete process.env.MCP_ALLOW_QUERY_TOKEN
    await s2.close()
  }
})

test('A6: GET /mcp および DELETE /mcp は 405 Method Not Allowed (Allow: POST ヘッダー & コード -32000)', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const headers = { Authorization: `Bearer ${VALID_TOKEN}` }

    const getRes = await fetch(`${baseUrl}/mcp`, { method: 'GET', headers })
    assert.equal(getRes.status, 405)
    assert.equal(getRes.headers.get('allow'), 'POST')
    const getBody = await getRes.json()
    assert.equal(getBody.error.code, -32000)

    const deleteRes = await fetch(`${baseUrl}/mcp`, { method: 'DELETE', headers })
    assert.equal(deleteRes.status, 405)
    assert.equal(deleteRes.headers.get('allow'), 'POST')
    const delBody = await deleteRes.json()
    assert.equal(delBody.error.code, -32000)
  } finally {
    await close()
  }
})

test('A7: 15分間に認証失敗10回で11回目は429 Too Many Requests (正トークンでも429)', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  // console.warn を抑制
  const originalWarn = console.warn
  console.warn = () => {}

  try {
    // 10 回認証失敗
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${INVALID_DIFF_LEN}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'initialize' }),
      })
      assert.equal(res.status, 401, `Attempt ${i} should be 401`)
    }

    // 11 回目: 正トークンを送っても 429
    const res11 = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${VALID_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'initialize' }),
    })
    assert.equal(res11.status, 429)
    const body11 = await res11.json()
    assert.equal(body11.error.code, -32000)
  } finally {
    console.warn = originalWarn
    await close()
  }
})

test('A7-reg: 正トークンで 11 回以上連続してリクエストしても 429 にならず正常接続できる (指摘 1 回帰テスト)', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    for (let i = 1; i <= 15; i++) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${VALID_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: i,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      })
      assert.equal(res.status, 200, `Request ${i} should be 200`)
    }
  } finally {
    await close()
  }
})

test('A8: 1MB 超ボディで 413 Payload Too Large とサーバー継続稼働', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    // 1.2MB の巨大ペイロード
    const hugePadding = 'x'.repeat(1.2 * 1024 * 1024)
    const hugePayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { padding: hugePadding },
    })

    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${VALID_TOKEN}`,
      },
      body: hugePayload,
    })

    assert.equal(res.status, 413)
    const body = await res.json()
    assert.equal(body.error.code, -32600)
    assert.equal(body.error.message, 'Payload Too Large')

    // サーバーがクラッシュせず稼働を継続していることを確認
    const checkRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${VALID_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    })
    assert.equal(checkRes.status, 200)
  } finally {
    await close()
  }
})
