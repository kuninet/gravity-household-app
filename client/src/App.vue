<script setup>
import { ref, onMounted, watch } from 'vue'
import { fetchTransactions, fetchCategories, fetchSummary } from './api'
import { getFiscalMonth } from './utils'
import TransactionForm from './components/TransactionForm.vue'
import TransactionList from './components/TransactionList.vue'
import CategoryChart from './components/CategoryChart.vue'
import ComparisonTable from './components/ComparisonTable.vue'
import YearlyAnalysis from './components/YearlyAnalysis.vue'
import FixedCostManager from './components/FixedCostManager.vue'
import ExcelImport from './components/ExcelImport.vue'

const currentView = ref('dashboard') // 'dashboard' | 'analysis' | 'fixed_costs' | 'import'
const transactions = ref([])
const categories = ref([])
const summary = ref({ total: { income: 0, expense: 0, balance: 0 }, by_category: [], comparison: [] })

// Current fiscal month state (Use fiscal month of TODAY as default)
const currentMonth = ref(getFiscalMonth(new Date()))

const loadData = async () => {
    try {
        const [txRes, sumRes] = await Promise.all([
            fetchTransactions(currentMonth.value), // Filter by month
            fetchSummary(currentMonth.value)
        ])
        transactions.value = txRes.data
        summary.value = sumRes
    } catch (e) {
        console.error(e)
    }
}

// Initial load of master data
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

// Reload when month changes
watch(currentMonth, () => {
    if (currentView.value === 'dashboard') loadData()
})

const changeMonth = (offset) => {
    const [y, m] = currentMonth.value.split('-').map(Number)
    const date = new Date(y, m - 1 + offset, 1)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    currentMonth.value = `${year}-${month}`
}
</script>

<template>
  <div class="min-h-screen bg-gray-100 text-gray-800 font-sans">
    <header class="bg-blue-600 text-white shadow sticky top-0 z-50">
        <div class="container mx-auto p-4">
            <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                <h1 class="text-2xl font-bold flex items-center gap-2">
                    <span>家計簿アプリ Gravity</span>
                </h1>
                
                <!-- Navigation -->
                <nav class="bg-blue-700 rounded-lg p-1 flex space-x-1">
                    <button 
                        @click="currentView = 'dashboard'"
                        class="px-4 py-2 rounded-md transition font-bold"
                        :class="currentView === 'dashboard' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-blue-600'">
                        日々の記録
                    </button>
                    <button 
                        @click="currentView = 'analysis'"
                        class="px-4 py-2 rounded-md transition font-bold"
                        :class="currentView === 'analysis' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-blue-600'">
                        年次分析
                    </button>
                    <button 
                        @click="currentView = 'fixed_costs'"
                        class="px-4 py-2 rounded-md transition font-bold"
                        :class="currentView === 'fixed_costs' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-blue-600'">
                        固定費入力
                    </button>
                    <button 
                        @click="currentView = 'import'"
                        class="px-4 py-2 rounded-md transition font-bold"
                        :class="currentView === 'import' ? 'bg-white text-blue-700 shadow' : 'text-blue-100 hover:bg-blue-600'">
                        データ管理
                    </button>
                </nav>

                <!-- Month Selector (Only for Dashboard) -->
                <div v-if="currentView === 'dashboard'" class="flex items-center space-x-2 bg-blue-700 rounded p-1">
                    <button @click="changeMonth(-1)" class="px-3 py-1 hover:bg-blue-600 rounded">←</button>
                    <span class="font-bold text-lg px-2">{{ currentMonth }}</span>
                    <button @click="changeMonth(1)" class="px-3 py-1 hover:bg-blue-600 rounded">→</button>
                </div>
            </div>
        </div>
    </header>

    <main class="container mx-auto p-4">
        <!-- Dashboard View -->
        <div v-if="currentView === 'dashboard'" class="animate-fade-in">
            <!-- Summary Cards -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <!-- Summary Cards -->
                <div class="bg-white p-4 rounded shadow">
                    <h3 class="text-sm text-gray-500">収入</h3>
                    <p class="text-2xl font-bold text-green-600">¥{{ summary.total.income.toLocaleString() }}</p>
                </div>
                <div class="bg-white p-4 rounded shadow">
                    <h3 class="text-sm text-gray-500">支出</h3>
                    <p class="text-2xl font-bold text-red-600">¥{{ summary.total.expense.toLocaleString() }}</p>
                </div>
                <div class="bg-white p-4 rounded shadow">
                    <h3 class="text-sm text-gray-500">収支差</h3>
                    <p class="text-2xl font-bold" :class="summary.total.balance >= 0 ? 'text-black' : 'text-red-600'">
                        ¥{{ summary.total.balance.toLocaleString() }}
                    </p>
                </div>
                
                <!-- Chart -->
                <div class="bg-white p-4 rounded shadow md:row-span-2 md:col-start-4">
                    <h3 class="text-sm text-gray-500 mb-2">カテゴリ別支出</h3>
                    <CategoryChart :data="summary.by_category" />
                    <div class="mt-4">
                        <ComparisonTable :data="summary.comparison" />
                    </div>
                </div>

                <!-- Transaction Form -->
                <div class="md:col-span-3">
                    <TransactionForm @transaction-added="loadData" />
                </div>
            </div>

            <div class="grid grid-cols-1 gap-6">
                <!-- List -->
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
