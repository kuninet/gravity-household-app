<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { fetchCategories, fetchFixedCostMatrix, updateFixedCostCell, updateFixedCostBatch } from '../api'
import SalaryDetailModal from './SalaryDetailModal.vue'

const year = ref(new Date().getFullYear())
const availableYears = computed(() => {
    const currentYear = new Date().getFullYear()
    const maxYear = Math.max(currentYear + 1, year.value)
    const minYear = Math.min(currentYear - 10, year.value)

    const years = []
    for (let i = maxYear; i >= minYear; i--) {
        years.push(i)
    }
    return years
})
const expenseCategories = ref([])
const incomeCategories = ref([])
const matrix = ref({}) // { '01': { 601: 5000, 604: 80000 }, ... } — 給与 (700) は含めない
// 給与 (INCOME/700) のみ 1 会計月に複数明細を許容するため専用の state に持たせる。
// { '01': [{ id, amount, description }, ...], ... }
const salaryEntries = ref({})
const months = Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0'))

// Target categories (Fixed input specific)
const EXPENSE_FIXED_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608]
const SALARY_CATEGORY_CODE = 700
const INCOME_FIXED_CODES = [SALARY_CATEGORY_CODE]

// 給与カテゴリ判定 (今後 INCOME_FIXED_CODES に複数明細対応コードが増えても分岐を統一)
const isSalaryCode = (code) => Number(code) === SALARY_CATEGORY_CODE

const loadData = async () => {
    try {
        // Fetch categories first if empty (支出/収入で分離して保持)
        if (expenseCategories.value.length === 0 && incomeCategories.value.length === 0) {
            const catRes = await fetchCategories()
            // API から返る順ではなく EXPENSE_FIXED_CODES / INCOME_FIXED_CODES の並びを保つ
            const byCode = new Map(catRes.data.map(c => [c.code, c]))
            expenseCategories.value = EXPENSE_FIXED_CODES.map(code => byCode.get(code)).filter(Boolean)
            incomeCategories.value = INCOME_FIXED_CODES.map(code => byCode.get(code)).filter(Boolean)
        }

        const res = await fetchFixedCostMatrix(year.value)

        // Transform to matrix
        const map = {}
        const salaryMap = {}
        months.forEach(m => {
            map[m] = {}
            salaryMap[m] = []
        })

        res.data.forEach(item => {
            const m = item.fiscal_month.split('-')[1]
            if (!map[m]) return
            // 給与 (INCOME/700) は複数明細対応: matrix には書き込まず salaryEntries に push
            if (item.type === 'INCOME' && INCOME_FIXED_CODES.includes(Number(item.category_code))) {
                salaryMap[m].push({
                    id: item.id,
                    amount: Number(item.amount) || 0,
                    description: item.description || '',
                })
            } else {
                map[m][item.category_code] = item.amount
            }
        })

        // 表示順一貫性のため id 昇順で並べる
        months.forEach(m => {
            salaryMap[m].sort((a, b) => a.id - b.id)
        })

        matrix.value = map
        salaryEntries.value = salaryMap
    } catch(e) {
        console.error(e)
    }
}

onMounted(loadData)
watch(year, loadData)

// Handling Input
const saving = ref(false)

// 表示用フォーマッタ: 0/空/未定義は空文字にして「0 は表示しない」現行仕様を維持する
const formatAmount = (v) => {
    if (v === undefined || v === null || v === '' || v === 0) return ''
    const n = Number(v)
    if (Number.isNaN(n)) return ''
    return n.toLocaleString('ja-JP')
}

// フォーカス時はカンマを外して素の数字を編集させる
const onFocus = (month, code, event) => {
    const v = matrix.value[month]?.[code]
    event.target.value = v ? String(v) : ''
}

const onBlur = async (month, code, type, event) => {
    // 表示は "12,345" のようにカンマ入りで戻る可能性があるので、保存前に必ずカンマを除去
    const raw = String(event.target.value).replace(/,/g, '').trim()
    const currentVal = matrix.value[month][code]

    // If value changed (comparing with string linkage)
    if (String(currentVal || '') === String(raw)) {
        // 未変更でも表示はフォーマット済みに戻す (focus 時に生数字へ書き換えているため)
        event.target.value = formatAmount(currentVal)
        return
    }

    saving.value = true
    try {
        await updateFixedCostCell({
            year: year.value,
            month: Number(month),
            category_code: code,
            amount: raw,
            type,
        })
        // Update local state
        const newVal = raw ? Number(raw) : 0
        matrix.value[month][code] = newVal
        event.target.value = formatAmount(newVal)
    } catch(e) {
        alert('保存に失敗しました')
        console.error(e)
    } finally {
        saving.value = false
    }
}

// Paste Handler。type と、貼付範囲を判定するためのカテゴリ配列を明示的に受け取る。
const handlePaste = async (startMonth, startCode, type, sectionCategories, event) => {
    event.preventDefault()
    const clipboardData = event.clipboardData || window.clipboardData
    const pastedData = clipboardData.getData('Text')

    // Parse rows and cols
    const rows = pastedData.trim().split(/\r\n|\n|\r/).map(row => row.split('\t'))

    if (rows.length === 0) return

    saving.value = true

    try {
        const updates = []
        const startMonthIndex = months.indexOf(startMonth)
        const startCatIndex = sectionCategories.findIndex(c => c.code === startCode)

        if (startMonthIndex === -1 || startCatIndex === -1) return

        rows.forEach((row, rIndex) => {
            const monthIndex = startMonthIndex + rIndex
            if (monthIndex >= months.length) return

            const targetMonth = months[monthIndex]

            row.forEach((cellRaw, cIndex) => {
                const catIndex = startCatIndex + cIndex
                // セクション内のカテゴリ配列内に収まる範囲だけ貼り付ける (クロスセクションはブロック)
                if (catIndex >= sectionCategories.length) return

                const targetCode = sectionCategories[catIndex].code

                // 給与 (INCOME/700) は複数明細対応のためモーダル経由でのみ編集可能。
                // 貼り付けでは触らず、他列は既存通り上書きする。
                if (type === 'INCOME' && INCOME_FIXED_CODES.includes(targetCode)) return

                // Clean input (remove commas, yen sign etc)
                const amount = cellRaw.replace(/[^0-9]/g, '')

                if (!matrix.value[targetMonth]) matrix.value[targetMonth] = {}
                matrix.value[targetMonth][targetCode] = amount ? Number(amount) : 0

                updates.push({
                    month: Number(targetMonth),
                    category_code: targetCode,
                    amount,
                    type,
                })
            })
        })

        if (updates.length > 0) {
            await updateFixedCostBatch({
                year: year.value,
                cells: updates,
            })
        }
    } catch(e) {
        alert('一括貼り付けに失敗しました')
        console.error(e)
    } finally {
        saving.value = false
    }
}


const getCategoryTotal = (code) => {
    // 給与は matrix 上に存在しないため salaryEntries から集計
    if (isSalaryCode(code)) {
        let sum = 0
        months.forEach(m => {
            const list = salaryEntries.value[m]
            if (list) {
                for (const e of list) sum += Number(e.amount) || 0
            }
        })
        return sum
    }
    let sum = 0
    months.forEach(m => {
        if (matrix.value[m]) {
            sum += (Number(matrix.value[m][code]) || 0)
        }
    })
    return sum
}

// 特定月の給与合計 / 件数 (セル UI から使う)
const getSalaryMonthTotal = (month) => {
    const list = salaryEntries.value[month]
    if (!list) return 0
    return list.reduce((s, e) => s + (Number(e.amount) || 0), 0)
}
const getSalaryMonthCount = (month) => {
    const list = salaryEntries.value[month]
    return list ? list.length : 0
}

// 月別 (収入/支出/差引) と年計を 1 周でまとめて算出。テンプレート側は summary.* を参照する。
const summary = computed(() => {
    const income = new Array(months.length).fill(0)
    const expense = new Array(months.length).fill(0)
    const net = new Array(months.length).fill(0)
    let incomeYear = 0
    let expenseYear = 0

    months.forEach((m, i) => {
        const row = matrix.value[m]
        if (row) {
            // 将来 700 以外の INCOME 単一値が追加される場合を想定し、
            // matrix (単一値) 分と salaryEntries (複数明細) 分の両方を加算する。
            for (const code of INCOME_FIXED_CODES) {
                if (isSalaryCode(code)) continue
                income[i] += Number(row[code]) || 0
            }
            for (const code of EXPENSE_FIXED_CODES) expense[i] += Number(row[code]) || 0
        }
        // 給与 (複数明細) 分を加算
        const salaryList = salaryEntries.value[m]
        if (salaryList) {
            for (const e of salaryList) income[i] += Number(e.amount) || 0
        }
        net[i] = income[i] - expense[i]
        incomeYear += income[i]
        expenseYear += expense[i]
    })

    return {
        income,
        expense,
        net,
        incomeYear,
        expenseYear,
        netYear: incomeYear - expenseYear,
    }
})

// ---------------------------------------------------------------------------
// 給与明細モーダル state
// ---------------------------------------------------------------------------
const salaryModal = ref({
    open: false,
    month: '01',
    categoryName: '',
})

const openSalaryModal = (month, categoryName) => {
    salaryModal.value = {
        open: true,
        month,
        categoryName,
    }
}

const closeSalaryModal = () => {
    salaryModal.value.open = false
}

const onSalarySaved = (updatedEntries) => {
    const m = salaryModal.value.month
    // 親側の state を丸ごと差し替え (id 昇順で入ってくる想定だが念のためソート)
    const sorted = [...updatedEntries].sort((a, b) => a.id - b.id)
    salaryEntries.value = {
        ...salaryEntries.value,
        [m]: sorted,
    }
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-700">毎月の固定入力（収入・支出）</h2>
        <div class="flex items-center space-x-2 bg-white p-2 rounded shadow">
            <button @click="year--" class="px-3 py-1 hover:bg-gray-100 rounded text-gray-600">◀</button>
            <select v-model="year" class="text-xl font-bold font-mono border-none bg-transparent cursor-pointer focus:ring-0 appearance-none text-center">
                <option v-for="y in availableYears" :key="y" :value="y">{{ y }}年</option>
            </select>
            <button @click="year++" class="px-3 py-1 hover:bg-gray-100 rounded text-gray-600">▶</button>
        </div>
    </div>

    <!-- 収入 / 支出セクションを横並び (狭い画面では縦積みに戻す) -->
    <div class="flex flex-col md:flex-row gap-4 mb-6">
        <!-- 収入セクション: 列数が少ないので幅は内容に任せる -->
        <div class="md:flex-shrink-0">
            <h3 class="text-lg font-bold text-gray-700 mb-2">収入</h3>
            <div class="bg-white rounded shadow overflow-x-auto">
                <table class="text-sm border-collapse">
                    <thead class="bg-gray-100 text-gray-600">
                        <tr>
                            <th class="p-2 border bg-gray-100 sticky left-0 z-10 w-20">月</th>
                            <th v-for="cat in incomeCategories" :key="cat.code" class="p-2 border min-w-[120px] font-bold whitespace-nowrap">
                                {{ cat.name }}
                            </th>
                            <th class="p-2 border bg-green-50 font-bold min-w-[120px] whitespace-nowrap">収入計</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="m in months" :key="m" class="hover:bg-gray-50">
                            <td class="p-2 border font-bold text-center sticky left-0 bg-gray-50 z-10">{{ Number(m) }}月</td>
                            <td v-for="cat in incomeCategories" :key="cat.code" class="p-0 border relative group">
                                <!-- 給与セル: 複数明細のためモーダル起動ボタン (合計 + 件数) -->
                                <template v-if="isSalaryCode(cat.code)">
                                    <button
                                        type="button"
                                        @click="openSalaryModal(m, cat.name)"
                                        class="w-full h-full p-2 text-right hover:bg-blue-50 focus:bg-blue-50 focus:outline-none transition flex flex-col items-end justify-center"
                                    >
                                        <span class="font-mono">
                                            <template v-if="getSalaryMonthCount(m) > 0">
                                                ¥{{ getSalaryMonthTotal(m).toLocaleString() }}
                                            </template>
                                            <template v-else>
                                                <span class="text-gray-400">＋</span>
                                            </template>
                                        </span>
                                        <span v-if="getSalaryMonthCount(m) > 0" class="text-[10px] text-gray-500 leading-none mt-0.5">
                                            {{ getSalaryMonthCount(m) }} 件
                                        </span>
                                    </button>
                                    <div class="hidden group-hover:block absolute -top-8 left-0 bg-black text-white text-xs p-1 rounded whitespace-nowrap z-20">
                                        {{ Number(m) }}月 - {{ cat.name }} 明細を編集
                                    </div>
                                </template>
                                <template v-else>
                                    <input
                                        type="text"
                                        inputmode="numeric"
                                        :value="formatAmount(matrix[m]?.[cat.code])"
                                        @focus="onFocus(m, cat.code, $event)"
                                        @blur="onBlur(m, cat.code, 'INCOME', $event)"
                                        @paste="handlePaste(m, cat.code, 'INCOME', incomeCategories, $event)"
                                        @keydown.enter="$event.target.blur()"
                                        placeholder="-"
                                        class="w-full h-full p-2 text-right focus:bg-blue-50 focus:outline-none bg-transparent transition"
                                    />
                                    <div class="hidden group-hover:block absolute -top-8 left-0 bg-black text-white text-xs p-1 rounded whitespace-nowrap z-20">
                                        {{ Number(m) }}月 - {{ cat.name }}
                                    </div>
                                </template>
                            </td>
                            <td class="p-2 border text-right font-mono font-bold bg-green-50 text-gray-700">
                                ¥{{ summary.income[Number(m) - 1].toLocaleString() }}
                            </td>
                        </tr>
                        <tr class="bg-green-100 font-bold border-t-2 border-green-200">
                            <td class="p-2 border text-center sticky left-0 bg-green-100 z-10">年計</td>
                            <td v-for="cat in incomeCategories" :key="cat.code" class="p-2 border text-right font-mono">
                                ¥{{ getCategoryTotal(cat.code).toLocaleString() }}
                            </td>
                            <td class="p-2 border text-right font-mono text-green-900">
                                ¥{{ summary.incomeYear.toLocaleString() }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 支出セクション: 残りの幅を占有し、必要ならこちら側だけ横スクロール -->
        <div class="flex-1 min-w-0">
            <h3 class="text-lg font-bold text-gray-700 mb-2">支出</h3>
            <div class="bg-white rounded shadow overflow-x-auto">
                <table class="w-full text-sm border-collapse">
                    <thead class="bg-gray-100 text-gray-600">
                        <tr>
                            <th class="p-2 border bg-gray-100 sticky left-0 z-10 w-20">月</th>
                            <th v-for="cat in expenseCategories" :key="cat.code" class="p-2 border min-w-[100px] font-bold whitespace-nowrap">
                                {{ cat.name }}
                            </th>
                            <th class="p-2 border bg-yellow-50 font-bold min-w-[100px] whitespace-nowrap">合計</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="m in months" :key="m" class="hover:bg-gray-50">
                            <td class="p-2 border font-bold text-center sticky left-0 bg-gray-50 z-10">{{ Number(m) }}月</td>
                            <td v-for="cat in expenseCategories" :key="cat.code" class="p-0 border relative group">
                                <input
                                    type="text"
                                    inputmode="numeric"
                                    :value="formatAmount(matrix[m]?.[cat.code])"
                                    @focus="onFocus(m, cat.code, $event)"
                                    @blur="onBlur(m, cat.code, 'EXPENSE', $event)"
                                    @paste="handlePaste(m, cat.code, 'EXPENSE', expenseCategories, $event)"
                                    @keydown.enter="$event.target.blur()"
                                    placeholder="-"
                                    class="w-full h-full p-2 text-right focus:bg-blue-50 focus:outline-none bg-transparent transition"
                                />
                                <div class="hidden group-hover:block absolute -top-8 left-0 bg-black text-white text-xs p-1 rounded whitespace-nowrap z-20">
                                    {{ Number(m) }}月 - {{ cat.name }}
                                </div>
                            </td>
                            <td class="p-2 border text-right font-mono font-bold bg-yellow-50 text-gray-700">
                                ¥{{ summary.expense[Number(m) - 1].toLocaleString() }}
                            </td>
                        </tr>
                        <tr class="bg-yellow-100 font-bold border-t-2 border-yellow-200">
                            <td class="p-2 border text-center sticky left-0 bg-yellow-100 z-10">年計</td>
                            <td v-for="cat in expenseCategories" :key="cat.code" class="p-2 border text-right font-mono">
                                ¥{{ getCategoryTotal(cat.code).toLocaleString() }}
                            </td>
                            <td class="p-2 border text-right font-mono text-blue-900">
                                ¥{{ summary.expenseYear.toLocaleString() }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- 集計セクション (収入合計 / 支出合計 / 差引) -->
    <h3 class="text-lg font-bold text-gray-700 mt-6 mb-2">集計</h3>
    <div class="bg-white rounded shadow overflow-x-auto">
        <table class="w-full text-sm border-collapse">
            <thead class="bg-gray-100 text-gray-600">
                <tr>
                    <th class="p-2 border bg-gray-100 sticky left-0 z-10 w-28">項目</th>
                    <th v-for="m in months" :key="m" class="p-2 border min-w-[90px] font-bold">{{ Number(m) }}月</th>
                    <th class="p-2 border bg-yellow-50 font-bold min-w-[110px]">年計</th>
                </tr>
            </thead>
            <tbody>
                <tr class="hover:bg-gray-50">
                    <td class="p-2 border font-bold text-center sticky left-0 bg-green-50 z-10">収入合計</td>
                    <td v-for="(v, i) in summary.income" :key="`inc-${i}`" class="p-2 border text-right font-mono">
                        ¥{{ v.toLocaleString() }}
                    </td>
                    <td class="p-2 border text-right font-mono font-bold bg-green-50">
                        ¥{{ summary.incomeYear.toLocaleString() }}
                    </td>
                </tr>
                <tr class="hover:bg-gray-50">
                    <td class="p-2 border font-bold text-center sticky left-0 bg-yellow-50 z-10">支出合計</td>
                    <td v-for="(v, i) in summary.expense" :key="`exp-${i}`" class="p-2 border text-right font-mono">
                        ¥{{ v.toLocaleString() }}
                    </td>
                    <td class="p-2 border text-right font-mono font-bold bg-yellow-50">
                        ¥{{ summary.expenseYear.toLocaleString() }}
                    </td>
                </tr>
                <tr class="bg-blue-50 font-bold border-t-2 border-blue-200">
                    <td class="p-2 border text-center sticky left-0 bg-blue-100 z-10">差引</td>
                    <td
                        v-for="(v, i) in summary.net"
                        :key="`net-${i}`"
                        class="p-2 border text-right font-mono"
                        :class="v < 0 ? 'text-red-600 font-bold' : 'text-blue-900'"
                    >
                        ¥{{ v.toLocaleString() }}
                    </td>
                    <td
                        class="p-2 border text-right font-mono"
                        :class="summary.netYear < 0 ? 'text-red-600 font-bold' : 'text-blue-900 font-bold'"
                    >
                        ¥{{ summary.netYear.toLocaleString() }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="mt-2 text-right text-xs text-gray-500">
        ※ 金額を入力してフォーカスを外すと自動保存されます。保存中: {{ saving ? '...' : '完了' }} <br>
        ※ Excel等からコピー＆ペースト（複数セル）も可能です。貼り付けはセクション内 (収入 / 支出) の範囲に限られます。<br>
        ※ 給与セルは複数明細に対応しています。セルをクリックすると明細モーダルが開きます。
    </div>

    <!-- 給与明細モーダル (複数明細 CRUD) -->
    <SalaryDetailModal
        v-if="salaryModal.open"
        :year="year"
        :month="salaryModal.month"
        :category-name="salaryModal.categoryName"
        :entries="salaryEntries[salaryModal.month] || []"
        @close="closeSalaryModal"
        @saved="onSalarySaved"
    />
  </div>
</template>
