const express = require('express')
const { rateLimit } = require('express-rate-limit')
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { mcpAuth } = require('./auth')
const { createMcpServer } = require('./server')

function createMcpRouter() {
  const router = express.Router()

  // 1. /mcp 専用の body parser (上限 1MB)
  router.use(express.json({ limit: '1mb' }))

  // 2. DNS rebinding 対策 (MCP_ALLOWED_HOSTS が設定されている場合のみ検証)
  router.use((req, res, next) => {
    const allowed = process.env.MCP_ALLOWED_HOSTS
    if (!allowed) return next()

    const allowedList = allowed
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
    if (allowedList.length === 0) return next()

    const hostHeader = (req.headers['host'] || '').toLowerCase()
    const hostWithoutPort = hostHeader.replace(/:\d+$/, '')

    const isAllowed = allowedList.some((h) => hostHeader === h || hostWithoutPort === h)
    if (!isAllowed) {
      return res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Host not allowed' },
        id: null,
      })
    }

    next()
  })

  // 3. 全体レート制限 (120 req / 1分)
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Too many requests' },
      id: null,
    },
  })
  router.use(generalLimiter)
  router.generalLimiter = generalLimiter

  // 4. 認証失敗レート制限 (15分で10回失敗時に 429)
  // requestWasSuccessful により 401 以外のレスポンス（成功や他エラー）は失敗カウントから除外される
  const authFailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Too many authentication failures' },
      id: null,
    },
  })
  router.use(authFailLimiter)
  router.authFailLimiter = authFailLimiter

  // 5. 認証ミドルウェア
  router.use(mcpAuth)

  // 6. POST メソッドの処理 (ステートレス Streamable HTTP)
  router.post('/', async (req, res, next) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      const server = createMcpServer()

      res.on('close', () => {
        transport.close()
        server.close()
      })

      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      next(err)
    }
  })

  // 7. POST 以外の HTTP メソッドは 405 Method Not Allowed
  router.all('/', (req, res) => {
    res.setHeader('Allow', 'POST')
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method Not Allowed' },
      id: null,
    })
  })

  // 8. /mcp 専用エラーハンドラ
  // JSON 構文エラーは 400 + -32700、413 は 413 + -32600、その他は 500 + -32603
  router.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err)
    }

    if (err.status === 413 || err.statusCode === 413 || err.type === 'entity.too.large') {
      return res.status(413).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Payload Too Large' },
        id: null,
      })
    }

    if (err.status === 400 || err.statusCode === 400 || err instanceof SyntaxError) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      })
    }

    console.error('[MCP] unhandled error:', err.message)
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error' },
      id: null,
    })
  })

  return router
}

const defaultRouter = createMcpRouter()
defaultRouter.createMcpRouter = createMcpRouter

module.exports = defaultRouter
