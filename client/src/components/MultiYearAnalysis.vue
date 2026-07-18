<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { fetchMultiYearAnalysis } from '../api'
import { Line, Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, Title, Tooltip, Legend, Colors } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, Title, Tooltip, Legend, Colors)

const currentYear = new Date().getFullYear()

const fromYear = ref(currentYear - 2)
const toYear = ref(currentYear)
const analysisData = ref(null)
const visibleGroups = ref(new Set())
const visibleCategories = ref(new Set())
const seenGroups = ref(new Set())
const seenCategories = ref(new Set())
const colors = ['#41B883', '#E46651', '#00D8FF', '#DD1B16', '#FFCE56', '#8e44ad', '#3498db', '#95a5a6', '#f39c12', '#16a085']
const getDatasetColor = (index) => colors[index % colors.length]

const yearOptions = computed(() => {
    const years = []
    for (let y = currentYear - 10; y <= currentYear + 1; y++) {
        years.push(y)
    }
    return years
})

// Keep fromYear <= toYear whichever side the user changes
watch(fromYear, (val) => {
    if (toYear.value < val) toYear.value = val
})
watch(toYear, (val) => {
    if (fromYear.value > val) fromYear.value = val
})

const applyPreset = (span) => {
    toYear.value = currentYear
    fromYear.value = currentYear - (span - 1)
}

const loadData = async () => {
    try {
        analysisData.value = await fetchMultiYearAnalysis(fromYear.value, toYear.value)

        // 未知の名前だけ ON にする差分マージ（年範囲変更で新登場したものはデフォルト表示、既存のトグル状態は保持）
        analysisData.value.groups?.forEach(g => {
            if (!seenGroups.value.has(g.name)) {
                visibleGroups.value.add(g.name)
                seenGroups.value.add(g.name)
            }
        })
        analysisData.value.categories?.forEach(c => {
            if (!seenCategories.value.has(c.name)) {
                visibleCategories.value.add(c.name)
                seenCategories.value.add(c.name)
            }
        })
    } catch (e) {
        console.error(e)
    }
}

onMounted(loadData)
watch([fromYear, toYear], loadData)

const currentYearIndex = computed(() => {
    if (!analysisData.value) return -1
    return analysisData.value.years.indexOf(analysisData.value.current_fiscal_year)
})

const hasNoData = computed(() => {
    if (!analysisData.value) return false
    return analysisData.value.groups.length === 0 && analysisData.value.categories.length === 0
})

// Replace the current year's actual value with the projected annual total (or null if unavailable),
// so the line breaks/dashes into the projection instead of dropping to a partial-year actual.
const buildProjectedLineData = (actual, projected, idx) => {
    const data = actual.slice()
    if (idx !== -1 && projected) {
        data[idx] = projected[idx]
    }
    return data
}

const segmentDashOptions = computed(() => {
    const idx = currentYearIndex.value
    return {
        borderDash: ctx => ctx.p1DataIndex === idx ? [6, 6] : undefined
    }
})

// 当年のドットだけ形・サイズを変えて「予測含み」であることを視覚的に区別する
const currentYearPointStyle = (idx) => ({
    pointStyle: ctx => ctx.dataIndex === idx ? 'rectRot' : 'circle',
    pointRadius: ctx => ctx.dataIndex === idx ? 7 : 3,
    pointBorderWidth: ctx => ctx.dataIndex === idx ? 2 : 1
})

const summaryChartData = computed(() => {
    if (!analysisData.value) return { labels: [], datasets: [] }
    const { years, summary } = analysisData.value
    const idx = currentYearIndex.value
    const segment = segmentDashOptions.value

    return {
        labels: years.map(y => y + '年'),
        datasets: [
            {
                label: '収入',
                data: buildProjectedLineData(summary.income, summary.income_projected, idx),
                tension: 0.2,
                borderColor: '#41B883',
                backgroundColor: '#41B883',
                segment,
                ...currentYearPointStyle(idx)
            },
            {
                label: '支出',
                data: buildProjectedLineData(summary.expense, summary.expense_projected, idx),
                tension: 0.2,
                borderColor: '#E46651',
                backgroundColor: '#E46651',
                segment,
                ...currentYearPointStyle(idx)
            },
            {
                label: '収支',
                data: buildProjectedLineData(summary.balance, summary.balance_projected, idx),
                tension: 0.2,
                borderColor: '#2c3e50',
                backgroundColor: '#2c3e50',
                segment,
                ...currentYearPointStyle(idx)
            }
        ]
    }
})

const barChartData = computed(() => {
    if (!analysisData.value) return { labels: [], datasets: [] }
    const { years, groups } = analysisData.value

    return {
        labels: years.map(y => y + '年'),
        datasets: groups
            .map((g, i) => ({ g, i }))
            .filter(({ g }) => visibleGroups.value.has(g.name))
            .map(({ g, i }) => ({
                label: g.name,
                data: g.data,
                backgroundColor: getDatasetColor(i),
                borderColor: getDatasetColor(i)
            }))
    }
})

const categoryChartData = computed(() => {
    if (!analysisData.value) return { labels: [], datasets: [] }
    const { years, categories } = analysisData.value
    const idx = currentYearIndex.value
    const segment = segmentDashOptions.value

    return {
        labels: years.map(y => y + '年'),
        datasets: categories
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => visibleCategories.value.has(c.name))
            .map(({ c, i }) => ({
                label: c.name,
                data: buildProjectedLineData(c.data, c.projected, idx),
                tension: 0.2,
                borderColor: getDatasetColor(i),
                backgroundColor: getDatasetColor(i),
                segment,
                ...currentYearPointStyle(idx)
            }))
    }
})

const toggleGroup = (name) => {
    if (visibleGroups.value.has(name)) {
        visibleGroups.value.delete(name)
    } else {
        visibleGroups.value.add(name)
    }
}

const toggleCategory = (name) => {
    if (visibleCategories.value.has(name)) {
        visibleCategories.value.delete(name)
    } else {
        visibleCategories.value.add(name)
    }
}

const chartOptions = computed(() => {
    const idx = currentYearIndex.value
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            tooltip: {
                callbacks: {
                    label: ctx => {
                        let label = ctx.dataset.label ? `${ctx.dataset.label}: ${ctx.formattedValue}` : ctx.formattedValue
                        if (ctx.dataIndex === idx) label += '（予測含む）'
                        return label
                    }
                }
            }
        }
    }
})

const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        mode: 'index',
        intersect: false,
    },
    scales: {
        x: { stacked: true },
        y: { stacked: true }
    }
}

// Amount used in group/category rows: 0 reads as "no data that year", shown as dash
const formatAmount = (amt) => amt !== 0 ? `¥${amt.toLocaleString()}` : '-'

// Amount used in totals/summary rows: null (future year, unpredictable) reads as dash, 0 is shown as-is
const formatPlainAmount = (amt) => amt === null || amt === undefined ? '-' : `¥${amt.toLocaleString()}`

const formatCurrentYearCell = (actual, projected, formatter = formatPlainAmount) => {
    if (projected === null || projected === undefined) {
        return `${formatter(actual)} (予測不可)`
    }
    return `${formatter(actual)} (予想: ${formatPlainAmount(projected)})`
}

const balanceCellClass = (amt) => amt !== null && amt >= 0 ? 'text-black' : 'text-red-600'
</script>

<template>
  <div class="animate-fade-in">
       <!-- Header/Selector -->
       <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
           <h2 class="text-xl font-bold text-gray-700">複数年比較分析</h2>
           <div class="flex flex-wrap items-center gap-2">
               <div class="flex items-center space-x-2 bg-white p-2 rounded shadow">
                   <select v-model="fromYear" class="font-bold font-mono border-none bg-transparent cursor-pointer focus:ring-0 appearance-none text-center">
                       <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
                   </select>
                   <span class="text-gray-400">〜</span>
                   <select v-model="toYear" class="font-bold font-mono border-none bg-transparent cursor-pointer focus:ring-0 appearance-none text-center">
                       <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
                   </select>
               </div>
               <div class="flex items-center space-x-1">
                   <button @click="applyPreset(3)" class="px-2 py-1 text-xs rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-100">直近3年</button>
                   <button @click="applyPreset(5)" class="px-2 py-1 text-xs rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-100">直近5年</button>
                   <button @click="applyPreset(10)" class="px-2 py-1 text-xs rounded border bg-white text-gray-600 border-gray-300 hover:bg-gray-100">直近10年</button>
               </div>
           </div>
       </div>

       <!-- Summary Chart -->
       <div class="bg-white p-4 rounded shadow mb-6 h-96">
            <h3 class="text-sm text-gray-500 mb-2">収支サマリ推移</h3>
            <div class="h-80">
                <Line v-if="analysisData" :data="summaryChartData" :options="chartOptions" />
                <div v-else class="h-full flex items-center justify-center text-gray-400">Loading...</div>
            </div>
            <p class="text-xs text-gray-400 mt-1">点線区間と当年のドットは同月平均補完による予測を含みます</p>
       </div>

       <template v-if="analysisData">
           <div v-if="hasNoData" class="bg-white p-4 rounded shadow text-center text-gray-400 mb-8">
               データがありません
           </div>
           <template v-else>
               <!-- Group Chart -->
               <div class="bg-white p-4 rounded shadow mb-6">
                    <h3 class="text-sm text-gray-500 mb-2">グループ別支出推移</h3>

                    <!-- Toggles -->
                    <div class="flex flex-wrap gap-2 mb-4">
                        <button
                            v-for="(g, i) in analysisData.groups"
                            :key="g.name"
                            @click="toggleGroup(g.name)"
                            class="px-2 py-1 text-xs rounded border flex items-center gap-1 transition select-none"
                            :class="visibleGroups.has(g.name) ? 'bg-gray-100 text-gray-800 border-gray-300' : 'bg-white text-gray-400 border-dashed'">
                            <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: visibleGroups.has(g.name) ? getDatasetColor(i) : '#ccc' }"></span>
                            {{ g.name }}
                            <span v-if="!visibleGroups.has(g.name)" class="text-[10px]">(非表示)</span>
                        </button>
                    </div>

                    <div class="h-80">
                        <Bar :data="barChartData" :options="barChartOptions" />
                    </div>
               </div>

               <!-- Category Chart -->
               <div class="bg-white p-4 rounded shadow mb-6">
                    <h3 class="text-sm text-gray-500 mb-2">カテゴリ別支出推移</h3>

                    <!-- Toggles -->
                    <div class="flex flex-wrap gap-2 mb-4">
                        <button
                            v-for="(c, i) in analysisData.categories"
                            :key="c.name"
                            @click="toggleCategory(c.name)"
                            class="px-2 py-1 text-xs rounded border flex items-center gap-1 transition select-none"
                            :class="visibleCategories.has(c.name) ? 'bg-gray-100 text-gray-800 border-gray-300' : 'bg-white text-gray-400 border-dashed'">
                            <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: visibleCategories.has(c.name) ? getDatasetColor(i) : '#ccc' }"></span>
                            {{ c.name }}
                            <span v-if="!visibleCategories.has(c.name)" class="text-[10px]">(非表示)</span>
                        </button>
                    </div>

                    <div class="h-80">
                        <Line :data="categoryChartData" :options="chartOptions" />
                    </div>
                    <p class="text-xs text-gray-400 mt-1">点線区間と当年のドットは同月平均補完による予測を含みます</p>
               </div>

               <!-- Summary Table -->
               <div class="bg-white p-4 rounded shadow overflow-x-auto">
                    <h3 class="text-sm text-gray-500 mb-2">集計表 (円)</h3>
                    <table class="w-full text-left text-sm border-collapse">
                        <thead class="bg-gray-100 text-gray-600 whitespace-nowrap">
                            <tr>
                                <th class="p-2 border font-bold sticky left-0 bg-gray-100 z-10">費目グループ</th>
                                <th class="p-2 border text-right font-bold bg-yellow-50">合計</th>
                                <th v-for="y in analysisData.years" :key="y" class="p-2 border text-center min-w-[130px]">
                                    {{ y }}年
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="g in analysisData.groups" :key="g.name" class="border-b hover:bg-gray-50">
                                <td class="p-2 border font-bold text-gray-700 sticky left-0 bg-white z-10 shadow-sm">{{ g.name }}</td>
                                <td class="p-2 border text-right font-bold font-mono bg-yellow-50">
                                    {{ formatAmount(g.total) }}
                                </td>
                                <td v-for="(y, i) in analysisData.years" :key="y" class="p-2 border text-right font-mono text-gray-600">
                                    <template v-if="i === currentYearIndex">{{ formatCurrentYearCell(g.data[i], g.projected[i], formatAmount) }}</template>
                                    <template v-else>{{ formatAmount(g.data[i]) }}</template>
                                </td>
                            </tr>
                        </tbody>
                        <tfoot v-if="analysisData.summary" class="bg-gray-50 border-t-2 border-gray-300">
                            <!-- Income Total -->
                            <tr class="hover:bg-blue-50 text-blue-800">
                                <td class="p-2 border font-bold sticky left-0 bg-blue-50 z-10 shadow-sm">収入合算</td>
                                <td class="p-2 border text-right font-bold font-mono bg-blue-100">
                                    {{ formatPlainAmount(analysisData.summary.total_income) }}
                                </td>
                                <td v-for="(y, i) in analysisData.years" :key="'inc-'+y" class="p-2 border text-right font-mono">
                                    <template v-if="i === currentYearIndex">{{ formatCurrentYearCell(analysisData.summary.income[i], analysisData.summary.income_projected[i]) }}</template>
                                    <template v-else>{{ formatPlainAmount(analysisData.summary.income[i]) }}</template>
                                </td>
                            </tr>
                            <!-- Expense Total -->
                            <tr class="hover:bg-red-50 text-red-800">
                                <td class="p-2 border font-bold sticky left-0 bg-red-50 z-10 shadow-sm">支出合算</td>
                                <td class="p-2 border text-right font-bold font-mono bg-red-100">
                                    {{ formatPlainAmount(analysisData.summary.total_expense) }}
                                </td>
                                <td v-for="(y, i) in analysisData.years" :key="'exp-'+y" class="p-2 border text-right font-mono">
                                    <template v-if="i === currentYearIndex">{{ formatCurrentYearCell(analysisData.summary.expense[i], analysisData.summary.expense_projected[i]) }}</template>
                                    <template v-else>{{ formatPlainAmount(analysisData.summary.expense[i]) }}</template>
                                </td>
                            </tr>
                            <!-- Balance -->
                            <tr class="hover:bg-yellow-50 font-bold border-t-2 border-gray-400">
                                <td class="p-2 border sticky left-0 z-10 shadow-sm" :class="analysisData.summary.total_balance >= 0 ? 'bg-white text-black' : 'bg-red-50 text-red-600'">収支</td>
                                <td class="p-2 border text-right font-mono text-lg bg-yellow-100" :class="analysisData.summary.total_balance >= 0 ? 'text-black' : 'text-red-600'">
                                    {{ formatPlainAmount(analysisData.summary.total_balance) }}
                                </td>
                                <td v-for="(y, i) in analysisData.years" :key="'bal-'+y" class="p-2 border text-right font-mono" :class="balanceCellClass(analysisData.summary.balance[i])">
                                    <template v-if="i === currentYearIndex">{{ formatCurrentYearCell(analysisData.summary.balance[i], analysisData.summary.balance_projected[i]) }}</template>
                                    <template v-else>{{ formatPlainAmount(analysisData.summary.balance[i]) }}</template>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
               </div>
           </template>
       </template>
  </div>
</template>
