<script setup>
import { ref, onMounted, watch } from 'vue'
import { fetchCategories, fetchFixedCostMatrix, updateFixedCostCell } from '../api'

const year = ref(new Date().getFullYear())
const categories = ref([])
const matrix = ref({}) // { '01': { 601: 5000, 604: 80000 }, ... }
const months = Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0'))

// Target categories (Fixed Cost specific)
const FIXED_CODES = [604, 601, 603, 606, 602, 605, 607, 901, 608]

const loadData = async () => {
    try {
        // Fetch categories first if empty
        if (categories.value.length === 0) {
            const catRes = await fetchCategories()
            categories.value = catRes.data.filter(c => FIXED_CODES.includes(c.code))
        }

        const res = await fetchFixedCostMatrix(year.value)
        
        // Transform to matrix
        const map = {}
        months.forEach(m => map[m] = {})
        
        res.data.forEach(item => {
            const m = item.fiscal_month.split('-')[1]
            if (map[m]) {
                map[m][item.category_code] = item.amount
            }
        })
        matrix.value = map
    } catch(e) {
        console.error(e)
    }
}

onMounted(loadData)
watch(year, loadData)

// Handling Input
const saving = ref(false)

const onInput = async (month, code, event) => {
    const val = event.target.value
    // Debounce or just save on blur? Save on blur is safer for now.
}

const onBlur = async (month, code, event) => {
    const val = event.target.value
    const currentVal = matrix.value[month][code]

    // If value changed (comparing with string linkage)
    if (String(currentVal || '') === String(val)) return

    saving.value = true
    try {
        await updateFixedCostCell({
            year: year.value,
            month: Number(month),
            category_code: code,
            amount: val
        })
        // Update local state
        matrix.value[month][code] = val ? Number(val) : 0
    } catch(e) {
        alert('保存に失敗しました')
        console.error(e)
    } finally {
        saving.value = false
    }
}

// Calculations
const getMonthTotal = (month) => {
    const row = matrix.value[month]
    if (!row) return 0
    return Object.values(row).reduce((sum, v) => sum + (Number(v) || 0), 0)
}

const getCategoryTotal = (code) => {
    let sum = 0
    months.forEach(m => {
        if (matrix.value[m]) {
            sum += (Number(matrix.value[m][code]) || 0)
        }
    })
    return sum
}

const getGrandTotal = () => {
    let sum = 0
    months.forEach(m => {
        sum += getMonthTotal(m)
    })
    return sum
}
</script>

<template>
  <div class="animate-fade-in">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-700">固定費・公共料金入力</h2>
        <div class="flex items-center space-x-4 bg-white p-2 rounded shadow">
            <button @click="year--" class="px-3 py-1 hover:bg-gray-100 rounded text-gray-600">◀</button>
            <span class="text-xl font-bold font-mono">{{ year }}年</span>
            <button @click="year++" class="px-3 py-1 hover:bg-gray-100 rounded text-gray-600">▶</button>
        </div>
    </div>

    <div class="bg-white rounded shadow overflow-x-auto">
        <table class="w-full text-sm border-collapse">
            <thead class="bg-gray-100 text-gray-600">
                <tr>
                    <th class="p-2 border bg-gray-100 sticky left-0 z-10 w-20">月</th>
                    <th v-for="cat in categories" :key="cat.code" class="p-2 border min-w-[100px] font-bold">
                        {{ cat.name }}
                    </th>
                    <th class="p-2 border bg-yellow-50 font-bold min-w-[100px]">合計</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="m in months" :key="m" class="hover:bg-gray-50">
                    <td class="p-2 border font-bold text-center sticky left-0 bg-gray-50 z-10">{{ Number(m) }}月</td>
                    <td v-for="cat in categories" :key="cat.code" class="p-0 border relative group">
                        <input 
                            type="number" 
                            :value="matrix[m]?.[cat.code]" 
                            @blur="onBlur(m, cat.code, $event)"
                            @keydown.enter="$event.target.blur()"
                            placeholder="-"
                            class="w-full h-full p-2 text-right focus:bg-blue-50 focus:outline-none bg-transparent transition"
                        />
                        <!-- Hover helper to see what cell this is -->
                        <div class="hidden group-hover:block absolute -top-8 left-0 bg-black text-white text-xs p-1 rounded whitespace-nowrap z-20">
                            {{ Number(m) }}月 - {{ cat.name }}
                        </div>
                    </td>
                    <td class="p-2 border text-right font-mono font-bold bg-yellow-50 text-gray-700">
                        ¥{{ getMonthTotal(m).toLocaleString() }}
                    </td>
                </tr>
                <!-- Total Row -->
                <tr class="bg-yellow-100 font-bold border-t-2 border-yellow-200">
                    <td class="p-2 border text-center sticky left-0 bg-yellow-100 z-10">年計</td>
                    <td v-for="cat in categories" :key="cat.code" class="p-2 border text-right font-mono">
                        ¥{{ getCategoryTotal(cat.code).toLocaleString() }}
                    </td>
                    <td class="p-2 border text-right font-mono text-blue-900">
                        ¥{{ getGrandTotal().toLocaleString() }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    
    <div class="mt-2 text-right text-xs text-gray-500">
        ※ 金額を入力してフォーカスを外すと自動保存されます。保存中: {{ saving ? '...' : '完了' }}
    </div>
  </div>
</template>
