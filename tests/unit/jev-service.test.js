const test = require('node:test')
const assert = require('node:assert/strict')
const {
  LRUCache,
  katakanaToHiragana,
  hiraganaToKatakana,
  normalizeText,
  sanitizeForPrompt,
  simpleMatch,
} = require('../../server/lib/jevService')

test('LRUCache: 容量制限とエビクションの動作', () => {
  const cache = new LRUCache(3)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)
  assert.equal(cache.size, 3)

  // 'a' にアクセスして最近利用された状態にする
  assert.equal(cache.get('a'), 1)

  // 'd' を追加すると最も古い 'b' が削除されるはず
  cache.set('d', 4)
  assert.equal(cache.size, 3)
  assert.equal(cache.has('b'), false)
  assert.equal(cache.has('a'), true)
  assert.equal(cache.has('c'), true)
  assert.equal(cache.has('d'), true)
})

test('katakanaToHiragana & hiraganaToKatakana: カナ相互変換', () => {
  assert.equal(katakanaToHiragana('ナットウ'), 'なっとう')
  assert.equal(katakanaToHiragana('オカメナットウ 3P'), 'おかめなっとう 3P')
  assert.equal(hiraganaToKatakana('ぎゅうにゅう'), 'ギュウニュウ')
})

test('normalizeText: 全角半角および小文字化', () => {
  assert.equal(normalizeText('　納豆　'), '納豆')
  assert.equal(normalizeText('ＢＥＥＲ'), 'beer')
  assert.equal(normalizeText('１２３'), '123')
})

test('sanitizeForPrompt: 改行やクォートの無効化と文字数制限', () => {
  assert.equal(sanitizeForPrompt('納豆" OR 1=1 --'), '納豆  OR 1=1 --')
  assert.equal(sanitizeForPrompt('納豆\n改行\r行'), '納豆 改行 行')
  const longStr = 'a'.repeat(200)
  assert.equal(sanitizeForPrompt(longStr).length, 100)
})

test('simpleMatch: キーワード一致とカナ変換一致', () => {
  assert.equal(simpleMatch('おかめ納豆 3P', '納豆'), true)
  assert.equal(simpleMatch('オカメナットウ', 'なっとう'), true)
  assert.equal(simpleMatch('成分無調整牛乳', '牛乳'), true)
  assert.equal(simpleMatch('成分無調整牛乳', '納豆'), false)
})
