const express = require('express')
const router = express.Router()
const db = require('../db')
const { judgeItems, isJevConfigured } = require('../lib/jevService')

/**
 * GET /api/transactions/price-trend
 * 品名キーワードによる価格推移データの取得
 */
router.get('/', async (req, res) => {
  const { keyword, mode, from, to, selected_items } = req.query

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'キーワード（keyword）を指定してください。' })
  }

  const trimmedKeyword = keyword.trim()
  const useSimple = mode === 'simple'

  // 支出取引から品名が存在するものを取得（カテゴリ名もJOIN）
  let sql = `
        SELECT 
            t.id,
            t.date,
            t.fiscal_month,
            t.amount,
            t.description,
            t.memo,
            t.category_code,
            c.name as category_name
        FROM transactions t
        LEFT JOIN categories c ON t.category_code = c.code
        WHERE t.type = 'EXPENSE'
          AND t.description IS NOT NULL
          AND TRIM(t.description) != ''
    `
  const params = []

  if (from) {
    sql += ' AND t.date >= ?'
    params.push(from)
  }
  if (to) {
    sql += ' AND t.date <= ?'
    params.push(to)
  }

  sql += ' ORDER BY t.date ASC, t.id ASC'

  db.all(sql, params, async (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message })
    }

    try {
      // ユニークな品名リストを抽出
      const uniqueNames = Array.from(new Set(rows.map((r) => r.description.trim())))

      // Jev または フォールバックで判定
      const judgments = await judgeItems(uniqueNames, trimmedKeyword, useSimple)

      // マッチした品名リストを構築
      const matchedItemsSummary = []
      const matchedNameSet = new Set()

      for (const name of uniqueNames) {
        const judgment = judgments.get(name)
        if (judgment && judgment.isMatch) {
          matchedNameSet.add(name)
          const count = rows.filter((r) => r.description.trim() === name).length
          matchedItemsSummary.push({
            name,
            count,
            confidence: judgment.confidence,
            source: judgment.source,
          })
        }
      }

      // 出現回数順にソート
      matchedItemsSummary.sort((a, b) => b.count - a.count)

      // ユーザー指定の品名フィルターがあれば適用
      let activeNames = matchedNameSet
      if (selected_items) {
        const requested = selected_items.split(',').map((s) => s.trim())
        activeNames = new Set(requested.filter((n) => matchedNameSet.has(n)))
      }

      // 対象取引をフィルタリング
      const trendRows = rows.filter((r) => activeNames.has(r.description.trim()))

      // サマリー計算
      const amounts = trendRows.map((r) => r.amount)
      const count = amounts.length
      const total = amounts.reduce((acc, cur) => acc + cur, 0)
      const averagePrice = count > 0 ? Math.round(total / count) : 0
      const minPrice = count > 0 ? Math.min(...amounts) : 0
      const maxPrice = count > 0 ? Math.max(...amounts) : 0

      const latestRecord = count > 0 ? trendRows[count - 1] : null
      const previousRecord = count > 1 ? trendRows[count - 2] : null
      const priceDiff =
        latestRecord && previousRecord ? latestRecord.amount - previousRecord.amount : null

      res.json({
        keyword: trimmedKeyword,
        jev_configured: isJevConfigured(),
        mode_used: useSimple ? 'simple' : isJevConfigured() ? 'jev' : 'fallback',
        summary: {
          count,
          average_price: averagePrice,
          min_price: minPrice,
          max_price: maxPrice,
          latest_price: latestRecord ? latestRecord.amount : null,
          latest_date: latestRecord ? latestRecord.date : null,
          price_diff: priceDiff,
        },
        matched_items: matchedItemsSummary,
        data: trendRows,
      })
    } catch (processErr) {
      console.error('[PriceTrend Route] Error processing trend:', processErr)
      res.status(500).json({ error: '価格推移データの集計中にエラーが発生しました。' })
    }
  })
})

module.exports = router
