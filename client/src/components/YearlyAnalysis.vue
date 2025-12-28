<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { fetchYearlyAnalysis } from '../api'
import { Line } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Colors } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Colors)

const year = ref(new Date().getFullYear())
const analysisData = ref(null)
const visibleFixedCosts = ref(new Set())
const colors = ['#41B883', '#E46651', '#00D8FF', '#DD1B16', '#FFCE56', '#8e44ad', '#3498db', '#95a5a6', '#f39c12', '#16a085']
const getDatasetColor = (index) => colors[index % colors.length]

const loadData = async () => {
    try {
        analysisData.value = await fetchYearlyAnalysis(year.value)
        
        // Initialize visibility (all ON by default if empty)
        if (visibleFixedCosts.value.size === 0 && analysisData.value.fixed_cost_breakdown) {
            analysisData.value.fixed_cost_breakdown.forEach(g => visibleFixedCosts.value.add(g.name))
        }
    } catch(e) {
        console.error(e)
    }
}

onMounted(loadData)
watch(year, loadData)

const chartData = computed(() => {
    if(!analysisData.value) return { labels: [], datasets: [] }
    
    return {
        labels: analysisData.value.months.map(m => m + '月'),
        datasets: analysisData.value.groups.map((g) => ({
            label: g.name,
            data: g.data,
            tension: 0.2
        }))
    }
})

const fixedCostChartData = computed(() => {
    if(!analysisData.value || !analysisData.value.fixed_cost_breakdown) return { labels: [], datasets: [] }
    
    return {
        labels: analysisData.value.months.map(m => m + '月'),
        datasets: analysisData.value.fixed_cost_breakdown
            .filter(g => visibleFixedCosts.value.has(g.name))
            .map((g, i) => {
                // Special handling for bi-monthly Water bills (水道)
                // Convert 0 to null to connect dots (spanGaps) instead of dropping to zero
                const isBiMonthly = g.name === '水道'
                const chartData = isBiMonthly ? g.data.map(v => v === 0 ? null : v) : g.data

                return {
                    label: g.name,
                    data: chartData,
                    tension: 0.2,
                    borderColor: getDatasetColor(i),
                    backgroundColor: getDatasetColor(i),
                    spanGaps: isBiMonthly // Connect points over null values
                }
            })
    }
})

const toggleFixedCost = (name) => {
    if (visibleFixedCosts.value.has(name)) {
        visibleFixedCosts.value.delete(name)
    } else {
        visibleFixedCosts.value.add(name)
    }
}

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        mode: 'index',
        intersect: false,
    },
}
</script>

<template>
  <div class="animate-fade-in">
       <!-- Header/Selector -->
       <div class="flex items-center justify-between mb-4">
           <h2 class="text-xl font-bold text-gray-700">年次分析レポート</h2>
           <div class="flex items-center space-x-4 bg-white p-2 rounded shadow">
               <button @click="year--" class="px-3 py-1 hover:bg-gray-100 rounded text-gray-600">◀</button>
               <span class="text-xl font-bold font-mono">{{ year }}年</span>
               <button @click="year++" class="px-3 py-1 hover:bg-gray-100 rounded text-gray-600">▶</button>
           </div>
       </div>

       <!-- Main Chart -->
       <div class="bg-white p-4 rounded shadow mb-6 h-96">
            <h3 class="text-sm text-gray-500 mb-2">月次推移 (大項目別)</h3>
            <div class="h-80">
                <Line v-if="analysisData" :data="chartData" :options="chartOptions" />
                <div v-else class="h-full flex items-center justify-center text-gray-400">Loading...</div>
            </div>
       </div>

       <!-- Main Table -->
       <div class="bg-white p-4 rounded shadow overflow-x-auto mb-8">
            <h3 class="text-sm text-gray-500 mb-2">集計表 (円)</h3>
            <table class="w-full text-left text-sm border-collapse" v-if="analysisData">
                <thead class="bg-gray-100 text-gray-600 whitespace-nowrap">
                    <tr>
                        <th class="p-2 border font-bold sticky left-0 bg-gray-100 z-10">費目グループ</th>
                        <th class="p-2 border text-right font-bold bg-yellow-50">合計</th>
                        <th v-for="m in analysisData.months" :key="m" class="p-2 border text-center min-w-[60px]">
                            {{ m }}月
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="g in analysisData.groups" :key="g.name" class="border-b hover:bg-gray-50">
                        <td class="p-2 border font-bold text-gray-700 sticky left-0 bg-white z-10 shadow-sm">{{ g.name }}</td>
                        <td class="p-2 border text-right font-bold font-mono bg-yellow-50">
                            {{ g.total.toLocaleString() }}
                        </td>
                        <td v-for="(amt, i) in g.data" :key="i" class="p-2 border text-right font-mono text-gray-600">
                            {{ amt > 0 ? amt.toLocaleString() : '-' }}
                        </td>
                    </tr>
                </tbody>
            </table>
       </div>

       <!-- Fixed Cost Analysis -->
        <h2 class="text-xl font-bold text-gray-700 mb-4">固定費の詳細分析</h2>

       <!-- Fixed Cost Chart -->
       <div class="bg-white p-4 rounded shadow mb-6">
            <h3 class="text-sm text-gray-500 mb-2">固定費 内訳推移</h3>
            
            <!-- Toggles -->
             <div class="flex flex-wrap gap-2 mb-4" v-if="analysisData && analysisData.fixed_cost_breakdown">
                <button 
                    v-for="(g, i) in analysisData.fixed_cost_breakdown" 
                    :key="g.name"
                    @click="toggleFixedCost(g.name)"
                    class="px-2 py-1 text-xs rounded border flex items-center gap-1 transition select-none"
                    :class="visibleFixedCosts.has(g.name) ? 'bg-gray-100 text-gray-800 border-gray-300' : 'bg-white text-gray-400 border-dashed'">
                    <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: visibleFixedCosts.has(g.name) ? getDatasetColor(i) : '#ccc' }"></span>
                    {{ g.name }}
                    <span v-if="!visibleFixedCosts.has(g.name)" class="text-[10px]">(非表示)</span>
                </button>
            </div>

            <div class="h-80">
                <Line v-if="analysisData && fixedCostChartData" :data="fixedCostChartData" :options="chartOptions" />
            </div>
       </div>

       <!-- Fixed Cost Table -->
       <div class="bg-white p-4 rounded shadow overflow-x-auto">
            <h3 class="text-sm text-gray-500 mb-2">固定費 内訳表 (円)</h3>
            <table class="w-full text-left text-sm border-collapse" v-if="analysisData">
                <thead class="bg-gray-100 text-gray-600 whitespace-nowrap">
                    <tr>
                        <th class="p-2 border font-bold sticky left-0 bg-gray-100 z-10">内訳</th>
                        <th class="p-2 border text-right font-bold bg-yellow-50">合計</th>
                        <th v-for="m in analysisData.months" :key="m" class="p-2 border text-center min-w-[60px]">
                            {{ m }}月
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="g in analysisData.fixed_cost_breakdown" :key="g.name" class="border-b hover:bg-gray-50">
                        <td class="p-2 border font-bold text-gray-700 sticky left-0 bg-white z-10 shadow-sm">{{ g.name }}</td>
                        <td class="p-2 border text-right font-bold font-mono bg-yellow-50">
                            {{ g.total.toLocaleString() }}
                        </td>
                        <td v-for="(amt, i) in g.data" :key="i" class="p-2 border text-right font-mono text-gray-600">
                            {{ amt > 0 ? amt.toLocaleString() : '-' }}
                        </td>
                    </tr>
                </tbody>
            </table>
       </div>
  </div>
</template>
