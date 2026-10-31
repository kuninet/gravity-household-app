require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
require('./db')

const app = express()
const PORT = process.env.PORT || 3001

// MCP router (mounted before global bodyParser/cors so it has custom body limit and no browser CORS)
app.use('/mcp', require('./mcp'))

// Middleware
app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Routes
const transactionRoutes = require('./routes/transactions')
const categoryRoutes = require('./routes/categories')

app.use('/api/transactions', transactionRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/summary', require('./routes/summary'))
app.use('/api/analysis', require('./routes/analysis'))
app.use('/api/fixed_costs', require('./routes/fixed_costs'))
app.use('/api/import', require('./routes/import'))
app.use('/api/ocr', require('./routes/ocr'))
app.use('/api/backup', require('./routes/backup'))
app.use('/api/receipts', require('./routes/receipts'))
app.use('/api/price_trend', require('./routes/price_trend'))

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Household Account App API is running' })
})

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
    const rawAuthMode = String(process.env.MCP_AUTH_MODE || '')
      .trim()
      .toLowerCase()
    if (rawAuthMode && rawAuthMode !== 'token' && rawAuthMode !== 'none') {
      console.warn('[MCP] 警告: MCP_AUTH_MODE の値が不正なため token モードとして扱います。')
    }
    if (require('./mcp/auth').getMcpAuthMode() === 'none') {
      console.warn(
        '[MCP] 警告: MCP_AUTH_MODE=none のため /mcp は認証なしで公開されています。外部公開する場合は Cloudflare Access 等の前段で接続元を制限し、MCP_ALLOWED_HOSTS を設定してください。'
      )
    }
  })
}

module.exports = app
