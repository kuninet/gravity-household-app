<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { fetchTransactions, fetchCategories, fetchSummary } from './api'
import { getFiscalMonth, getFiscalMonthRangeLabel } from './utils'
import TransactionForm from './components/TransactionForm.vue'
import TransactionList from './components/TransactionList.vue'
import CategoryChart from './components/CategoryChart.vue'
import ComparisonTable from './components/ComparisonTable.vue'
import YearlyAnalysis from './components/YearlyAnalysis.vue'
import MultiYearAnalysis from './components/MultiYearAnalysis.vue'
import FixedCostManager from './components/FixedCostManager.vue'
import ExcelImport from './components/ExcelImport.vue'

const currentView = ref('dashboard') // 'dashboard' | 'analysis' | 'multi_year_analysis' | 'fixed_costs' | 'import'
const transactions = ref([])
const categories = ref([])
const summary = ref({ total: { income: 0, expense: 0, balance: 0 }, by_category: [], comparison: [] })
const prevSummary = ref(null)

const currentMonth = ref(getFiscalMonth(new Date()))
const isDark = ref(document.documentElement.classList.contains('dark'))

const availableMonths = computed(() => {
    const today = new Date()
    const currentYear = today.getFullYear()
    const selectedYear = parseInt(currentMonth.value.split('-')[0], 10)

    const maxYear = Math.max(currentYear + 1, selectedYear)
    const minYear = Math.min(currentYear - 10, selectedYear)

    const months = []
    for (let y = maxYear; y >= minYear; y--) {
        for (let m = 12; m >= 1; m--) {
            const val = `${y}-${String(m).padStart(2, '0')}`
            months.push({ value: val, label: `${y}年${m}月` })
        }
    }
    return months
})

const rangeLabel = computed(() => getFiscalMonthRangeLabel(currentMonth.value))

const prevMonth = (fiscal) => {
    const [y, m] = fiscal.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const loadData = async () => {
    try {
        const [txRes, sumRes] = await Promise.all([
            fetchTransactions(currentMonth.value),
            fetchSummary(currentMonth.value),
        ])
        transactions.value = txRes.data
        summary.value = sumRes
    } catch (e) {
        console.error(e)
    }
    // 前月サマリは delta 表示専用。取得失敗時は前月データを nullish に戻し、
    // カードの delta 表示自体を隠す（前月 0 円として黒字ぶった振る舞いをしない）。
    try {
        prevSummary.value = await fetchSummary(prevMonth(currentMonth.value))
    } catch (e) {
        console.warn('前月サマリ取得に失敗しました。delta 表示を無効化します。', e)
        prevSummary.value = null
    }
}

onMounted(async () => {
    try {
        const res = await fetchCategories()
        categories.value = res.data
        if (currentView.value === 'dashboard') {
            await loadData()
        }
    } catch (e) {
        console.error(e)
    }
})

watch(currentMonth, () => {
    if (currentView.value === 'dashboard') loadData()
})

watch(currentView, (newView) => {
    if (newView === 'dashboard') loadData()
})

const changeMonth = (offset) => {
    const [y, m] = currentMonth.value.split('-').map(Number)
    const date = new Date(y, m - 1 + offset, 1)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    currentMonth.value = `${year}-${month}`
}

const toggleTheme = () => {
    isDark.value = !isDark.value
    document.documentElement.classList.toggle('dark', isDark.value)
    localStorage.setItem('gravity-theme', isDark.value ? 'dark' : 'light')
}

// サマリー差分（前月比 delta）。前月データ取得失敗時は null を返し、UI 側で表示を隠す。
const deltaFor = (kind) => {
    if (!prevSummary.value) return null
    const cur = summary.value.total?.[kind] ?? 0
    const prev = prevSummary.value.total?.[kind] ?? 0
    const diff = cur - prev
    const pct = prev === 0 ? null : (diff / prev) * 100
    return { diff, pct, prev }
}
const fmt = (n) => (n ?? 0).toLocaleString()
const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString()
const fmtPct = (p) => {
    if (p === null || !Number.isFinite(p)) return '—'
    const s = p >= 0 ? '+' : '−'
    return `${s}${Math.abs(p).toFixed(1)}%`
}

const NAV_ITEMS = [
    { key: 'dashboard', label: '日々の記録' },
    { key: 'analysis', label: '年次分析' },
    { key: 'multi_year_analysis', label: '複数年比較' },
    { key: 'fixed_costs', label: '固定入力' },
    { key: 'import', label: 'データ管理' },
]
</script>

<template>
  <div class="min-h-screen bg-ground text-ink">
    <header class="bg-surface border-b border-rule sticky top-0 z-50">
      <div class="max-w-screen-2xl mx-auto px-6 py-3.5">
        <div class="flex flex-col md:flex-row justify-between items-center gap-4">
          <!-- Brand -->
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-md bg-accent grid place-items-center text-white font-serif italic text-base leading-none">G</div>
            <div class="leading-tight">
              <h1 class="m-0 text-[15px] font-semibold tracking-tight text-ink">Gravity</h1>
              <div class="text-[11px] text-ink-3">家計簿</div>
            </div>
          </div>

          <!-- Nav -->
          <nav class="flex gap-0.5 p-[3px] bg-rule-soft rounded-lg">
            <button
              v-for="item in NAV_ITEMS"
              :key="item.key"
              @click="currentView = item.key"
              class="px-3 py-1.5 text-[12px] font-medium rounded-md transition"
              :class="currentView === item.key
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.04)]'
                : 'text-ink-2 hover:text-ink'"
            >
              {{ item.label }}
            </button>
          </nav>

          <!-- Right cluster: month selector + theme toggle -->
          <div class="flex items-center gap-2">
            <div v-if="currentView === 'dashboard'" class="flex items-center gap-1 pl-1.5 pr-2 py-[3px] border border-rule rounded-lg bg-surface">
              <button @click="changeMonth(-1)" class="text-ink-2 hover:text-ink px-1.5 py-0.5 rounded transition" aria-label="前の月">‹</button>
              <select
                v-model="currentMonth"
                class="font-semibold text-[12px] px-1 bg-transparent text-ink border-none cursor-pointer focus:outline-none appearance-none text-center font-tabular"
              >
                <option v-for="m in availableMonths" :key="m.value" :value="m.value" class="text-ink bg-surface">{{ m.label }}</option>
              </select>
              <button @click="changeMonth(1)" class="text-ink-2 hover:text-ink px-1.5 py-0.5 rounded transition" aria-label="次の月">›</button>
              <span class="text-[10px] text-ink-3 font-mono ml-1.5 pl-1.5 border-l border-rule">{{ rangeLabel }}</span>
            </div>
            <button
              @click="toggleTheme"
              class="w-8 h-8 grid place-items-center rounded-lg border border-rule bg-surface text-ink-2 hover:text-ink transition"
              :aria-label="isDark ? 'ライトモードに切替' : 'ダークモードに切替'"
            >
              <svg v-if="isDark" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="max-w-screen-2xl mx-auto p-6">
      <!-- Dashboard View -->
      <div v-if="currentView === 'dashboard'" class="animate-fade-in">
        <!-- Summary Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <!-- 収入 -->
          <div class="relative bg-surface border border-rule rounded-xl px-4 py-3.5">
            <h3 class="m-0 mb-1.5 text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold">収入</h3>
            <span
              v-if="deltaFor('income') && deltaFor('income').pct !== null"
              class="absolute top-3.5 right-3.5 font-mono text-[10px] px-1.5 py-[2px] rounded"
              :class="deltaFor('income').diff >= 0 ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'"
            >{{ fmtPct(deltaFor('income').pct) }}</span>
            <p class="m-0 text-[22px] font-semibold text-pos font-mono font-tabular tracking-tight leading-none">
              <span class="text-[13px] text-ink-3 font-medium mr-0.5">¥</span>{{ fmt(summary.total.income) }}
            </p>
            <div v-if="deltaFor('income')" class="mt-3 pt-2.5 border-t border-dashed border-rule flex justify-between text-[11px] text-ink-3 font-tabular">
              <span>前月 {{ fmt(deltaFor('income').prev) }}</span>
              <span>{{ fmtSigned(deltaFor('income').diff) }}</span>
            </div>
          </div>

          <!-- 支出 -->
          <div class="relative bg-surface border border-rule rounded-xl px-4 py-3.5">
            <h3 class="m-0 mb-1.5 text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold">支出</h3>
            <span
              v-if="deltaFor('expense') && deltaFor('expense').pct !== null"
              class="absolute top-3.5 right-3.5 font-mono text-[10px] px-1.5 py-[2px] rounded"
              :class="deltaFor('expense').diff <= 0 ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'"
            >{{ fmtPct(deltaFor('expense').pct) }}</span>
            <p class="m-0 text-[22px] font-semibold text-neg font-mono font-tabular tracking-tight leading-none">
              <span class="text-[13px] text-ink-3 font-medium mr-0.5">¥</span>{{ fmt(summary.total.expense) }}
            </p>
            <div v-if="deltaFor('expense')" class="mt-3 pt-2.5 border-t border-dashed border-rule flex justify-between text-[11px] text-ink-3 font-tabular">
              <span>前月 {{ fmt(deltaFor('expense').prev) }}</span>
              <span>{{ fmtSigned(deltaFor('expense').diff) }}</span>
            </div>
          </div>

          <!-- 収支差 -->
          <div class="relative bg-surface border border-rule rounded-xl px-4 py-3.5">
            <h3 class="m-0 mb-1.5 text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold">収支差</h3>
            <span
              class="absolute top-3.5 right-3.5 font-mono text-[10px] px-1.5 py-[2px] rounded"
              :class="summary.total.balance >= 0 ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'"
            >{{ summary.total.balance >= 0 ? '黒字' : '赤字' }}</span>
            <p class="m-0 text-[22px] font-semibold font-mono font-tabular tracking-tight leading-none"
              :class="summary.total.balance >= 0 ? 'text-ink' : 'text-neg'"
            >
              <span class="text-[13px] text-ink-3 font-medium mr-0.5">¥</span>{{ fmt(summary.total.balance) }}
            </p>
            <div v-if="prevSummary" class="mt-3 pt-2.5 border-t border-dashed border-rule flex justify-between text-[11px] text-ink-3 font-tabular">
              <span>前月 {{ fmt(prevSummary.total.balance) }}</span>
              <span>{{ fmtSigned(summary.total.balance - prevSummary.total.balance) }}</span>
            </div>
          </div>

          <!-- Chart (右列 2 段ぶち抜き) -->
          <div class="bg-surface border border-rule rounded-xl p-4 md:row-span-2 md:col-start-4">
            <div class="text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold mb-2">カテゴリ別支出</div>
            <CategoryChart :data="summary.by_category" :total="summary.total.expense" />
            <div class="mt-4 pt-3 border-t border-rule-soft">
              <ComparisonTable :data="summary.comparison" />
            </div>
          </div>

          <!-- Transaction Form (左 3 列) -->
          <div class="md:col-span-3">
            <TransactionForm @transaction-added="loadData" />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-6">
          <div>
            <TransactionList
              :transactions="transactions"
              :categories="categories"
              @transaction-deleted="loadData"
              @transaction-updated="loadData"
            />
          </div>
        </div>
      </div>

      <!-- Analysis View -->
      <div v-else-if="currentView === 'analysis'">
        <YearlyAnalysis />
      </div>

      <!-- Multi Year Analysis View -->
      <div v-else-if="currentView === 'multi_year_analysis'">
        <MultiYearAnalysis />
      </div>

      <!-- Fixed Costs View -->
      <div v-else-if="currentView === 'fixed_costs'">
        <FixedCostManager />
      </div>

      <!-- Import View -->
      <div v-else-if="currentView === 'import'">
        <ExcelImport />
      </div>
    </main>
  </div>
</template>
