const crypto = require('crypto')

/**
 * SHA-256 ダイジェスト経由で timingSafeEqual を適用し、
 * 長さの不一致による情報漏洩やエラーを防止する安全な文字列比較関数
 */
function safeTokenCompare(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false
  }
  const hashProvided = crypto.createHash('sha256').update(provided).digest()
  const hashExpected = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(hashProvided, hashExpected)
}

/**
 * MCP の認証方式を返す
 * MCP_AUTH_MODE を trim + 小文字化して 'none' のときだけ 'none'（認証なし）、
 * それ以外（未設定・空・'token'・不正値）はすべて 'token' を返す (fail-closed)
 * 環境変数はリクエスト毎に読むため、モジュール読み込み時にはキャッシュしない
 */
function getMcpAuthMode() {
  const mode = String(process.env.MCP_AUTH_MODE || '')
    .trim()
    .toLowerCase()
  return mode === 'none' ? 'none' : 'token'
}

/**
 * MCP トークン認証ミドルウェア
 * 仕様:
 * 0. MCP_AUTH_MODE=none の場合は認証を行わず素通しする（MCP_AUTH_TOKEN・Authorization・?token はすべて無視）。
 *    明示オプトインのみ。未設定・不正値は token 扱い (fail-closed)
 * 1. MCP_AUTH_TOKEN 未設定（または16文字未満）時は 503 fail-closed
 * 2. Authorization: Bearer <token> を主方式とする
 * 3. MCP_ALLOW_QUERY_TOKEN === 'true' の場合のみ ?token=<token> クエリを許可
 * 4. 比較は timingSafeEqual で行い、ログにトークン値を出力しない
 * 5. 認証失敗時は 401 + WWW-Authenticate ヘッダー
 */
function mcpAuth(req, res, next) {
  // 0. 無認証モード (MCP_AUTH_MODE=none)
  if (getMcpAuthMode() === 'none') {
    return next()
  }

  const expectedToken = process.env.MCP_AUTH_TOKEN

  // 1. 未設定または16文字未満の場合は 503 で MCP を無効化 (fail-closed)
  if (!expectedToken || expectedToken.length < 16) {
    return res.status(503).json({ error: 'MCP is disabled' })
  }

  // 2. トークン取得
  let clientToken = null
  const authHeader = req.headers['authorization']

  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (match) {
      clientToken = match[1].trim()
    }
  }

  // 3. クエリパラメータ fallback (MCP_ALLOW_QUERY_TOKEN=true 時のみ)
  if (
    !clientToken &&
    process.env.MCP_ALLOW_QUERY_TOKEN === 'true' &&
    req.query &&
    req.query.token
  ) {
    clientToken = String(req.query.token).trim()
  }

  // 4. トークン未指定
  if (!clientToken) {
    res.set('WWW-Authenticate', 'Bearer realm="gravity-mcp"')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 5. トークン検証
  if (!safeTokenCompare(clientToken, expectedToken)) {
    console.warn('[MCP] auth failed', req.ip)
    res.set('WWW-Authenticate', 'Bearer realm="gravity-mcp"')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  next()
}

module.exports = {
  mcpAuth,
  getMcpAuthMode,
  safeTokenCompare,
}
