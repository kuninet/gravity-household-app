<script setup>
import { Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { getCategoryPaletteKeyByName, getCategoryColor } from '../utils'

ChartJS.register(ArcElement, Tooltip, Legend)

const props = defineProps({
  data: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
})

// ダーク切替に追従して色を再計算するためのバンプカウンタ。
// html.dark クラスの変化を MutationObserver で検知して更新。
const themeBump = ref(0)
let observer = null
onMounted(() => {
  observer = new MutationObserver(() => { themeBump.value++ })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => observer?.disconnect())

const positiveData = computed(() => props.data.filter(d => d.total > 0))
const nonPositiveData = computed(() => props.data.filter(d => d.total <= 0))

const enriched = computed(() => {
  themeBump.value // eslint-disable-line no-unused-expressions
  return positiveData.value.map(d => {
    const key = getCategoryPaletteKeyByName(d.group_name)
    return { ...d, paletteKey: key, color: getCategoryColor(key) }
  })
})

const displayTotal = computed(() => {
  if (props.total && props.total > 0) return props.total
  return enriched.value.reduce((s, d) => s + d.total, 0)
})

const surfaceColor = computed(() => {
  themeBump.value // eslint-disable-line no-unused-expressions
  const v = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim()
  if (v) return v
  // 変数未解決時のフォールバックはテーマに合わせて出し分け（ダーク時に白ボーダーで浮かないように）
  return document.documentElement.classList.contains('dark') ? '#1c1b17' : '#ffffff'
})

const chartData = computed(() => ({
  labels: enriched.value.map(d => d.group_name),
  datasets: [
    {
      backgroundColor: enriched.value.map(d => d.color),
      borderColor: surfaceColor.value,
      borderWidth: 2,
      data: enriched.value.map(d => d.total),
    },
  ],
}))

const options = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => ` ${ctx.label}  ¥${ctx.parsed.toLocaleString()}`,
      },
    },
  },
}

const pct = (v) => displayTotal.value === 0 ? '0%' : `${((v / displayTotal.value) * 100).toFixed(1)}%`
</script>

<template>
  <div>
    <div class="relative h-40">
      <Doughnut :data="chartData" :options="options" v-if="enriched.length > 0" />
      <div v-else class="h-full flex items-center justify-center text-ink-3 text-sm">
        正の支出カテゴリがありません
      </div>
      <div v-if="enriched.length > 0" class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="text-center">
          <div class="text-[9px] tracking-[0.14em] uppercase text-ink-3 font-semibold">TOTAL</div>
          <div class="font-mono font-tabular text-[15px] font-semibold text-ink leading-tight">
            {{ displayTotal.toLocaleString() }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="enriched.length > 0" class="mt-3 text-[11px]">
      <div
        v-for="item in enriched"
        :key="item.group_name"
        class="flex items-center justify-between py-1.5 border-b border-rule-soft last:border-b-0"
      >
        <span class="flex items-center gap-2 text-ink-2">
          <i class="inline-block w-2 h-2 rounded-sm" :style="{ background: item.color }"></i>
          {{ item.group_name }}
        </span>
        <span class="flex items-baseline gap-2">
          <span class="text-ink-3 font-mono font-tabular text-[10px]">{{ pct(item.total) }}</span>
          <span class="font-mono font-tabular font-medium text-ink">{{ item.total.toLocaleString() }}</span>
        </span>
      </div>
    </div>

    <div v-if="nonPositiveData.length > 0" class="mt-3 pt-2 border-t border-rule-soft text-[10px] text-ink-3 space-y-0.5">
      <div v-for="item in nonPositiveData" :key="item.group_name" class="flex justify-between">
        <span>{{ item.group_name }}</span>
        <span class="font-mono font-tabular">¥{{ item.total.toLocaleString() }}</span>
      </div>
    </div>
  </div>
</template>
