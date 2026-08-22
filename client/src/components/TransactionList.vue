<script setup>
import { ref, computed } from 'vue'
import { deleteTransaction, deleteTransactionsBatch, updateTransaction } from '../api'
import { getCategoryPaletteKeyByName, getCategoryPaletteKey } from '../utils'

const props = defineProps({
  transactions: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
})

const emit = defineEmits(['transaction-deleted', 'transaction-updated'])

const filters = ref({ date: '', category: '', description: '', memo: '' })

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

const isAllSelected = computed(() =>
  filteredTransactions.value.length > 0 &&
  filteredTransactions.value.every(tx => selectedIds.value.has(tx.id))
)

const toggleSelectAll = (e) => {
  if (e.target.checked) {
    filteredTransactions.value.forEach(tx => selectedIds.value.add(tx.id))
  } else {
    filteredTransactions.value.forEach(tx => selectedIds.value.delete(tx.id))
  }
}

const toggleSelection = (id) => {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
}

const getCategoryName = (code) => {
  const cat = props.categories.find(c => c.code === code)
  return cat ? cat.name : code
}

// Tailwind v4 の scanner は動的クラス名を拾わないため、明示リテラルで持つ。
const PILL_CLASSES = {
  food:    'text-cat-food bg-cat-food-soft',
  util:    'text-cat-util bg-cat-util-soft',
  trans:   'text-cat-trans bg-cat-trans-soft',
  leisure: 'text-cat-leisure bg-cat-leisure-soft',
  health:  'text-cat-health bg-cat-health-soft',
  comm:    'text-cat-comm bg-cat-comm-soft',
  edu:     'text-cat-edu bg-cat-edu-soft',
  income:  'text-cat-income bg-cat-income-soft',
  other:   'text-cat-other bg-cat-other-soft',
}
const getCategoryPillClass = (tx) => {
  const cat = props.categories.find(c => c.code === tx.category_code)
  const key = cat ? getCategoryPaletteKeyByName(cat.group_name) : getCategoryPaletteKey(tx.category_code)
  return PILL_CLASSES[key] || PILL_CLASSES.other
}

const remove = async (id) => {
  const tx = props.transactions.find(t => t.id === id)
  const msg = tx
    ? `「${tx.date} ${tx.description} ¥${tx.amount.toLocaleString()}」\nを削除しますか？`
    : '削除しますか？'
  if (!confirm(msg)) return
  try {
    await deleteTransaction(id)
    selectedIds.value.delete(id)
    if (editingId.value === id) cancelEdit()
    emit('transaction-deleted')
  } catch (e) {
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
  } catch (e) {
    alert(e.message)
  }
}

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
    if (!editForm.value.amount || !editForm.value.category_code) {
      alert('金額と費目は必須です')
      return
    }
    const catCode = Number(editForm.value.category_code)
    if (catCode >= 700 && catCode < 800) {
      editForm.value.type = 'INCOME'
    } else {
      editForm.value.type = 'EXPENSE'
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
  <div class="bg-surface border border-rule rounded-xl overflow-hidden">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 px-5 py-3.5 border-b border-rule">
      <div class="flex items-baseline gap-3">
        <h2 class="text-[14px] font-semibold text-ink m-0">明細一覧</h2>
        <span class="text-[11px] text-ink-3 font-tabular">{{ filteredTransactions.length }} 件</span>
      </div>
      <button
        v-if="selectedIds.size > 0"
        @click="removeSelected"
        class="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-neg-soft text-neg hover:bg-neg hover:text-white transition flex items-center gap-1.5"
      >
        <span>選択した {{ selectedIds.size }} 件を削除</span>
      </button>
    </div>

    <!-- Filters -->
    <div class="bg-rule-soft/50 px-5 py-3 border-b border-rule grid grid-cols-1 md:grid-cols-4 gap-3 text-[12px]">
      <div>
        <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">日付</label>
        <input type="date" v-model="filters.date" class="border border-rule bg-surface text-ink p-1.5 w-full rounded-md focus:outline-none focus:border-accent">
      </div>
      <div>
        <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">費目</label>
        <select v-model="filters.category" class="border border-rule bg-surface text-ink p-1.5 w-full rounded-md focus:outline-none focus:border-accent">
          <option value="">すべて</option>
          <option v-for="cat in categories" :key="cat.code" :value="cat.code">{{ cat.name }}</option>
        </select>
      </div>
      <div>
        <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">品名</label>
        <input type="text" v-model="filters.description" placeholder="部分一致" class="border border-rule bg-surface text-ink p-1.5 w-full rounded-md focus:outline-none focus:border-accent">
      </div>
      <div>
        <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">備考</label>
        <input type="text" v-model="filters.memo" placeholder="部分一致" class="border border-rule bg-surface text-ink p-1.5 w-full rounded-md focus:outline-none focus:border-accent">
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-rule">
            <th class="px-4 py-2 w-10 text-center">
              <input
                type="checkbox"
                :checked="isAllSelected"
                @change="toggleSelectAll"
                class="w-3.5 h-3.5 rounded border-rule text-accent focus:ring-accent"
              >
            </th>
            <th class="px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3 font-medium">日付</th>
            <th class="px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3 font-medium">費目</th>
            <th class="px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3 font-medium">品名</th>
            <th class="px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3 font-medium text-right">金額</th>
            <th class="px-3 py-2 text-[10px] tracking-[0.12em] uppercase text-ink-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tx in filteredTransactions"
            :key="tx.id"
            class="border-b border-rule-soft last:border-b-0 transition"
            :class="{
              'bg-accent-soft/40': selectedIds.has(tx.id),
              'bg-cat-util-soft/40': editingId === tx.id,
              'hover:bg-rule-soft/40': !selectedIds.has(tx.id) && editingId !== tx.id,
            }"
          >
            <td class="px-4 py-2 text-center">
              <input
                type="checkbox"
                :checked="selectedIds.has(tx.id)"
                @change="toggleSelection(tx.id)"
                class="w-3.5 h-3.5 rounded border-rule text-accent focus:ring-accent"
                :disabled="editingId === tx.id"
              >
            </td>

            <!-- EDIT MODE -->
            <template v-if="editingId === tx.id">
              <td class="px-3 py-2">
                <input type="date" v-model="editForm.date" class="border border-rule bg-surface p-1 rounded-md w-32 text-[12px]" required>
              </td>
              <td class="px-3 py-2">
                <select v-model="editForm.category_code" class="border border-rule bg-surface p-1 rounded-md w-32 text-[12px]">
                  <option v-for="cat in categories" :key="cat.code" :value="cat.code">{{ cat.name }}</option>
                </select>
              </td>
              <td class="px-3 py-2">
                <input type="text" v-model="editForm.description" class="border border-rule bg-surface p-1 rounded-md w-full mb-1 text-[12px]" placeholder="品名">
                <input type="text" v-model="editForm.memo" class="border border-rule bg-surface p-1 rounded-md w-full text-[11px]" placeholder="備考">
              </td>
              <td class="px-3 py-2">
                <input type="number" v-model="editForm.amount" class="border border-rule bg-surface p-1 rounded-md w-24 text-right font-mono text-[12px]" required>
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-col gap-1">
                  <button @click="saveEdit" class="text-[11px] font-semibold px-2 py-1 rounded-md bg-accent text-white hover:opacity-90">保存</button>
                  <button @click="cancelEdit" class="text-[11px] px-2 py-1 rounded-md text-ink-2 hover:bg-rule-soft">中止</button>
                </div>
              </td>
            </template>

            <!-- VIEW MODE -->
            <template v-else>
              <td class="px-3 py-2 text-[12px] text-ink-3 font-mono font-tabular whitespace-nowrap">{{ tx.date }}</td>
              <td class="px-3 py-2">
                <span
                  class="inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full text-[11px] font-medium"
                  :class="getCategoryPillClass(tx)"
                >
                  <i class="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70"></i>
                  {{ getCategoryName(tx.category_code) }}
                </span>
              </td>
              <td class="px-3 py-2 text-[13px] text-ink">
                {{ tx.description }}
                <div v-if="tx.memo" class="text-[11px] text-ink-3 mt-0.5">{{ tx.memo }}</div>
              </td>
              <td
                class="px-3 py-2 font-mono font-tabular font-medium text-right whitespace-nowrap"
                :class="tx.type === 'INCOME' ? 'text-pos' : 'text-ink'"
              >
                {{ tx.type === 'INCOME' ? '+' : '' }}¥{{ tx.amount.toLocaleString() }}
              </td>
              <td class="px-3 py-2">
                <div class="flex gap-2 text-[12px]">
                  <button @click="startEdit(tx)" class="text-ink-2 hover:text-accent font-medium">編集</button>
                  <button @click="remove(tx.id)" class="text-ink-2 hover:text-neg font-medium">削除</button>
                </div>
              </td>
            </template>
          </tr>
          <tr v-if="filteredTransactions.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-ink-3 text-[13px]">表示対象のデータがありません</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
