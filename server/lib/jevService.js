const { TypeSafeClient, noul } = require('@typesafe-ai/sdk')

/**
 * 簡易 LRU キャッシュクラス
 * メモリリーク（OOM）を防止するため、最大エントリ数を超えた場合は最も古いエントリを削除
 */
class LRUCache {
  constructor(maxSize = 2000) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key) {
    if (!this.cache.has(key)) return undefined
    const val = this.cache.get(key)
    // 最近使われたものとして末尾に再配置
    this.cache.delete(key)
    this.cache.set(key, val)
    return val
  }

  set(key, val) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // 最も古いエントリ（先頭）を削除
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }
    this.cache.set(key, val)
  }

  has(key) {
    return this.cache.has(key)
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }
}

const judgmentCache = new LRUCache(2000)

// シングルトンクライアント
let singletonClient = null

function getClient() {
  if (!singletonClient && isJevConfigured()) {
    try {
      singletonClient = new TypeSafeClient({
        apiKey: process.env.TYPESAFE_API_KEY.trim(),
      })
    } catch (e) {
      console.warn('[JevService] Failed to initialize TypeSafeClient:', e.message)
      singletonClient = null
    }
  }
  return singletonClient
}

/**
 * カタカナをひらがなに変換
 */
function katakanaToHiragana(src) {
  if (!src) return ''
  return src.replace(/[\u30a1-\u30f6]/g, (match) => {
    const chr = match.charCodeAt(0) - 0x60
    return String.fromCharCode(chr)
  })
}

/**
 * ひらがなをカタカナに変換
 */
function hiraganaToKatakana(src) {
  if (!src) return ''
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
 * プロンプト注入防止用サニタイズ（改行やダブルクォートの無効化）
 */
function sanitizeForPrompt(text) {
  if (!text) return ''
  return text
    .replace(/["\r\n\\]/g, ' ')
    .trim()
    .slice(0, 100)
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
 * タイムアウト付き Promise
 */
function withTimeout(promise, timeoutMs = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])
}

/**
 * Jev (TypeSafe AI) または フォールバックで、品名リストが対象キーワードに該当するかを判定する
 * @param {string[]} itemNames - ユニークな品名リスト（最大50〜100件を推奨）
 * @param {string} keyword - 検索キーワード（例: "納豆"）
 * @param {boolean} forceSimple - Jevを使わず部分一致のみにするか
 * @returns {Promise<Map<string, { isMatch: boolean, confidence: number, source: 'jev' | 'fallback' }>>}
 */
async function judgeItems(itemNames, keyword, forceSimple = false) {
  const results = new Map()
  const canUseJev = !forceSimple && isJevConfigured()
  const client = canUseJev ? getClient() : null

  const safeKeyword = sanitizeForPrompt(keyword)
  const itemsToQuery = []

  for (const name of itemNames) {
    const cacheKey = `${safeKeyword.toLowerCase()}:${name.trim()}`
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
    // 並列バッチでJevに問い合わせる（同時実行数最大10）
    const BATCH_SIZE = 10
    for (let i = 0; i < itemsToQuery.length; i += BATCH_SIZE) {
      const batch = itemsToQuery.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (itemName) => {
          const cacheKey = `${safeKeyword.toLowerCase()}:${itemName.trim()}`
          const safeItemName = sanitizeForPrompt(itemName)

          try {
            const callPromise = client.systemOne({
              state: {
                item_name: safeItemName,
                target_keyword: safeKeyword,
              },
              questions: {
                is_match: noul(
                  `Does the grocery or purchase item named "${safeItemName}" represent, contain, or belong to "${safeKeyword}"?`
                ),
              },
            })

            const response = await withTimeout(callPromise, 5000)
            const rawNoul = response?.answers?.is_match?.noul
            const probability = typeof rawNoul === 'number' && !Number.isNaN(rawNoul) ? rawNoul : 0
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
            console.warn(`[JevService] Error or timeout evaluating "${itemName}":`, err.message)
            // 一時的エラー時は部分一致で結果を返すが、キャッシュには永続化しない（キャッシュ汚染防止）
            const matched = simpleMatch(itemName, keyword)
            results.set(itemName, {
              isMatch: matched,
              confidence: matched ? 100 : 0,
              source: 'fallback',
            })
          }
        })
      )
    }
  }

  return results
}

module.exports = {
  LRUCache,
  judgmentCache,
  isJevConfigured,
  simpleMatch,
  judgeItems,
  katakanaToHiragana,
  hiraganaToKatakana,
  normalizeText,
  sanitizeForPrompt,
  withTimeout,
}
