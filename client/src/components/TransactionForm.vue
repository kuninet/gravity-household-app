<script setup>
import { ref, onMounted } from 'vue'
import { createTransaction, fetchCategories, fetchTransactions } from '../api'

// Props to notify parent of updates
const emit = defineEmits(['transaction-added'])

// State
const categories = ref([])
const form = ref({
  date: new Date().toISOString().split('T')[0],
  amount: '',
  type: 'EXPENSE',
  category_code: '',
  description: '',
  memo: ''
})
const recentTransactions = ref([])
const isSubmitting = ref(false)

// Fetch master data
onMounted(async () => {
  try {
    const res = await fetchCategories()
    categories.value = res.data
    await refreshRecent()
  } catch (e) {
    console.error(e)
  }
})

// Refresh recent transactions for copy feature
const refreshRecent = async () => {
    try {
        const res = await fetchTransactions()
        // Get last 5
        recentTransactions.value = res.data.slice(0, 5)
    } catch (e) {
        console.error(e)
    }
}

// Submit
const submit = async () => {
  if (isSubmitting.value) return
  isSubmitting.value = true
  try {
    await createTransaction(form.value)
    emit('transaction-added')
    // Reset form but keep date? Or reset all?
    // User requirement: efficiency. Keeping date is usually good.
    form.value.amount = ''
    form.value.description = ''
    form.value.memo = ''
    // Refresh recent list
    await refreshRecent()
  } catch (e) {
    alert('Error: ' + e.message)
  } finally {
    isSubmitting.value = false
  }
}

// Copy from history
const copy = (tx) => {
    form.value.type = tx.type
    form.value.category_code = tx.category_code
    form.value.description = tx.description
    form.value.memo = tx.memo
    form.value.amount = tx.amount // User might want to change amount, but copying is helpful
}
</script>

<template>
  <div class="bg-white p-4 rounded shadow mb-6">
    <h2 class="text-xl font-bold mb-4">新規入力</h2>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Form Area -->
        <form @submit.prevent="submit" class="space-y-3">
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="block text-sm font-bold">日付</label>
                    <input type="date" v-model="form.date" class="border p-2 w-full rounded" required>
                </div>
                <div>
                    <label class="block text-sm font-bold">収支</label>
                    <select v-model="form.type" class="border p-2 w-full rounded">
                        <option value="EXPENSE">支出</option>
                        <option value="INCOME">収入</option>
                    </select>
                </div>
            </div>

            <div>
                <label class="block text-sm font-bold">費目</label>
                <select v-model="form.category_code" class="border p-2 w-full rounded" required>
                    <option value="" disabled>選択してください</option>
                    <option v-for="cat in categories.filter(c => c.code < 600 || (c.code >= 700 && c.code < 900) || (c.code >= 900 && c.code !== 901))" :key="cat.code" :value="cat.code">
                        {{ cat.code }}: {{ cat.name }} ({{ cat.group_name }})
                    </option>
                </select>
            </div>

            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="block text-sm font-bold">金額</label>
                    <input type="number" v-model="form.amount" class="border p-2 w-full rounded" required placeholder="0">
                </div>
                <div>
                    <label class="block text-sm font-bold">品名</label>
                    <input type="text" v-model="form.description" class="border p-2 w-full rounded" placeholder="店名など">
                </div>
            </div>

            <div>
                <label class="block text-sm font-bold">備考</label>
                <input type="text" v-model="form.memo" class="border p-2 w-full rounded" placeholder="メモ">
            </div>

            <button type="submit" 
                class="bg-blue-600 text-white py-2 px-4 rounded w-full hover:bg-blue-700 font-bold disabled:bg-blue-300 disabled:cursor-not-allowed"
                :disabled="isSubmitting">
                <span v-if="isSubmitting">送信中...</span>
                <span v-else>登録する</span>
            </button>
        </form>

        <!-- History/Copy Area -->
        <div class="bg-gray-50 p-3 rounded text-sm">
            <h3 class="font-bold mb-2 text-gray-600">最近の履歴からコピー</h3>
            <ul class="space-y-2">
                <li v-for="tx in recentTransactions" :key="tx.id" 
                    @click="copy(tx)"
                    class="cursor-pointer hover:bg-blue-100 p-2 rounded border bg-white flex justify-between items-center transition">
                    <div>
                        <span class="font-bold text-gray-700">{{ tx.description || '名称なし' }}</span>
                        <span class="text-xs text-gray-500 ml-2">{{ tx.date }}</span>
                    </div>
                    <div class="font-mono">¥{{ tx.amount }}</div>
                </li>
            </ul>
        </div>
    </div>
  </div>
</template>
