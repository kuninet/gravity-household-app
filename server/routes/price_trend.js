const express = require('express')
const router = express.Router()
const db = require('../db')
const { getPriceTrends } = require('../services/priceTrendService')

/**
 * GET /api/price_trend
 * 品名キーワードによる価格推移データの取得
 */
router.get('/', async (req, res) => {
  try {
    const result = await getPriceTrends(db, req.query)
    res.json(result)
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message })
    }
    console.error('[PriceTrend Route] Error processing trend:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
