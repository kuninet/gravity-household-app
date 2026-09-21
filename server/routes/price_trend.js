const express = require('express')
const router = express.Router()
const db = require('../db')
const { judgeItems, isJevConfigured } = require('../lib/jevService')

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const MAX_CANDIDATE_ITEMS = 100

/**
 * GET /api/price_trend
 * 品名キーワードによる価格推移データの取得
 */
router.get('/', async (req, res) => {
  const { keyword, mode, from, to, selected_items } = req.query

  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return res.status(400).json({ error: 'キーワード（keyword）を指定してください。' })
  }

  const trimmedKeyword = keyword.trim()
  if (trimmedKeyword.length > 100) {
    return res.status(400).json({ error: 'キーワードは100文字以内で指定してください。' })
  }

  const validMode = mode === 'simple' ? 'simple' : 'jev'
  const useSimple = validMode === 'simple'

  if (from && (!DATE_REGEX.test(from) || isNaN(Date.parse(from)))) {
    return res.status(400).json({ error: 'from は YYYY-MM-DD 形式で指定してください。' })
  }
  if (to && (!DATE_REGEX.test(to) || isNaN(Date.parse(to)))) {
    return res.status(400).json({ error: 'to は YYYY-MM-DD 形式で指定してください。' })
  }

  // 支出取引から品名が存在し、金額が正数（割引・値引き行を除外）のものを取得
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
          AND t.amount > 0
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
      // 品名ごとの出現頻度を O(M) で事前集計
      const itemCounts = new Map()
      for (const r of rows) {
        const desc = r.description.trim()
        itemCounts.set(desc, (itemCounts.get(desc) || 0) + 1)
      }

      // 全ユニーク品名
      const allUniqueNames = Array.from(itemCounts.keys())

      // Jev判定対象の安全な絞り込み:
      // 候補数が多すぎる場合、キーワード部分一致や出現頻度上位を優先して MAX_CANDIDATE_ITEMS 件に絞る
      let candidateNames = allUniqueNames
      if (candidateNames.length > MAX_CANDIDATE_ITEMS) {
        // 部分一致するものを優先、残りは出現回数順
        const lowerKw = trimmedKeyword.toLowerCase()
        const matched = []
        const others = []
        for (const name of candidateNames) {
          if (name.toLowerCase().includes(lowerKw)) {
            matched.push(name)
          } else {
            others.push(name)
          }
        }
        others.sort((a, b) => (itemCounts.get(b) || 0) - (itemCounts.get(a) || 0))
        candidateNames = matched.concat(others).slice(0, MAX_CANDIDATE_ITEMS)
      }

      // Jev または フォールバックで判定
      const judgments = await judgeItems(candidateNames, trimmedKeyword, useSimple)

      // マッチした品名リストを構築
      const matchedItemsSummary = []
      const matchedNameSet = new Set()

      for (const name of candidateNames) {
        const judgment = judgments.get(name)
        if (judgment && judgment.isMatch) {
          matchedNameSet.add(name)
          matchedItemsSummary.push({
            name,
            count: itemCounts.get(name) || 0,
            confidence: judgment.confidence,
            source: judgment.source,
          })
        }
      }

      // 出現回数降順にソート
      matchedItemsSummary.sort((a, b) => b.count - a.count)

      // ユーザー指定の品名フィルターがあれば適用
      let activeNames = matchedNameSet
      if (selected_items && typeof selected_items === 'string') {
        const requested = selected_items.split(',').map((s) => s.trim().slice(0, 100))
        activeNames = new Set(requested.filter((n) => matchedNameSet.has(n)))
      }

      // 対象取引をフィルタリング
      const trendRows = rows.filter((r) => activeNames.has(r.description.trim()))

      // サマリー計算（スプレッド構文を使わず安全にループで算出）
      const count = trendRows.length
      let total = 0
      let minPrice = count > 0 ? trendRows[0].amount : 0
      let maxPrice = count > 0 ? trendRows[0].amount : 0

      for (const r of trendRows) {
        total += r.amount
        if (r.amount < minPrice) minPrice = r.amount
        if (r.amount > maxPrice) maxPrice = r.amount
      }

      const averagePrice = count > 0 ? Math.round(total / count) : 0
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
