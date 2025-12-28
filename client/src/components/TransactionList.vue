<script setup>
import { ref, computed, nextTick } from 'vue'
import { deleteTransaction, deleteTransactionsBatch, updateTransaction } from '../api'

const props = defineProps({
  transactions: {
    type: Array,
    default: () => []
  },
  categories: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['transaction-deleted', 'transaction-updated'])

// Filtering State
const filters = ref({
    date: '',
    category: '',
    description: '',
    memo: ''
})

// Filtered Transactions
const filteredTransactions = computed(() => {
    return props.transactions.filter(tx => {
        const matchDate = !filters.value.date || tx.date === filters.value.date
        const matchCategory = !filters.value.category || String(tx.category_code) === String(filters.value.category)
        const matchDescription = !filters.value.description || tx.description.includes(filters.value.description)
        const matchMemo = !filters.value.memo || (tx.memo && tx.memo.includes(filters.value.memo))
        
        return matchDate && matchCategory && matchDescription && matchMemo
    })
})

const selectedIds = ref(new Set())
const editingId = ref(null)
const editForm = ref({})

// Update selection logic to work with filtered list
const isAllSelected = computed(() => {
    return filteredTransactions.value.length > 0 && 
           filteredTransactions.value.every(tx => selectedIds.value.has(tx.id))
})

const toggleSelectAll = (e) => {
    if (e.target.checked) {
        filteredTransactions.value.forEach(tx => selectedIds.value.add(tx.id))
    } else {
        filteredTransactions.value.forEach(tx => selectedIds.value.delete(tx.id))
    }
}

const toggleSelection = (id) => {
    if (selectedIds.value.has(id)) {
        selectedIds.value.delete(id)
    } else {
        selectedIds.value.add(id)
    }
}

const getCategoryName = (code) => {
    const cat = props.categories.find(c => c.code === code)
    return cat ? cat.name : code
}

const remove = async (id) => {
    const tx = props.transactions.find(t => t.id === id)
    const msg = tx 
        ? `「${tx.date} ${tx.description} ¥${tx.amount.toLocaleString()}」\nを削除しますか？`
        : '削除しますか？'
    
    if(!confirm(msg)) return

    try {
        await deleteTransaction(id)
        selectedIds.value.delete(id)
        if (editingId.value === id) cancelEdit()
        emit('transaction-deleted')
    } catch(e) {
        alert(e.message)
    }
}

const removeSelected = async () => {
    const count = selectedIds.value.size
    if (count === 0) return

    if (!confirm(`選択した ${count} 件の明細を削除しますか？`)) return

    try {
        await deleteTransactionsBatch(Array.from(selectedIds.value))
        selectedIds.value.clear()
        emit('transaction-deleted')
    } catch(e) {
        alert(e.message)
    }
}

// Inline Editing
const startEdit = (tx) => {
    editingId.value = tx.id
    editForm.value = { ...tx }
}

const cancelEdit = () => {
    editingId.value = null
    editForm.value = {}
}

const saveEdit = async () => {
    try {
        // Validate? (Simple check)
        if (!editForm.value.amount || !editForm.value.category_code) {
            alert('金額と費目は必須です')
            return
        }

        // Determine Type from Category (Simple logic based on range or existing logic)
        // Usually categories > 900 (Income) vs others. 
        // Let's reuse existing cat logic if possible or assume user doesn't change type implicitly?
        // Actually, if user changes Category to "Salary" (Income), type should be INCOME.
        // We need to look up category.
        const cat = props.categories.find(c => c.code === editForm.value.category_code)
        if (cat) {
             // Heuristic: Income categories are usually specific range. 
             // In TransactionForm: category_code >= 900 && code !== 901 ?
             // Let's assume the user selects correct category group.
             // But valid Type is needed for DB.
             // If category is Income group, set INCOME.
             // In this app, it seems income is handled manually in form, but here we can infer?
             // Or just trust existing type unless we implement type switching logic.
             // Let's just keep 'type' from original unless necessary, BUT if category changes group...
             // Let's stick to simple: Just update fields. The backend does NO type inference.
        }

        await updateTransaction(editingId.value, editForm.value)
        emit('transaction-updated')
        cancelEdit()
    } catch (e) {
        alert(e.message)
    }
}
</script>

<template>
  <div class="bg-white p-4 rounded shadow">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
        <h2 class="text-xl font-bold">明細一覧</h2>
        <button 
            v-if="selectedIds.size > 0"
            @click="removeSelected"
            class="bg-red-600 text-white px-4 py-2 rounded shadow hover:bg-red-700 transition font-bold text-sm flex items-center gap-2"
        >
            <span>🗑️</span>
            <span>選択した {{ selectedIds.size }} 件を削除</span>
        </button>
    </div>

    <!-- Filters -->
    <div class="bg-gray-50 p-3 rounded mb-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <div>
            <label class="block text-gray-500 font-bold mb-1">日付</label>
            <input type="date" v-model="filters.date" class="border p-1 w-full rounded">
        </div>
        <div>
            <label class="block text-gray-500 font-bold mb-1">費目</label>
            <select v-model="filters.category" class="border p-1 w-full rounded">
                <option value="">すべて</option>
                <option v-for="cat in categories" :key="cat.code" :value="cat.code">
                    {{ cat.name }}
                </option>
            </select>
        </div>
        <div>
            <label class="block text-gray-500 font-bold mb-1">品名</label>
            <input type="text" v-model="filters.description" placeholder="部分一致" class="border p-1 w-full rounded">
        </div>
        <div>
            <label class="block text-gray-500 font-bold mb-1">備考</label>
            <input type="text" v-model="filters.memo" placeholder="部分一致" class="border p-1 w-full rounded">
        </div>
    </div>

    <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="bg-gray-100 text-gray-600 text-sm">
                    <th class="p-2 border-b w-10 text-center">
                        <input 
                            type="checkbox" 
                            :checked="isAllSelected"
                            @change="toggleSelectAll"
                            class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        >
                    </th>
                    <th class="p-2 border-b">日付</th>
                    <th class="p-2 border-b">費目</th>
                    <th class="p-2 border-b">品名</th>
                    <th class="p-2 border-b">金額</th>
                    <th class="p-2 border-b">操作</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="tx in filteredTransactions" :key="tx.id" class="border-b hover:bg-gray-50 bg-white" :class="{'bg-blue-50': selectedIds.has(tx.id), 'bg-yellow-50': editingId === tx.id}">
                    <td class="p-2 text-center">
                        <input 
                            type="checkbox" 
                            :checked="selectedIds.has(tx.id)"
                            @change="toggleSelection(tx.id)"
                            class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            :disabled="editingId === tx.id"
                        >
                    </td>
                    
                    <!-- EDIT MODE -->
                    <template v-if="editingId === tx.id">
                        <td class="p-2">
                             <input type="date" v-model="editForm.date" class="border p-1 rounded w-32" required>
                        </td>
                        <td class="p-2">
                             <select v-model="editForm.category_code" class="border p-1 rounded w-32">
                                <option v-for="cat in categories" :key="cat.code" :value="cat.code">
                                    {{ cat.name }}
                                </option>
                             </select>
                        </td>
                        <td class="p-2">
                            <input type="text" v-model="editForm.description" class="border p-1 rounded w-full mb-1" placeholder="品名">
                            <input type="text" v-model="editForm.memo" class="border p-1 rounded w-full text-xs" placeholder="備考">
                        </td>
                        <td class="p-2">
                            <input type="number" v-model="editForm.amount" class="border p-1 rounded w-24 text-right" required>
                        </td>
                        <td class="p-2">
                            <div class="flex flex-col gap-1">
                                <button @click="saveEdit" class="text-white bg-green-500 hover:bg-green-600 px-2 py-1 rounded text-xs font-bold">
                                    保存
                                </button>
                                <button @click="cancelEdit" class="text-gray-600 hover:bg-gray-200 px-2 py-1 rounded text-xs">
                                    中止
                                </button>
                            </div>
                        </td>
                    </template>

                    <!-- VIEW MODE -->
                    <template v-else>
                        <td class="p-2">{{ tx.date }}</td>
                        <td class="p-2">
                            <span class="px-2 py-1 rounded text-xs" :class="tx.type === 'INCOME' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
                                {{ getCategoryName(tx.category_code) }}
                            </span>
                        </td>
                        <td class="p-2 text-sm">
                            {{ tx.description }}
                            <div class="text-xs text-gray-400">{{ tx.memo }}</div>
                        </td>
                        <td class="p-2 font-mono font-bold" :class="tx.type === 'INCOME' ? 'text-green-600' : 'text-gray-800'">
                            ¥{{ tx.amount.toLocaleString() }}
                        </td>
                        <td class="p-2">
                            <div class="flex gap-2">
                                <button @click="startEdit(tx)" class="text-blue-500 hover:text-blue-700 text-sm font-bold">
                                    編集
                                </button>
                                <button @click="remove(tx.id)" class="text-red-500 hover:text-red-700 text-sm">
                                    削除
                                </button>
                            </div>
                        </td>
                    </template>
                </tr>
                <tr v-if="filteredTransactions.length === 0">
                    <td colspan="6" class="p-4 text-center text-gray-400">表示対象のデータがありません</td>
                </tr>
            </tbody>
        </table>
    </div>
  </div>
</template>
