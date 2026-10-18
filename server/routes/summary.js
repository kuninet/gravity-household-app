const express = require('express')
const router = express.Router()
const db = require('../db')
const { getMonthSummary } = require('../services/summaryService')

// Get monthly summary (totals by category group)
router.get('/', async (req, res) => {
  try {
    const summary = await getMonthSummary(db, req.query.month)
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
