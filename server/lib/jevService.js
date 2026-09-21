const { TypeSafeClient, noul } = require('@typesafe-ai/sdk')

// Jevの判定結果をキャッシュするインメモリマップ (key: `${keyword}:${itemName}`)
const judgmentCache = new Map()

/**
 * カタカナをひらがなに変換
 */
function katakanaToHiragana(src) {
  return src.replace(/[\u30a1-\u30f6]/g, (match) => {
    const chr = match.charCodeAt(0) - 0x60
    return String.fromCharCode(chr)
  })
}

/**
 * ひらがなをカタカナに変換
 */
function hiraganaToKatakana(src) {
  return src.replace(/[\u3041-\u3096]/g, (match) => {
    const chr = match.charCodeAt(0) + 0x60
    return String.fromCharCode(chr)
  })
}

/**
 * 文字列の全角半角正規化と小文字化
 */
function normalizeText(text) {
  if (!text) return ''
  return text.normalize('NFKC').toLowerCase().trim()
}

/**
 * Jev API キーが設定されているかどうか
 */
function isJevConfigured() {
  return Boolean(process.env.TYPESAFE_API_KEY && process.env.TYPESAFE_API_KEY.trim())
}

/**
 * 簡易部分一致・正規化によるフォールバック判定
 */
function simpleMatch(itemName, keyword) {
  if (!itemName || !keyword) return false
  const normItem = normalizeText(itemName)
  const normKeyword = normalizeText(keyword)

  // 1. そのまま部分一致
  if (normItem.includes(normKeyword)) return true

  // 2. ひらがな・カタカナ変換後の部分一致
  const itemHira = katakanaToHiragana(normItem)
  const kwHira = katakanaToHiragana(normKeyword)
  if (itemHira.includes(kwHira)) return true

  const itemKata = hiraganaToKatakana(normItem)
  const kwKata = hiraganaToKatakana(normKeyword)
  if (itemKata.includes(kwKata)) return true

  return false
}

/**
 * Jev (TypeSafe AI) または フォールバックで、品名リストが対象キーワードに該当するかを判定する
 * @param {string[]} itemNames - ユニークな品名リスト
 * @param {string} keyword - 検索キーワード（例: "納豆"）
 * @param {boolean} forceSimple - Jevを使わず部分一致のみにするか
 * @returns {Promise<Map<string, { isMatch: boolean, confidence: number, source: 'jev' | 'fallback' }>>}
 */
async function judgeItems(itemNames, keyword, forceSimple = false) {
  const results = new Map()
  const canUseJev = !forceSimple && isJevConfigured()

  let client = null
  if (canUseJev) {
    try {
      client = new TypeSafeClient({
        apiKey: process.env.TYPESAFE_API_KEY.trim(),
      })
    } catch (e) {
      console.warn('[JevService] Failed to initialize TypeSafeClient:', e.message)
    }
  }

  const itemsToQuery = []

  for (const name of itemNames) {
    const cacheKey = `${keyword.trim().toLowerCase()}:${name}`
    if (judgmentCache.has(cacheKey)) {
      results.set(name, judgmentCache.get(cacheKey))
    } else if (!canUseJev || !client) {
      // Jevが使えない場合は部分一致フォールバック
      const matched = simpleMatch(name, keyword)
      const judgment = {
        isMatch: matched,
        confidence: matched ? 100 : 0,
        source: 'fallback',
      }
      judgmentCache.set(cacheKey, judgment)
      results.set(name, judgment)
    } else {
      itemsToQuery.push(name)
    }
  }

  if (itemsToQuery.length > 0 && client) {
    // 並列バッチでJevに問い合わせる（同時実行数を最大10に制御）
    const BATCH_SIZE = 10
    for (let i = 0; i < itemsToQuery.length; i += BATCH_SIZE) {
      const batch = itemsToQuery.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (itemName) => {
          const cacheKey = `${keyword.trim().toLowerCase()}:${itemName}`
          try {
            const response = await client.systemOne({
              state: {
                item_name: itemName,
                target_keyword: keyword,
              },
              questions: {
                is_match: noul(
                  `Does the grocery or purchase item named "${itemName}" represent, contain, or belong to "${keyword}"?`
                ),
              },
            })

            // noul は 0.0 - 1.0 の確率（Yes rate）
            const probability = response.answers?.is_match?.noul ?? 0
            const isMatch = probability >= 0.5
            const confidence = Math.round(probability * 100)

            const judgment = {
              isMatch,
              confidence,
              source: 'jev',
            }
            judgmentCache.set(cacheKey, judgment)
            results.set(itemName, judgment)
          } catch (err) {
            console.warn(`[JevService] Error evaluating "${itemName}":`, err.message)
            // 個別エラー時は部分一致でフォールバック
            const matched = simpleMatch(itemName, keyword)
            const judgment = {
              isMatch: matched,
              confidence: matched ? 80 : 0,
              source: 'fallback',
            }
            judgmentCache.set(cacheKey, judgment)
            results.set(itemName, judgment)
          }
        })
      )
    }
  }

  return results
}

module.exports = {
  isJevConfigured,
  simpleMatch,
  judgeItems,
  judgmentCache,
  katakanaToHiragana,
  hiraganaToKatakana,
}
