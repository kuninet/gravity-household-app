<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { fetchPriceTrend } from '../api'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// 検索パラメータ
const keyword = ref('納豆')
const searchMode = ref('jev') // 'jev' | 'simple'
const dateRange = ref('all') // 'all' | '1y' | '3y'

// 状態
const isLoading = ref(false)
const errorMessage = ref('')
const trendResult = ref(null)
const selectedItemNames = ref(new Set())
const sortField = ref('date') // 'date' | 'amount'
const sortOrder = ref('asc') // 'asc' | 'desc'

// ページネーション
const currentPage = ref(1)
const pageSize = 20

// ダークテーマ監視
const themeBump = ref(0)
let observer = null
onMounted(() => {
  observer = new MutationObserver(() => {
    themeBump.value++
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  // 初回検索
  doSearch()
})
onBeforeUnmount(() => observer?.disconnect())

const isDark = computed(() => {
  themeBump.value // eslint-disable-line no-unused-expressions
  return document.documentElement.classList.contains('dark')
})

const QUICK_KEYWORDS = ['納豆', '卵', '牛乳', '豆腐', 'ビール', '弁当', '食パン']

// 閏年を考慮した安全な日付計算
const dateRangeBounds = computed(() => {
  if (dateRange.value === 'all') return { from: null, to: null }
  const now = new Date()
  const years = dateRange.value === '1y' ? 1 : 3
  const targetYear = now.getFullYear() - years
  const targetMonth = now.getMonth()
  const targetDay = Math.min(now.getDate(), 28) // 閏年エッジケース安全策
  const past = new Date(targetYear, targetMonth, targetDay)

  const y = past.getFullYear()
  const m = String(past.getMonth() + 1).padStart(2, '0')
  const d = String(past.getDate()).padStart(2, '0')
  return { from: `${y}-${m}-${d}`, to: null }
})

const doSearch = async (kw = null) => {
  if (kw !== null) keyword.value = kw
  const trimmed = keyword.value.trim()
  if (!trimmed) {
    errorMessage.value = '品名キーワードを入力してください。'
    return
  }

  isLoading.value = true
  errorMessage.value = ''
  currentPage.value = 1

  try {
    const { from, to } = dateRangeBounds.value
    const res = await fetchPriceTrend({
      keyword: trimmed,
      mode: searchMode.value,
      from,
      to,
    })
    trendResult.value = res
    // すべてのマッチ品名をデフォルト選択状態にする
    selectedItemNames.value = new Set(res.matched_items.map((i) => i.name))
  } catch (err) {
    console.error(err)
    errorMessage.value = err.message || '価格推移データの取得に失敗しました。'
  } finally {
    isLoading.value = false
  }
}

// ユーザーが特定品名を除外/含めるトグル
const toggleItemName = (name) => {
  const next = new Set(selectedItemNames.value)
  if (next.has(name)) {
    if (next.size > 1) {
      next.delete(name)
    }
  } else {
    next.add(name)
  }
  selectedItemNames.value = next
  currentPage.value = 1
}

const selectAllItems = () => {
  if (!trendResult.value) return
  selectedItemNames.value = new Set(trendResult.value.matched_items.map((i) => i.name))
  currentPage.value = 1
}

// 選択中の品名のみに絞り込んだレコード一覧
const filteredRows = computed(() => {
  if (!trendResult.value || !trendResult.value.data) return []
  return trendResult.value.data.filter((r) => selectedItemNames.value.has(r.description.trim()))
})

// ソート済みレコード一覧
const sortedRows = computed(() => {
  const rows = [...filteredRows.value]
  rows.sort((a, b) => {
    let cmp = 0
    if (sortField.value === 'date') {
      cmp = a.date.localeCompare(b.date) || a.id - b.id
    } else if (sortField.value === 'amount') {
      cmp = a.amount - b.amount
    }
    return sortOrder.value === 'asc' ? cmp : -cmp
  })
  return rows
})

// ページネーション適用レコード
const totalPages = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize)))
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return sortedRows.value.slice(start, start + pageSize)
})

const toggleSort = (field) => {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortOrder.value = 'asc'
  }
}

// 選択中品名に基づいた動的サマリー（スプレッド構文を使わず安全に算出）
const dynamicSummary = computed(() => {
  const rows = filteredRows.value
  const count = rows.length
  if (count === 0) {
    return {
      count: 0,
      average_price: 0,
      min_price: 0,
      max_price: 0,
      latest_price: null,
      latest_date: null,
      price_diff: null,
    }
  }

  let total = 0
  let min = rows[0].amount
  let max = rows[0].amount
  for (const r of rows) {
    total += r.amount
    if (r.amount < min) min = r.amount
    if (r.amount > max) max = r.amount
  }
  const avg = Math.round(total / count)
  const latest = rows[rows.length - 1]
  const prev = count > 1 ? rows[rows.length - 2] : null
  const diff = latest && prev ? latest.amount - prev.amount : null

  return {
    count,
    average_price: avg,
    min_price: min,
    max_price: max,
    latest_price: latest.amount,
    latest_date: latest.date,
    price_diff: diff,
  }
})

// グラフ描画用データ
const chartData = computed(() => {
  const rows = filteredRows.value
  const labels = rows.map((r) => r.date)
  const prices = rows.map((r) => r.amount)
  const avg = dynamicSummary.value.average_price
  const avgLine = rows.map(() => avg)

  const pointColor = isDark.value ? '#38bdf8' : '#0284c7'
  const lineColor = isDark.value ? 'rgba(56, 189, 248, 0.4)' : 'rgba(2, 132, 199, 0.4)'
  const avgColor = isDark.value ? 'rgba(244, 63, 94, 0.6)' : 'rgba(225, 29, 72, 0.6)'

  return {
    labels,
    datasets: [
      {
        label: '購入価格 (円)',
        data: prices,
        borderColor: lineColor,
        backgroundColor: pointColor,
        pointBackgroundColor: pointColor,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: false,
        tension: 0.15,
      },
      {
        label: `平均価格 (${avg.toLocaleString()}円)`,
        data: avgLine,
        borderColor: avgColor,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
      },
    ],
  }
})

// グラフオプション
const chartOptions = computed(() => {
  const rows = filteredRows.value
  const textColor = isDark.value ? '#94a3b8' : '#64748b'
  const gridColor = isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: textColor,
          font: { size: 12 },
        },
      },
      tooltip: {
        callbacks: {
          title: (items) => {
            if (!items.length) return ''
            const idx = items[0].dataIndex
            const row = rows[idx]
            return row ? `${row.date} (${row.fiscal_month})` : items[0].label
          },
          label: (context) => {
            const idx = context.dataIndex
            const row = rows[idx]
            if (context.datasetIndex === 1) {
              return `平均: ${context.parsed.y.toLocaleString()} 円`
            }
            if (!row) return `${context.parsed.y} 円`
            const memoPart = row.memo ? ` [${row.memo}]` : ''
            return [
              `価格: ${row.amount.toLocaleString()} 円`,
              `品名: ${row.description}${memoPart}`,
            ]
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: textColor, maxTicksLimit: 12 },
        grid: { color: gridColor },
      },
      y: {
        ticks: {
          color: textColor,
          callback: (value) => `${value.toLocaleString()}円`,
        },
        grid: { color: gridColor },
      },
    },
  }
})

const fmt = (n) => (n ?? 0).toLocaleString()
const fmtDiff = (n) => {
  if (n === null || n === undefined) return '—'
  if (n > 0) return `+${n.toLocaleString()} 円`
  if (n < 0) return `−${Math.abs(n).toLocaleString()} 円`
  return '±0 円'
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Header & Search Controls -->
    <div class="p-5 bg-surface border border-rule rounded-xl shadow-xs space-y-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-ink flex items-center gap-2">
            <span>📈 品名価格推移分析</span>
            <span
              v-if="trendResult?.mode_used === 'jev'"
              class="px-2 py-0.5 text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md border border-emerald-500/20"
            >
              ⚡ Jev AI 判定
            </span>
            <span
              v-else-if="trendResult?.mode_used === 'fallback'"
              class="px-2 py-0.5 text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20"
            >
              部分一致 (Jev APIキー未設定)
            </span>
            <span
              v-else
              class="px-2 py-0.5 text-[11px] font-semibold bg-rule-soft text-ink-2 rounded-md"
            >
              通常部分一致
            </span>
          </h2>
          <p class="text-[12px] text-ink-3 mt-0.5">
            品名キーワードで取引明細を横断抽出し、過去の購入価格の推移と物価変動を分析します。
          </p>
        </div>

        <!-- Mode & Date Range -->
        <div class="flex items-center gap-2">
          <!-- Jev Mode Selector -->
          <div class="flex bg-rule-soft p-0.5 rounded-lg text-[12px]">
            <button
              type="button"
              @click="
                searchMode = 'jev'
                doSearch()
              "
              class="px-2.5 py-1 rounded-md transition font-medium"
              :class="
                searchMode === 'jev' ? 'bg-surface text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
              "
              title="TypeSafe AI Jevによる表記揺れ吸収スマート判定"
            >
              ⚡ Jev判定
            </button>
            <button
              type="button"
              @click="
                searchMode = 'simple'
                doSearch()
              "
              class="px-2.5 py-1 rounded-md transition font-medium"
              :class="
                searchMode === 'simple'
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-2 hover:text-ink'
              "
              title="通常のキーワード部分一致"
            >
              部分一致
            </button>
          </div>

          <!-- Date Range Selector -->
          <div class="flex bg-rule-soft p-0.5 rounded-lg text-[12px]">
            <button
              v-for="r in [
                { key: 'all', label: '全期間' },
                { key: '3y', label: '3年' },
                { key: '1y', label: '1年' },
              ]"
              :key="r.key"
              type="button"
              @click="
                dateRange = r.key
                doSearch()
              "
              class="px-2 py-1 rounded-md transition font-medium"
              :class="
                dateRange === r.key ? 'bg-surface text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
              "
            >
              {{ r.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Search Input Bar -->
      <form @submit.prevent="doSearch()" class="flex gap-2">
        <div class="relative flex-1">
          <input
            v-model="keyword"
            type="text"
            maxlength="100"
            placeholder="品名キーワードを入力（例: 納豆、牛乳、卵、豆腐、ガソリン）"
            class="w-full px-3.5 py-2 text-sm rounded-lg border border-rule bg-ground text-ink focus:outline-none focus:border-accent"
          />
          <button
            v-if="keyword"
            type="button"
            @click="keyword = ''"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink text-xs"
            aria-label="入力をクリア"
          >
            ✕
          </button>
        </div>
        <button
          type="submit"
          :disabled="isLoading"
          class="px-5 py-2 text-sm font-semibold rounded-lg bg-accent text-white hover:opacity-95 transition disabled:opacity-50 flex items-center gap-1.5"
        >
          <span v-if="isLoading" class="animate-spin text-xs">⏳</span>
          <span>検索</span>
        </button>
      </form>

      <!-- Quick Keywords -->
      <div class="flex flex-wrap items-center gap-1.5 pt-1 text-[12px]">
        <span class="text-ink-3">クイック検索:</span>
        <button
          v-for="qk in QUICK_KEYWORDS"
          :key="qk"
          type="button"
          @click="doSearch(qk)"
          class="px-2.5 py-0.5 rounded-full border border-rule text-ink-2 hover:text-ink hover:border-ink-3 transition"
          :class="
            keyword === qk ? 'bg-accent/10 border-accent text-accent font-semibold' : 'bg-surface'
          "
        >
          {{ qk }}
        </button>
      </div>

      <!-- Jev Key Notice if not configured -->
      <div
        v-if="trendResult && !trendResult.jev_configured && searchMode === 'jev'"
        class="text-[12px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20"
      >
        💡 <strong>Jev APIキー未設定</strong>:
        現在は部分一致＋表記正規化フォールバックで動作しています。<code>server/.env</code> に
        <code>TYPESAFE_API_KEY</code>
        を追加すると、Jevの機械学習モデルによる表記揺れ吸収やノイズ除外がフルに有効化されます。
      </div>
    </div>

    <!-- Error State -->
    <div
      v-if="errorMessage"
      class="p-4 bg-red-500/10 text-red-600 rounded-xl text-sm border border-red-500/20"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <!-- Empty State -->
    <div
      v-else-if="trendResult && filteredRows.length === 0"
      class="p-12 text-center bg-surface border border-rule rounded-xl space-y-3"
    >
      <div class="text-3xl">🔍</div>
      <div class="text-sm font-semibold text-ink">
        「{{ keyword }}」に一致する支出データが見つかりませんでした
      </div>
      <p class="text-xs text-ink-3 max-w-md mx-auto">
        キーワードの表記を変えるか、クイック検索の候補をお試しください。
      </p>
    </div>

    <!-- Results Area -->
    <template v-else-if="trendResult && filteredRows.length > 0">
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div class="p-3.5 bg-surface border border-rule rounded-xl">
          <div class="text-[11px] font-medium text-ink-3">平均購入単価</div>
          <div class="text-lg font-bold text-ink mt-1 font-tabular">
            {{ fmt(dynamicSummary.average_price) }} <span class="text-xs font-normal">円</span>
          </div>
          <div class="text-[10px] text-ink-3 mt-0.5">
            全 {{ dynamicSummary.count }} 回の購入平均
          </div>
        </div>

        <div class="p-3.5 bg-surface border border-rule rounded-xl">
          <div class="text-[11px] font-medium text-ink-3">最安値</div>
          <div class="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-tabular">
            {{ fmt(dynamicSummary.min_price) }} <span class="text-xs font-normal">円</span>
          </div>
          <div class="text-[10px] text-ink-3 mt-0.5">記録上の最低価格</div>
        </div>

        <div class="p-3.5 bg-surface border border-rule rounded-xl">
          <div class="text-[11px] font-medium text-ink-3">最高値</div>
          <div class="text-lg font-bold text-rose-600 dark:text-rose-400 mt-1 font-tabular">
            {{ fmt(dynamicSummary.max_price) }} <span class="text-xs font-normal">円</span>
          </div>
          <div class="text-[10px] text-ink-3 mt-0.5">記録上の最高価格</div>
        </div>

        <div class="p-3.5 bg-surface border border-rule rounded-xl">
          <div class="text-[11px] font-medium text-ink-3">直近購入価格</div>
          <div class="text-lg font-bold text-ink mt-1 font-tabular">
            {{ fmt(dynamicSummary.latest_price) }} <span class="text-xs font-normal">円</span>
          </div>
          <div class="text-[10px] text-ink-3 mt-0.5">
            {{ dynamicSummary.latest_date }}
          </div>
        </div>

        <div class="p-3.5 bg-surface border border-rule rounded-xl col-span-2 md:col-span-1">
          <div class="text-[11px] font-medium text-ink-3">前回購入時比</div>
          <div
            class="text-lg font-bold mt-1 font-tabular"
            :class="
              dynamicSummary.price_diff > 0
                ? 'text-rose-600 dark:text-rose-400'
                : dynamicSummary.price_diff < 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-ink'
            "
          >
            {{ fmtDiff(dynamicSummary.price_diff) }}
          </div>
          <div class="text-[10px] text-ink-3 mt-0.5">直近と1つ前の差額</div>
        </div>
      </div>

      <!-- Matched Items Filter (Fine-tuning Chips) -->
      <div class="p-4 bg-surface border border-rule rounded-xl space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-ink flex items-center gap-1.5">
            <span
              >🏷️ 検出された品名バリエーション ({{ trendResult.matched_items.length }} 種類)</span
            >
            <span class="text-[11px] font-normal text-ink-3">クリックで除外/再追加できます</span>
          </span>
          <button
            type="button"
            @click="selectAllItems"
            class="text-[11px] text-accent hover:underline"
          >
            すべて選択
          </button>
        </div>

        <div class="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="品名フィルター">
          <button
            v-for="item in trendResult.matched_items"
            :key="item.name"
            type="button"
            role="checkbox"
            :aria-checked="selectedItemNames.has(item.name)"
            @click="toggleItemName(item.name)"
            class="px-2.5 py-1 rounded-lg text-xs border transition flex items-center gap-1.5 cursor-pointer"
            :class="
              selectedItemNames.has(item.name)
                ? 'bg-accent/10 border-accent text-ink font-semibold'
                : 'bg-ground border-rule text-ink-3 opacity-60 line-through'
            "
          >
            <span>{{ item.name }}</span>
            <span
              class="text-[10px] px-1 py-0.2 rounded-full bg-surface border border-rule text-ink-2 font-mono"
            >
              {{ item.count }}件
            </span>
          </button>
        </div>
      </div>

      <!-- Chart Section -->
      <div class="p-5 bg-surface border border-rule rounded-xl space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-ink">📊 価格推移チャート</h3>
          <span class="text-xs text-ink-3">全 {{ filteredRows.length }} 件の推移</span>
        </div>
        <div class="h-72 w-full">
          <Line :data="chartData" :options="chartOptions" />
        </div>
      </div>

      <!-- Transaction History Table -->
      <div class="p-5 bg-surface border border-rule rounded-xl space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-ink">📝 購入明細一覧</h3>
          <span class="text-xs text-ink-3">
            全 {{ sortedRows.length }} 件中 {{ (currentPage - 1) * pageSize + 1 }}〜{{
              Math.min(currentPage * pageSize, sortedRows.length)
            }}
            件表示
          </span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left" role="table">
            <thead class="border-b border-rule text-ink-2 bg-rule-soft/50">
              <tr>
                <th
                  role="columnheader"
                  tabindex="0"
                  :aria-sort="
                    sortField === 'date'
                      ? sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  "
                  @click="toggleSort('date')"
                  @keydown.enter.prevent="toggleSort('date')"
                  @keydown.space.prevent="toggleSort('date')"
                  class="py-2.5 px-3 cursor-pointer hover:text-ink font-semibold select-none"
                >
                  日付 {{ sortField === 'date' ? (sortOrder === 'asc' ? '▲' : '▼') : '' }}
                </th>
                <th class="py-2.5 px-3 font-semibold">品名 (description)</th>
                <th
                  role="columnheader"
                  tabindex="0"
                  :aria-sort="
                    sortField === 'amount'
                      ? sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  "
                  @click="toggleSort('amount')"
                  @keydown.enter.prevent="toggleSort('amount')"
                  @keydown.space.prevent="toggleSort('amount')"
                  class="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold select-none"
                >
                  購入金額 {{ sortField === 'amount' ? (sortOrder === 'asc' ? '▲' : '▼') : '' }}
                </th>
                <th class="py-2.5 px-3 font-semibold">メモ / 店舗</th>
                <th class="py-2.5 px-3 font-semibold">カテゴリ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-rule font-tabular">
              <tr v-for="row in pagedRows" :key="row.id" class="hover:bg-ground/50 transition">
                <td class="py-2 px-3 font-mono text-ink">{{ row.date }}</td>
                <td class="py-2 px-3 text-ink font-medium">{{ row.description }}</td>
                <td class="py-2 px-3 text-right font-bold text-ink">
                  {{ fmt(row.amount) }} <span class="text-[10px] font-normal text-ink-3">円</span>
                </td>
                <td class="py-2 px-3 text-ink-2">{{ row.memo || '—' }}</td>
                <td class="py-2 px-3 text-ink-3">{{ row.category_name || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls -->
        <div v-if="totalPages > 1" class="flex items-center justify-between pt-2 text-xs">
          <button
            type="button"
            :disabled="currentPage <= 1"
            @click="currentPage--"
            class="px-3 py-1 rounded-md border border-rule text-ink-2 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ‹ 前へ
          </button>
          <span class="text-ink-3"> {{ currentPage }} / {{ totalPages }} ページ </span>
          <button
            type="button"
            :disabled="currentPage >= totalPages"
            @click="currentPage++"
            class="px-3 py-1 rounded-md border border-rule text-ink-2 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            次へ ›
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
