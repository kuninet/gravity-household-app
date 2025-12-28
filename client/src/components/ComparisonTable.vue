<script setup>
defineProps({
  data: {
    type: Array,
    default: () => []
  }
})
</script>

<template>
  <div class="bg-white p-4 rounded shadow overflow-hidden">
    <h3 class="text-sm text-gray-500 mb-2">前月比較 (大項目別)</h3>
    <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
            <thead class="bg-gray-100 text-gray-600">
                <tr>
                    <th class="p-2">費目グループ</th>
                    <th class="p-2 text-right">今月</th>
                    <th class="p-2 text-right">前月</th>
                    <th class="p-2 text-right">差額</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="item in data" :key="item.group" class="border-b">
                    <td class="p-2 font-bold text-gray-700">{{ item.group }}</td>
                    <td class="p-2 text-right font-mono">¥{{ item.current.toLocaleString() }}</td>
                    <td class="p-2 text-right font-mono text-gray-500">¥{{ item.prev.toLocaleString() }}</td>
                    <td class="p-2 text-right font-mono" 
                        :class="item.diff > 0 ? 'text-red-500' : (item.diff < 0 ? 'text-green-500' : 'text-gray-400')">
                        {{ item.diff > 0 ? '+' : '' }}{{ item.diff.toLocaleString() }}
                    </td>
                </tr>
                <tr v-if="data.length === 0">
                    <td colspan="4" class="p-4 text-center text-gray-400">データがありません</td>
                </tr>
            </tbody>
        </table>
    </div>
  </div>
</template>
