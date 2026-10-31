const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')
const fs = require('fs')

// 指摘 2: app を require する前に DB_PATH を設定して本番の household.db を保護
const tempDbPath = path.join(os.tmpdir(), `mcp-auth-test-${Date.now()}.db`)
process.env.DB_PATH = tempDbPath

// 実行環境の MCP_AUTH_MODE / MCP_ALLOWED_HOSTS に依存せず token モード前提で動かすため、事前に除去する
delete process.env.MCP_AUTH_MODE
delete process.env.MCP_ALLOWED_HOSTS

const { express, startServer, createMcpClient } = require('./mcp-helpers')
const app = require('../../server/app')
const { createMcpRouter } = require('../../server/mcp')
const { getMcpAuthMode } = require('../../server/mcp/auth')

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

test('A7: 15分間に認証失敗10回で11回目は429 Too Many Requests (正トークンでも429、リセット後に回復)', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testRouter = createMcpRouter()
  const testApp = express()
  testApp.use('/mcp', testRouter)
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

    // リセット（窓経過シミュレーション）後に正常回復することを確認
    await testRouter.authFailLimiter.resetKey('127.0.0.1')
    await testRouter.authFailLimiter.resetKey('::ffff:127.0.0.1')
    await testRouter.authFailLimiter.resetKey('::1')

    const resRecover = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${VALID_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    })
    assert.equal(resRecover.status, 200, 'Should recover to 200 after window reset')
  } finally {
    console.warn = originalWarn
    await close()
  }
})

test('A7-reg: GET /mcp (405) を12回挟んだ後でも正トークンでの POST /mcp が 429 にならず 200 で成功する (405 が認証失敗にカウントされないことの証明)', async () => {
  process.env.MCP_AUTH_TOKEN = VALID_TOKEN

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    // 1. GET /mcp (405) を 12 回連続で実行（正トークンあり）
    for (let i = 1; i <= 12; i++) {
      const getRes = await fetch(`${baseUrl}/mcp`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${VALID_TOKEN}`,
        },
      })
      assert.equal(getRes.status, 405, `GET ${i} should be 405`)
    }

    // 2. その後でも正トークンでの POST /mcp は 429 にならず 200 で成功する
    for (let i = 1; i <= 5; i++) {
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
      assert.equal(res.status, 200, `POST ${i} after GETs should be 200`)
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

// ===== 無認証モード (MCP_AUTH_MODE=none) =====

const AUTH_ENV_KEYS = ['MCP_AUTH_MODE', 'MCP_AUTH_TOKEN', 'MCP_ALLOWED_HOSTS']

/**
 * 認証関連の環境変数を退避し、overrides を適用する。
 * 戻り値の restore() で元に戻す（undefined だったものは delete して "undefined" 文字列化を防ぐ）
 */
function overrideAuthEnv(overrides) {
  const saved = {}
  for (const key of AUTH_ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value
  }
  return () => {
    for (const key of AUTH_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  }
}

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
})

function postInitialize(baseUrl, extraHeaders = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: INITIALIZE_BODY,
  })
}

test('A9-mode: getMcpAuthMode は none のみ none、未設定・空・token・不正値は token', () => {
  const restore = overrideAuthEnv({})
  try {
    assert.equal(getMcpAuthMode(), 'token')

    const cases = [
      ['none', 'none'],
      ['NONE', 'none'],
      ['  None  ', 'none'],
      ['token', 'token'],
      ['', 'token'],
      ['   ', 'token'],
      ['off', 'token'],
      ['false', 'token'],
      ['no', 'token'],
      ['nonee', 'token'],
    ]
    for (const [input, expected] of cases) {
      process.env.MCP_AUTH_MODE = input
      assert.equal(getMcpAuthMode(), expected, `MCP_AUTH_MODE=${JSON.stringify(input)}`)
    }
  } finally {
    restore()
  }
})

test('A9: MCP_AUTH_MODE=none かつ MCP_AUTH_TOKEN 未設定 -> トークンなしで initialize / tools/list / callTool が成功し、app 本体でも 503 にならない', async () => {
  const restore = overrideAuthEnv({ MCP_AUTH_MODE: 'none' })

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)
  const appServer = await startServer(app)
  let client

  try {
    // トークンなしの SDK Client
    const mcp = await createMcpClient({ baseUrl })
    client = mcp.client
    const tools = await client.listTools()
    const toolNames = tools.tools.map((t) => t.name)
    assert.ok(toolNames.includes('get_fiscal_month'), 'get_fiscal_month tool exists')

    const result = await client.callTool({
      name: 'get_fiscal_month',
      arguments: { date: '2026-10-23' },
    })
    assert.ok(!result.isError)
    const parsed = JSON.parse(result.content[0].text)
    assert.equal(parsed.fiscal_month, '2026-11')

    // server/app 本体: A1 (503) の逆
    const appRes = await postInitialize(appServer.baseUrl)
    assert.equal(appRes.status, 200)
  } finally {
    if (client) await client.close()
    restore()
    await close()
    await appServer.close()
  }
})

test('A9-header: MCP_AUTH_MODE=none ならトークン設定済みで誤トークン・?token を付けても 401 にならない', async () => {
  const restore = overrideAuthEnv({ MCP_AUTH_MODE: 'none', MCP_AUTH_TOKEN: VALID_TOKEN })

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const res = await postInitialize(baseUrl, { Authorization: 'Bearer wrong' })
    assert.equal(res.status, 200)

    const resQuery = await fetch(`${baseUrl}/mcp?token=wrong`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: INITIALIZE_BODY,
    })
    assert.equal(resQuery.status, 200)
  } finally {
    restore()
    await close()
  }
})

test("A9-case: MCP_AUTH_MODE=' NONE ' (前後空白・大文字) でも無認証として動作する", async () => {
  const restore = overrideAuthEnv({ MCP_AUTH_MODE: ' NONE ' })

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const res = await postInitialize(baseUrl)
    assert.equal(res.status, 200)
  } finally {
    restore()
    await close()
  }
})

test('A9-invalid: MCP_AUTH_MODE=off (不正値) は token 扱い -> トークン未設定は 503、設定済みでヘッダーなしは 401', async () => {
  const restore = overrideAuthEnv({ MCP_AUTH_MODE: 'off' })

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    // トークン未設定 -> 503
    const res503 = await postInitialize(baseUrl)
    assert.equal(res503.status, 503)
    assert.deepEqual(await res503.json(), { error: 'MCP is disabled' })

    // トークン設定済み・ヘッダーなし -> 401
    process.env.MCP_AUTH_TOKEN = VALID_TOKEN
    const res401 = await postInitialize(baseUrl)
    assert.equal(res401.status, 401)
    assert.equal(res401.headers.get('www-authenticate'), 'Bearer realm="gravity-mcp"')
  } finally {
    restore()
    await close()
  }
})

test('A9-host: MCP_AUTH_MODE=none でも MCP_ALLOWED_HOSTS の Host 検証は有効 (許可外 Host は 403)', async () => {
  const restore = overrideAuthEnv({
    MCP_AUTH_MODE: 'none',
    MCP_ALLOWED_HOSTS: 'allowed.example.com',
  })

  const testApp = express()
  testApp.use('/mcp', createMcpRouter())
  const { baseUrl, close } = await startServer(testApp)

  try {
    const res = await postInitialize(baseUrl)
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.error.message, 'Host not allowed')
  } finally {
    restore()
    await close()
  }
})
