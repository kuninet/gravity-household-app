<script setup>
defineProps({
  data: { type: Array, default: () => [] },
})
</script>

<template>
  <div>
    <h3 class="text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold mb-2">前月比較</h3>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-[11px] font-tabular">
        <thead>
          <tr class="text-ink-3">
            <th class="px-1 py-1 whitespace-nowrap font-medium">費目</th>
            <th class="px-1 py-1 text-right font-medium">今月</th>
            <th class="px-1 py-1 text-right font-medium">前月</th>
            <th class="px-1 py-1 text-right font-medium">差額</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in data" :key="item.group" class="border-t border-rule-soft">
            <td class="px-1 py-1 font-medium text-ink whitespace-nowrap">{{ item.group }}</td>
            <td class="px-1 py-1 text-right font-mono text-ink">{{ item.current.toLocaleString() }}</td>
            <td class="px-1 py-1 text-right font-mono text-ink-3">{{ item.prev.toLocaleString() }}</td>
            <td
              class="px-1 py-1 text-right font-mono"
              :class="item.diff > 0 ? 'text-neg' : (item.diff < 0 ? 'text-pos' : 'text-ink-3')"
            >
              {{ item.diff > 0 ? '+' : '' }}{{ item.diff.toLocaleString() }}
            </td>
          </tr>
          <tr v-if="data.length === 0">
            <td colspan="4" class="py-3 text-center text-ink-3">データがありません</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
