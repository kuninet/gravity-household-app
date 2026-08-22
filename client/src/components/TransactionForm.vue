<script setup>
import { ref, onMounted } from 'vue'
import { createTransaction, fetchCategories, fetchTransactions } from '../api'
import ReceiptSplitter from './ReceiptSplitter.vue'
import ReceiptOCR from './ReceiptOCR.vue'

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
const showSplitter = ref(false)
const showOCR = ref(false)
const isLoading = ref(true)

// Splitter State (for re-edit)
const splitterState = ref({
    total: '',
    items: []
})

// Watch for category change to auto-select type
import { watch } from 'vue'
watch(() => form.value.category_code, (newCode) => {
    if (!newCode) return
    const code = Number(newCode)
    // 700-799 is Income, others are Expenses
    if (code >= 700 && code < 800) {
        form.value.type = 'INCOME'
    } else {
        form.value.type = 'EXPENSE'
    }
})

// Fetch master data
onMounted(async () => {
  try {
    const res = await fetchCategories()
    categories.value = res.data || []
    await refreshRecent()
  } catch (e) {
    console.error('Failed to load categories:', e)
    categories.value = [] // Ensure it's always an array
  } finally {
    isLoading.value = false
  }
})

// Refresh recent transactions for copy feature
const refreshRecent = async () => {
    try {
        // Fetch recent (server handles limit and sorting)
        const res = await fetchTransactions(null, true)
        recentTransactions.value = res.data
    } catch (e) {
        console.error(e)
    }
}

const toValidMainAmount = (amount) => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return null
    return value
}

const calculateTaxIncludedAmount = (item) => {
    const amt = Number(item.amount)
    if (!Number.isFinite(amt) || amt === 0) return null
    if (amt < 0) return amt
    if (item.taxType === 'INCLUDED') return amt
    if (item.taxType === 'EXCLUDED_8') return Math.floor(amt * 1.08)
    if (item.taxType === 'EXCLUDED_10') return Math.floor(amt * 1.10)
    return amt
}

// Pick the category with the largest signed tax-included total among splitter items.
// Signed sum handles discount lines (negative amounts) correctly: a discount reduces
// the actual burden on that category rather than boosting it via absolute value.
const inferCategoryFromItems = (items) => {
    const totals = new Map()
    for (const item of items) {
        if (!item.category_code) continue
        const amt = calculateTaxIncludedAmount(item)
        if (amt === null) continue
        totals.set(item.category_code, (totals.get(item.category_code) || 0) + Number(amt))
    }
    let bestCode = ''
    let bestAmt = -Infinity
    for (const [code, amt] of totals) {
        if (amt > bestAmt) { bestAmt = amt; bestCode = code }
    }
    return bestCode
}

// Category code → transaction type (mirrors the watch on form.value.category_code).
// Used synchronously during submit to avoid a reactivity race when auto-filling.
const typeForCategory = (code) => {
    const n = Number(code)
    return (n >= 700 && n < 800) ? 'INCOME' : 'EXPENSE'
}

// Submit
const submit = async () => {
  if (isSubmitting.value) return
  isSubmitting.value = true
  try {
    // Auto-fill main category from splitter items when omitted (issue #18)
    let categoryAutoFilled = false
    if (!form.value.category_code && splitterState.value.items.length > 0) {
        const inferred = inferCategoryFromItems(splitterState.value.items)
        if (inferred) {
            form.value.category_code = inferred
            // Set type synchronously; the reactive watch on category_code runs
            // async and would not update form.value.type before the POST below.
            form.value.type = typeForCategory(inferred)
            categoryAutoFilled = true
        }
    }

    // Guard against silent no-op: nothing to submit means user typed nothing
    // meaningful. Warn instead of resetting the form as if it succeeded.
    const mainAmount = toValidMainAmount(form.value.amount)
    const hasValidItem = splitterState.value.items.some(
        (item) => item.category_code && calculateTaxIncludedAmount(item) !== null
    )
    if (mainAmount === null && !hasValidItem) {
        alert('登録できる内容がありません。金額または内訳を入力してください。')
        return
    }

    // 1. Submit main transaction (calculated amount)
    if (mainAmount !== null && form.value.category_code) {
        await createTransaction({
            ...form.value,
            amount: mainAmount
        })
    }

    // 2. Submit Splitter Items (if any)
    if (splitterState.value.items.length > 0) {
        for (const item of splitterState.value.items) {
           // Skip if invalid category
           if (!item.category_code) continue
           
           const amount = calculateTaxIncludedAmount(item)
           if (amount === null) continue

           // Determine type based on category
           const code = Number(item.category_code)
           const type = (code >= 700 && code < 800) ? 'INCOME' : 'EXPENSE'

           await createTransaction({
               date: form.value.date,
               type: type,
               amount: amount,
               category_code: item.category_code,
               description: item.description || form.value.description, // Use specific item desc or fallback
               memo: form.value.memo // Use same memo
           })
        }
    }

    emit('transaction-added')
    
    // Reset form
    form.value.amount = ''
    form.value.description = ''
    form.value.memo = ''
    if (categoryAutoFilled) form.value.category_code = ''

    // Reset Splitter State
    splitterState.value = { total: '', items: [] }

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

// Splitter
const openSplitter = () => {
    showSplitter.value = true
}

const applySplitter = (result) => {
    // result: { amount, total, items }
    form.value.amount = result.amount
    
    // Save state for re-edit and submit
    splitterState.value.total = result.total
    splitterState.value.items = result.items
}

// OCR
const droppedFile = ref(null)
const isDraggingReceipt = ref(false)
let dragDepth = 0

const openOCR = () => {
    droppedFile.value = null
    showOCR.value = true
}

// Only treat drags that carry files as receipt drops. Ignore text/element drags
// so links within the form (e.g. "履歴からコピー" li elements) do not trigger it.
const dragHasFiles = (e) => {
    const types = e.dataTransfer && e.dataTransfer.types
    if (!types) return false
    return Array.from(types).includes('Files')
}

const onFormDragEnter = (e) => {
    if (!dragHasFiles(e)) return
    dragDepth++
    isDraggingReceipt.value = true
}

const onFormDragOver = (e) => {
    if (!dragHasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

const onFormDragLeave = (e) => {
    if (!dragHasFiles(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) isDraggingReceipt.value = false
}

// Accept anything that either has an image/pdf MIME or a matching extension.
// macOS Finder / iOS Photos sometimes leave file.type empty for PDFs and HEIC,
// so the extension is a necessary fallback.
const isReceiptFile = (file) => {
    if (!file) return false
    const mime = (file.type || '').toLowerCase()
    if (mime.startsWith('image/') || mime === 'application/pdf') return true
    return /\.(pdf|jpe?g|png|webp|heic|heif|gif)$/i.test(file.name || '')
}

const onFormDrop = (e) => {
    dragDepth = 0
    isDraggingReceipt.value = false
    if (!dragHasFiles(e)) return
    e.preventDefault()
    const file = e.dataTransfer.files && e.dataTransfer.files[0]
    if (!file) return
    if (!isReceiptFile(file)) {
        alert('レシートに使えるファイル形式ではありません (画像 / PDF のみ対応)')
        return
    }
    droppedFile.value = file
    showOCR.value = true
}

const applyOCR = (result) => {
    // result: { amount, total, items, date, store }
    
    form.value.amount = result.amount 
    splitterState.value.total = result.total 
    splitterState.value.items = result.items 

    // Apply Date if exists
    if (result.date) {
        form.value.date = result.date
    }

    // Apply Store Name to Memo
    if (result.store) {
        // If memo is empty, just set it. If not, append it.
        if (form.value.memo) {
            form.value.memo += ` (${result.store})`
        } else {
            form.value.memo = result.store
        }
    }
}
</script>

<template>
  <div
    class="bg-surface border border-rule rounded-xl p-5 mb-6 relative"
    @dragenter="onFormDragEnter"
    @dragover="onFormDragOver"
    @dragleave="onFormDragLeave"
    @drop="onFormDrop"
  >
    <!-- Drop overlay: shown while user drags a file over the form (issue #19) -->
    <div
      v-if="isDraggingReceipt"
      class="absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/90 pointer-events-none"
    >
        <div class="text-center">
            <div class="text-4xl mb-2">📥</div>
            <div class="font-semibold text-accent text-base">ここにレシート (PDF / 画像) をドロップ</div>
            <div class="text-accent text-xs mt-1 opacity-80">AI 解析モーダルが開きます</div>
        </div>
    </div>

    <div class="flex justify-between items-center mb-4">
        <div class="flex items-baseline gap-2">
            <h2 class="text-[14px] font-semibold text-ink m-0">新規入力</h2>
            <span class="text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold">NEW ENTRY</span>
        </div>
        <button type="button" @click="openOCR" class="bg-accent-soft hover:bg-accent hover:text-white text-accent px-3 py-1.5 rounded-md text-[12px] font-semibold flex items-center gap-1.5 transition">
            <span>📷</span><span>レシート読取 (AI)</span>
        </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Form Area -->
        <form @submit.prevent="submit" class="space-y-3">
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">日付</label>
                    <input type="date" v-model="form.date" class="border border-rule bg-surface text-ink p-2 w-full rounded-md text-[13px] focus:outline-none focus:border-accent" required>
                </div>
                <div>
                    <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">収支</label>
                    <select v-model="form.type" class="border border-rule bg-surface text-ink p-2 w-full rounded-md text-[13px] focus:outline-none focus:border-accent">
                        <option value="EXPENSE">支出</option>
                        <option value="INCOME">収入</option>
                    </select>
                </div>
            </div>

            <div>
                <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">
                    費目
                    <span v-if="splitterState.items.length > 0" class="text-[10px] normal-case tracking-normal text-ink-3 font-normal ml-1">(内訳ありのため自動判定)</span>
                    <span v-else class="text-[10px] normal-case tracking-normal text-ink-3 font-normal ml-1">(メイン: 食費など)</span>
                </label>
                <select v-model="form.category_code" class="border border-rule bg-surface text-ink p-2 w-full rounded-md text-[13px] focus:outline-none focus:border-accent" :required="splitterState.items.length === 0" :disabled="isLoading">
                    <option value="" :disabled="splitterState.items.length === 0">
                        {{ isLoading ? '読み込み中...' : (splitterState.items.length > 0 ? '(内訳の最大金額から自動)' : '選択してください') }}
                    </option>
                    <option v-for="cat in (categories || []).filter(c => c.code < 600 || (c.code >= 700 && c.code < 900) || (c.code >= 900 && c.code !== 901))" :key="cat.code" :value="cat.code">
                        {{ cat.code }}: {{ cat.name }} ({{ cat.group_name }})
                    </option>
                </select>
            </div>

            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">金額</label>
                    <div class="flex gap-2">
                        <input type="number" v-model="form.amount" class="border border-rule bg-surface text-ink p-2 w-full rounded-md text-[13px] font-mono font-tabular focus:outline-none focus:border-accent" :required="splitterState.items.length === 0" placeholder="0">
                        <button type="button" @click="openSplitter" class="bg-cat-util-soft hover:bg-cat-util hover:text-white text-cat-util px-2.5 py-2 rounded-md text-[11px] font-semibold whitespace-nowrap transition" title="レシート内訳計算">
                            内訳
                            <span v-if="splitterState.items.length > 0" class="ml-1 bg-cat-util text-white rounded-full px-1.5 py-0.5 text-[10px]">
                                +{{ splitterState.items.length }}
                            </span>
                        </button>
                    </div>
                    <div v-if="splitterState.total" class="text-[11px] text-ink-3 mt-1 text-right">
                        レシート合計: <span class="font-semibold text-ink font-mono font-tabular">¥{{ Number(splitterState.total).toLocaleString() }}</span>
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">品名</label>
                    <input type="text" v-model="form.description" class="border border-rule bg-surface text-ink p-2 w-full rounded-md text-[13px] focus:outline-none focus:border-accent" placeholder="品名">
                </div>
            </div>

            <div>
                <label class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">備考</label>
                <input type="text" v-model="form.memo" class="border border-rule bg-surface text-ink p-2 w-full rounded-md text-[13px] focus:outline-none focus:border-accent" placeholder="メモ">
            </div>

            <button type="submit"
                class="bg-accent text-white py-2.5 px-4 rounded-md w-full hover:opacity-90 font-semibold text-[13px] disabled:opacity-50 disabled:cursor-not-allowed transition"
                :disabled="isSubmitting">
                <span v-if="isSubmitting">送信中...</span>
                <span v-else>登録する (一括)</span>
            </button>
        </form>

        <!-- History/Copy Area -->
        <div class="bg-rule-soft/50 border border-rule rounded-lg p-3 text-[12px]">
            <h3 class="font-semibold mb-2 text-[10px] tracking-[0.12em] uppercase text-ink-3">最近の履歴からコピー</h3>
            <ul class="space-y-1.5">
                <li v-for="tx in recentTransactions" :key="tx.id"
                    @click="copy(tx)"
                    class="cursor-pointer hover:bg-accent-soft/50 hover:border-accent p-2 rounded-md border border-rule bg-surface flex justify-between items-center transition">
                    <div class="min-w-0">
                        <div class="font-medium text-ink truncate">{{ tx.description || '名称なし' }}</div>
                        <div class="text-[10px] text-ink-3 font-mono font-tabular">{{ tx.date }}</div>
                    </div>
                    <div class="font-mono font-tabular text-ink whitespace-nowrap">¥{{ Number(tx.amount).toLocaleString() }}</div>
                </li>
            </ul>
        </div>
    </div>
    
    <!-- Splitter Modal -->
    <ReceiptSplitter 
        :show="showSplitter" 
        :categories="categories || []"
        :initial-total="splitterState.total"
        :initial-items="splitterState.items"
        @close="showSplitter = false"
        @apply="applySplitter"
    />

    <!-- OCR Modal -->
    <ReceiptOCR
        :show="showOCR"
        :categories="categories || []"
        :initial-file="droppedFile"
        @close="showOCR = false; droppedFile = null"
        @apply="applyOCR"
    />
  </div>
</template>
