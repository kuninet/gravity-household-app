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

const chartData = computed(() => {
    return {
        labels: props.data.map(d => d.group_name),
        datasets: [
            {
                backgroundColor: ['#41B883', '#E46651', '#00D8FF', '#DD1B16', '#FFCE56', '#8e44ad', '#3498db'],
                data: props.data.map(d => d.total)
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
    <Doughnut :data="chartData" :options="options" v-if="data.length > 0" />
    <div v-else class="h-full flex items-center justify-center text-gray-400">
        データがありません
    </div>
  </div>
</template>
