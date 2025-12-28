<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  show: Boolean,
  categories: {
      type: Array,
      default: () => []
  },
  initialTotal: {
     type: [Number, String],
     default: ''
  },
  initialItems: {
      type: Array,
      default: () => []
  }
})

const emit = defineEmits(['close', 'apply'])

const totalAmount = ref('')
const items = ref([]) // { id, amount, taxType, category_code, description }
let nextId = 1

// Watch for show to reset or set initial values
watch(() => props.show, (newVal) => {
    if (newVal) {
        if (props.initialTotal) {
             totalAmount.value = props.initialTotal
        } else {
             totalAmount.value = ''
        }
        
        if (props.initialItems && props.initialItems.length > 0) {
            // Deep copy to avoid mutating prop directly
            items.value = JSON.parse(JSON.stringify(props.initialItems))
            // Ensure nextId is safe
            const maxId = Math.max(...items.value.map(i => i.id || 0))
            nextId = maxId + 1
        } else {
            items.value = []
            addItem() // Start with one empty row
        }
    }
})

const addItem = () => {
    items.value.push({
        id: nextId++,
        category_code: '',
        amount: '',
        description: '',
        taxType: 'EXCLUDED_10' // Default to 10% tax
    })
}

const removeItem = (index) => {
    items.value.splice(index, 1)
}

// Calculate tax included amount for an item
const calculateItemTotal = (item) => {
    const amt = Number(item.amount)
    if (!amt) return 0

    if (item.taxType === 'INCLUDED') return amt
    if (item.taxType === 'EXCLUDED_8') return Math.floor(amt * 1.08)
    if (item.taxType === 'EXCLUDED_10') return Math.floor(amt * 1.10)
    return amt
}

const totalExcluded = computed(() => {
    return items.value.reduce((sum, item) => sum + calculateItemTotal(item), 0)
})

const resultAmount = computed(() => {
    const total = Number(totalAmount.value) || 0
    return total - totalExcluded.value
})

const apply = () => {
    emit('apply', {
        amount: resultAmount.value,
        total: totalAmount.value,
        items: items.value
    })
    emit('close')
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl p-6">
        <h3 class="text-lg font-bold mb-4 text-gray-700">レシート内訳計算</h3>
        
        <!-- Total Payment -->
        <div class="mb-6 bg-blue-50 p-4 rounded">
            <label class="block text-sm font-bold text-gray-700 mb-1">支払合計 (レシートの最下部)</label>
            <input 
                type="number" 
                v-model="totalAmount" 
                class="w-full text-2xl font-bold p-2 border rounded text-right" 
                placeholder="0"
                autofocus
            >
        </div>

        <!-- Exclusion List -->
        <div class="mb-4">
            <h4 class="text-sm font-bold text-gray-600 mb-2">除外する商品 (別会計にしたいもの)</h4>
            <div class="max-h-80 overflow-y-auto mb-2">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-left text-gray-500 border-b">
                            <th class="p-1 w-40">費目</th>
                            <th class="p-1">品名</th>
                            <th class="p-1 w-24">金額</th>
                            <th class="p-1 w-24">税区分</th>
                            <th class="p-1 text-right w-24">小計(税込)</th>
                            <th class="p-1 w-10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(item, index) in items" :key="item.id" class="border-b hover:bg-gray-50">
                            <td class="p-1">
                                <select v-model="item.category_code" class="border rounded p-1 w-full" required>
                                    <option value="" disabled>選択</option>
                                    <!-- Filter out logic can be done later if needed, passing raw categories for now -->
                                    <option v-for="cat in categories" :key="cat.code" :value="cat.code">
                                        {{ cat.name }}
                                    </option>
                                </select>
                            </td>
                            <td class="p-1">
                                <input type="text" v-model="item.description" class="border rounded p-1 w-full" placeholder="品名">
                            </td>
                            <td class="p-1">
                                <input type="number" v-model="item.amount" class="border rounded p-1 w-full text-right" placeholder="0">
                            </td>
                            <td class="p-1">
                                <select v-model="item.taxType" class="border rounded p-1 w-full">
                                    <option value="INCLUDED">税込</option>
                                    <option value="EXCLUDED_8">税抜8%</option>
                                    <option value="EXCLUDED_10">税抜10%</option>
                                </select>
                            </td>
                            <td class="p-1 text-right font-mono text-gray-600">
                                {{ calculateItemTotal(item).toLocaleString() }}
                            </td>
                            <td class="p-1 text-center">
                                <button @click="removeItem(index)" class="text-red-500 hover:text-red-700 font-bold">×</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <button @click="addItem" class="text-blue-600 text-sm hover:underline font-bold">+ 行を追加</button>
        </div>

        <div class="border-t pt-4">
            <div class="flex justify-between items-center mb-6">
                <div class="text-gray-600 text-sm">
                    支払合計: {{ Number(totalAmount).toLocaleString() }} <br>
                    - 除外計: {{ totalExcluded.toLocaleString() }}
                </div>
                <div class="text-right">
                    <div class="text-sm text-gray-500 font-bold">残額 (食費など)</div>
                    <div class="text-3xl font-bold text-blue-600">¥{{ resultAmount.toLocaleString() }}</div>
                </div>
            </div>

            <div class="flex justify-end space-x-3">
                <button @click="$emit('close')" class="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300">キャンセル</button>
                <button @click="apply" class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-bold">決定して反映</button>
            </div>
        </div>
    </div>
  </div>
</template>
