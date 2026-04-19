<script setup>
import { Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, Colors } from 'chart.js'

ChartJS.register(ArcElement, Tooltip, Legend, Colors)

const props = defineProps({
  data: {
    type: Array,
    default: () => []
  }
})

// Transform props data to Chart.js format
import { computed } from 'vue'

const positiveData = computed(() => props.data.filter(d => d.total > 0))

const chartData = computed(() => {
    return {
        labels: positiveData.value.map(d => d.group_name),
        datasets: [
            {
                backgroundColor: ['#41B883', '#E46651', '#00D8FF', '#DD1B16', '#FFCE56', '#8e44ad', '#3498db'],
                data: positiveData.value.map(d => d.total)
            }
        ]
    }
})

const options = {
    responsive: true,
    maintainAspectRatio: false
}
</script>

<template>
  <div class="h-64">
    <Doughnut :data="chartData" :options="options" v-if="positiveData.length > 0" />
    <div v-else class="h-full flex items-center justify-center text-gray-400">
        データがありません
    </div>
  </div>
</template>
