<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  show: Boolean,
  categories: {
      type: Array,
      default: () => []
  },
  // Preselect a file when the modal opens (e.g. dragged onto TransactionForm).
  // Cleared on close so the user can pick a different file next time.
  // Typed as Object to avoid referring to the browser-only File constructor at
  // module evaluation time (SSR / unit-test friendliness).
  initialFile: {
      type: Object,
      default: null
  }
})

const emit = defineEmits(['close', 'apply'])

const analyzeMessages = [
  "画像データを送信中...",
  "AIモデルを準備して読み込み中...",
  "画像内のテキストを抽出・解析中...",
  "レシートの品目と金額を家計簿データに整理中...",
  "AIが高精度な解析を行っています。しばらくお待ちください...",
  "引き続きAIが思考中です。もうしばらくお待ちください..."
]
const analyzeMessage = ref("AI解析中...")
const elapsedSeconds = ref(0)
let analyzeMessageInterval = null
const items = ref([]) // { id, description, amount, category_code, taxType, isAlcohol }
const totalAmount = ref(0)
const detectedDate = ref('')
const detectedStore = ref('')
const detectedTaxHint = ref(null) // "included" | "excluded" | "mixed" | null (issue #26)
const selectedModel = ref('')
const availableModels = ref([])
let nextId = 1
const fileInput = ref(null)
const selectedFile = ref(null)
const isAnalyzing = ref(false)

// Preview state (issue #26). Populated from selectedFile via a watch below.
const previewUrl = ref('')
const previewKind = ref('') // 'pdf' | 'image' | ''

const fetchModels = async () => {
    try {
        const res = await fetch('/api/ocr/models')
        const data = await res.json()
        if (data.models && data.models.length > 0) {
            availableModels.value = data.models
            
            // Try to load from localStorage
            const savedModel = localStorage.getItem('ocr_selected_model')
            const savedModelExists = data.models.some(m => m.id === savedModel)

            if (savedModel && savedModelExists) {
                selectedModel.value = savedModel
            } else {
                // Default to 1.5-flash or 3.0-flash if available, else first one
                const preferred = data.models.find(m => m.id.includes('1.5-flash')) || data.models[0]
                selectedModel.value = preferred.id
            }
        }
    } catch (e) {
        console.error("Failed to load models", e)
    }
}

watch(selectedModel, (newVal) => {
    if (newVal) {
        localStorage.setItem('ocr_selected_model', newVal)
    }
})

onMounted(() => {
    fetchModels()
})

watch(() => props.show, (newVal) => {
    if (newVal) {
        // Reset state when opened
        items.value = []
        selectedFile.value = props.initialFile || null
        isAnalyzing.value = false
        detectedDate.value = ''
        detectedStore.value = ''
        detectedTaxHint.value = null
        taxMode.value = 'INCLUDED' // reset default; overridden after analysis by data.tax_included
        if (fileInput.value) fileInput.value.value = ''

        // Refresh models when opening
        fetchModels()
    }
})

// Manage preview object URL lifecycle (issue #26).
watch(selectedFile, (file) => {
    if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value)
        previewUrl.value = ''
    }
    previewKind.value = ''
    if (!file) return

    const mime = (file.type || '').toLowerCase()
    const name = file.name || ''
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
        previewKind.value = 'pdf'
    } else if (mime.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(name)) {
        previewKind.value = 'image'
    }
    if (previewKind.value) {
        previewUrl.value = URL.createObjectURL(file)
    }
})

onBeforeUnmount(() => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

const clearSelectedFile = () => {
    selectedFile.value = null
    if (fileInput.value) fileInput.value.value = ''
}

const taxMode = ref('INCLUDED') // INCLUDED or EXCLUDED
const isDragging = ref(false)

const isNegativeAmount = (amount) => Number(amount) < 0

// Category code fallback used when no store/item hint matches.
const DEFAULT_CATEGORY_CODE = 100 // 食費

// Map an item-level hint returned by Gemini to a category code.
const CATEGORY_CODE_BY_ITEM_HINT = {
    food: 100,          // 食費
    dining_out: 103,    // 外食費
    alcohol: 105,       // 酒
    daily_goods: 200,   // 日用品・雑費
    medical: 500,       // 医療費
    transport: 300,     // 交通費
    entertainment: 400, // 交際費・娯楽
    other: 900          // その他
}

// Map a store-level hint to the code used when an item has no explicit hint.
// Drugstores tend to sell mostly daily goods, so the fallback is 日用品 there.
// restaurant はここに到達しない: OVERRIDE_CATEGORY_CODE_BY_STORE_HINT が先に効くため (issue #64)
const FALLBACK_CATEGORY_CODE_BY_STORE_HINT = {
    drugstore: 200,   // 日用品
    pharmacy: 200,    // 日用品 (a pharmacy in Japan mixes medicine and daily goods)
    grocery: 100,     // 食費
    convenience: 100, // 食費
    restaurant: 103   // 外食
}

// 店舗ヒントによっては明細ヒントより店舗を優先する。
// 飲食店のレシートは料理・酒・その他をすべて外食費にまとめる (issue #61, #64)
const OVERRIDE_CATEGORY_CODE_BY_STORE_HINT = {
    restaurant: 103   // 外食費
}

// 酒類は軽減税率の対象外。費目コードが 105 でなくても Gemini が alcohol と判定した明細は 10% 扱いにする (issue #61)
const isReducedTaxTarget = (item) => {
    const code = Number(item.category_code)
    return !item.isAlcohol && code >= 100 && code < 200 && code !== 105
}

const resolveCategoryCode = (itemHint, storeHint) => {
    if (storeHint && OVERRIDE_CATEGORY_CODE_BY_STORE_HINT[storeHint] !== undefined) {
        return OVERRIDE_CATEGORY_CODE_BY_STORE_HINT[storeHint]
    }
    if (itemHint && CATEGORY_CODE_BY_ITEM_HINT[itemHint] !== undefined) {
        return CATEGORY_CODE_BY_ITEM_HINT[itemHint]
    }
    if (storeHint && FALLBACK_CATEGORY_CODE_BY_STORE_HINT[storeHint] !== undefined) {
        return FALLBACK_CATEGORY_CODE_BY_STORE_HINT[storeHint]
    }
    return DEFAULT_CATEGORY_CODE
}

const onFileChange = (e) => {
    selectedFile.value = e.target.files[0]
}

const onDrop = (e) => {
    isDragging.value = false
    const files = e.dataTransfer.files
    if (files.length > 0) {
        selectedFile.value = files[0]
    }
}

const analyze = async () => {
    if (!selectedFile.value) return
    isAnalyzing.value = true
    items.value = []
    
    elapsedSeconds.value = 0
    let msgIndex = 0
    analyzeMessage.value = `${analyzeMessages[msgIndex]}`

    analyzeMessageInterval = setInterval(() => {
        elapsedSeconds.value++
        
        // Change message roughly every 8 seconds
        if (elapsedSeconds.value % 8 === 0) {
            msgIndex++
            if (msgIndex >= analyzeMessages.length) {
                // Loop the last few messages if it takes extremely long
                msgIndex = analyzeMessages.length - 2
            }
        }
        analyzeMessage.value = `${analyzeMessages[msgIndex]}`
    }, 1000)
    
    const formData = new FormData()
    formData.append('image', selectedFile.value)
    if (selectedModel.value) {
        formData.append('model', selectedModel.value)
    }

    try {
        const res = await fetch('/api/ocr/analyze', {
            method: 'POST',
            body: formData
        })
        if (!res.ok) throw new Error('Analysis failed')
        const data = await res.json()
        
        // Extract date, store, and hints
        detectedDate.value = data.date || ''
        detectedStore.value = data.store || ''
        const storeHint = data.store_category_hint || null
        // Adopt LLM's tax judgement as the initial global tax mode (issue #26).
        // "mixed" and null fall back to INCLUDED (safer: no synthetic tax added).
        const taxIncludedHint = data.tax_included || null
        detectedTaxHint.value = taxIncludedHint
        taxMode.value = taxIncludedHint === 'excluded' ? 'EXCLUDED' : 'INCLUDED'

        // Map to internal format
        if (data.items) {
            items.value = data.items.map(item => {
                const amount = Number(item.amount)
                // Smart category default: item-level hint > store-level hint > 食費 (issue #20)
                const categoryCode = resolveCategoryCode(item.category_hint, storeHint)
                const isAlcohol = item.category_hint === 'alcohol'
                let finalTaxType = 'INCLUDED';

                if (isNegativeAmount(amount)) {
                    finalTaxType = 'INCLUDED';
                } else if (taxMode.value === 'EXCLUDED') {
                    // Food (100-199) except Alcohol is 8%; others 10%.
                    if (isReducedTaxTarget({ category_code: categoryCode, isAlcohol })) {
                        finalTaxType = 'EXCLUDED_8';
                    } else {
                        finalTaxType = 'EXCLUDED_10';
                    }
                }

                return {
                    id: nextId++,
                    description: item.description,
                    amount: Number.isFinite(amount) ? amount : item.amount,
                    category_code: categoryCode,
                    taxType: finalTaxType,
                    isAlcohol
                }
            })
        }
    } catch (e) {
        alert('解析に失敗しました: ' + e.message)
    } finally {
        isAnalyzing.value = false
        if (analyzeMessageInterval) clearInterval(analyzeMessageInterval)
        analyzeMessage.value = "AI解析中..."
        elapsedSeconds.value = 0
    }
}

const updateTaxType = (item) => {
    if (isNegativeAmount(item.amount)) {
        item.taxType = 'INCLUDED'
        return
    }
    // Fully derive taxType from current mode so switching the global toggle
    // (issue #26) also resets EXCLUDED items back to INCLUDED.
    if (taxMode.value === 'INCLUDED') {
        item.taxType = 'INCLUDED'
        return
    }
    // EXCLUDED: food 100-199 excluding alcohol is 8%, others 10%.
    if (isReducedTaxTarget(item)) {
        item.taxType = 'EXCLUDED_8'
    } else {
        item.taxType = 'EXCLUDED_10'
    }
}

// ユーザーが費目を手動変更したときは酒類フラグを落として税区分を再計算する (issue #61)
const onCategoryChange = (item) => {
    item.isAlcohol = false
    updateTaxType(item)
}

const applyTaxModeToAll = () => {
    items.value.forEach(updateTaxType)
}

const taxHintLabel = (hint) => {
    if (hint === 'included') return '税込'
    if (hint === 'excluded') return '税抜'
    if (hint === 'mixed') return '混在'
    return '不明'
}

const removeItem = (index) => {
    items.value.splice(index, 1)
}

const calculatedTotal = computed(() => {
    return items.value.reduce((sum, item) => {
        const amt = Number(item.amount || 0)
        if (!Number.isFinite(amt) || amt === 0) return sum
        if (amt < 0) return sum + amt
        // Check taxType assigned during analysis
        if (item.taxType === 'EXCLUDED_8') return sum + Math.floor(amt * 1.08)
        if (item.taxType === 'EXCLUDED_10') return sum + Math.floor(amt * 1.10)
        // Default INCLUDED or undefined
        return sum + amt
    }, 0)
})

const apply = () => {
    // Return items to parent to handle "Multi-record submit" logic
    // We treat all OCR items as "Splitter items" basically.
    // Parent logic currently expects { amount, total, items }. 
    // If OCR is used, "Main Form Amount" could be the first item, or we send EVERYTHING as splitter items?
    // Let's send everything as `items` in the same format ReceiptSplitter uses.
    
    emit('apply', {
        amount: 0, 
        total: calculatedTotal.value,
        items: items.value,
        date: detectedDate.value,
        store: detectedStore.value
    })
    emit('close')
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl p-6 h-[90vh] flex flex-col">
        <h3 class="text-lg font-bold mb-4 text-gray-700">レシート自動解析 (AI)</h3>
        
        <!-- Upload / Preview Area (issue #26) -->
        <div v-if="items.length === 0 && !isAnalyzing" class="flex-1 flex flex-col min-h-0 mb-4">
            <input type="file" ref="fileInput" @change="onFileChange" accept="image/*,application/pdf" class="hidden">

            <!-- No file selected: drop zone -->
            <div v-if="!selectedFile"
                 class="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-10 bg-gray-50 transition-colors"
                 :class="{ 'bg-blue-50 border-blue-400': isDragging }"
                 @dragover.prevent="isDragging = true"
                 @dragleave.prevent="isDragging = false"
                 @drop.prevent="onDrop"
            >
                <div class="text-center">
                    <button @click="$refs.fileInput.click()" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 mb-4">
                        画像・PDFを選択
                    </button>
                    <p class="text-gray-500 text-sm">またはファイルをドロップしてください</p>
                </div>
            </div>

            <!-- File selected: preview -->
            <div v-else class="flex-1 flex flex-col min-h-0">
                <div class="mb-2 flex items-center justify-between px-1">
                    <p class="font-bold text-gray-700 truncate">📄 {{ selectedFile.name }}</p>
                    <button @click="clearSelectedFile" class="text-red-500 hover:underline text-sm whitespace-nowrap ml-3">
                        別のファイルを選ぶ
                    </button>
                </div>
                <div class="flex-1 min-h-0 bg-gray-50 border rounded overflow-hidden">
                    <iframe v-if="previewKind === 'pdf'" :src="previewUrl" class="w-full h-full" title="PDF プレビュー"></iframe>
                    <img v-else-if="previewKind === 'image'" :src="previewUrl" class="w-full h-full object-contain bg-white" alt="画像プレビュー">
                    <div v-else class="w-full h-full flex flex-col items-center justify-center text-gray-400">
                        <div class="text-6xl mb-2">📄</div>
                        <div class="text-sm">プレビュー非対応の形式です</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Model Selection (Visible before analysis) -->
        <div v-if="!isAnalyzing && items.length === 0" class="mb-4 bg-gray-50 p-3 rounded flex items-center justify-end">
            <label class="text-sm font-bold text-gray-700 mr-2">モデル:</label>
            <select v-model="selectedModel" class="border rounded p-1 text-sm max-w-[200px]">
                <option v-for="model in availableModels" :key="model.id" :value="model.id">
                    {{ model.name.replace('Gemini ', '') }}
                </option>
            </select>
        </div>

        <!-- Loading -->
        <div v-if="isAnalyzing" class="flex-1 flex flex-col items-center justify-center px-4">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p class="text-gray-600 font-bold mb-1">{{ analyzeMessage }}</p>
            <p class="text-blue-500 font-semibold mb-3">経過時間: {{ elapsedSeconds }}秒</p>
            <p v-if="selectedModel && selectedModel.startsWith('cli:')" class="text-gray-400 text-sm text-center">Gemini CLIをご利用の場合、数秒から数十秒お待ちいただく場合があります。</p>
        </div>

        <!-- Result Editor -->
        <div v-if="items.length > 0" class="flex-1 overflow-hidden flex flex-col">
            <div class="mb-2 flex justify-between items-center">
                <h4 class="font-bold text-gray-600">解析結果の確認・修正</h4>
                <div class="text-sm text-gray-500">合計: {{ calculatedTotal.toLocaleString() }}</div>
            </div>

            <!-- Global tax toggle (issue #26): initialized from LLM's tax_included -->
            <div class="mb-3 bg-gray-50 p-2 rounded flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span class="font-bold text-gray-700">全体の税区分:</span>
                <label class="inline-flex items-center cursor-pointer">
                    <input type="radio" v-model="taxMode" value="INCLUDED" @change="applyTaxModeToAll" class="mr-1">
                    税込
                </label>
                <label class="inline-flex items-center cursor-pointer">
                    <input type="radio" v-model="taxMode" value="EXCLUDED" @change="applyTaxModeToAll" class="mr-1">
                    税抜 (食費8%/他10%)
                </label>
                <span v-if="detectedTaxHint" class="text-xs text-gray-500">
                    (AI 判定: {{ taxHintLabel(detectedTaxHint) }})
                </span>
                <span v-if="detectedTaxHint === 'mixed'" class="text-xs text-orange-600">
                    ※ 税込/税抜が混在の可能性。明細ごとに確認してください。
                </span>
            </div>

            <div class="mb-4 bg-gray-50 p-3 rounded flex space-x-4">
               <div class="flex-1">
                   <label class="block text-sm font-bold text-gray-700">日付</label>
                   <input type="date" v-model="detectedDate" class="border rounded p-1 w-full text-gray-700">
               </div>
               <div class="flex-1">
                   <label class="block text-sm font-bold text-gray-700">店名</label>
                   <input type="text" v-model="detectedStore" class="border rounded p-1 w-full text-gray-700" placeholder="スーパーABC">
               </div>
            </div>
            
            <div class="flex-1 overflow-y-auto border rounded bg-white">
                 <table class="w-full text-sm">
                    <thead class="bg-gray-100 sticky top-0">
                        <tr class="text-left text-gray-600 border-b">
                            <th class="p-2 w-40">費目</th>
                            <th class="p-2">品名</th>
                            <th class="p-2 w-24">金額</th>
                            <th class="p-2 w-10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(item, index) in items" :key="item.id" class="border-b hover:bg-gray-50">
                            <td class="p-2">
                                <select v-model="item.category_code" @change="onCategoryChange(item)" class="border rounded p-1 w-full">
                                    <option v-for="cat in categories" :key="cat.code" :value="cat.code">
                                        {{ cat.name }}
                                    </option>
                                </select>
                            </td>
                            <td class="p-2">
                                <input type="text" v-model="item.description" class="border rounded p-1 w-full">
                            </td>
                            <td class="p-2">
                                <input type="number" v-model="item.amount" @input="updateTaxType(item)" class="border rounded p-1 w-full text-right">
                            </td>
                            <td class="p-2 text-center">
                                <button @click="removeItem(index)" class="text-red-500 hover:text-red-700">×</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Footer Actions -->
        <div class="border-t pt-4 mt-4 flex justify-between">
            <button @click="items = []; selectedFile = null" v-if="items.length > 0" class="text-gray-500 hover:underline text-sm">
                別の画像を読み込む
            </button>
            <div v-else></div> <!-- Spacer -->

            <div class="flex space-x-3">
                <button @click="$emit('close')" class="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300">キャンセル</button>
                <button v-if="selectedFile && !isAnalyzing && items.length === 0" @click="analyze" class="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 font-bold">解析開始</button>
                <button v-if="items.length > 0" @click="apply" class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-bold">決定して反映</button>
            </div>
        </div>
    </div>
  </div>
</template>
