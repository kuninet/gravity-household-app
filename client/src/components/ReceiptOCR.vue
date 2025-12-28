<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  show: Boolean,
  categories: {
      type: Array,
      default: () => []
  }
})

const emit = defineEmits(['close', 'apply'])

const fileInput = ref(null)
const selectedFile = ref(null)
const isAnalyzing = ref(false)
const items = ref([]) // { id, description, amount, category_code, taxType }
const totalAmount = ref(0)
let nextId = 1

const taxMode = ref('INCLUDED') // INCLUDED or EXCLUDED
const isDragging = ref(false)

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
    
    const formData = new FormData()
    formData.append('image', selectedFile.value)

    try {
        const res = await fetch('/api/ocr/analyze', {
            method: 'POST',
            body: formData
        })
        if (!res.ok) throw new Error('Analysis failed')
        const data = await res.json()
        
        // Map to internal format
        if (data.items) {
            items.value = data.items.map(item => {
                // Smart Tax Logic
                // Default category 100 (Food)
                const categoryCode = 100;
                let finalTaxType = 'INCLUDED';

                if (taxMode.value === 'EXCLUDED') {
                    // If Food (100-199), use 8%, otherwise 10%
                    if (categoryCode >= 100 && categoryCode < 200) {
                        finalTaxType = 'EXCLUDED_8';
                    } else {
                        finalTaxType = 'EXCLUDED_10';
                    }
                }
                
                return {
                    id: nextId++,
                    description: item.description,
                    amount: item.amount,
                    category_code: categoryCode, 
                    taxType: finalTaxType
                }
            })
        }
    } catch (e) {
        alert('解析に失敗しました: ' + e.message)
    } finally {
        isAnalyzing.value = false
    }
}

const removeItem = (index) => {
    items.value.splice(index, 1)
}

const calculatedTotal = computed(() => {
    return items.value.reduce((sum, item) => {
        const amt = Number(item.amount || 0)
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
        amount: 0, // Main amount is 0 if everything is in items
        total: calculatedTotal.value,
        items: items.value
    })
    emit('close')
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl p-6 h-[90vh] flex flex-col">
        <h3 class="text-lg font-bold mb-4 text-gray-700">レシート自動解析 (AI)</h3>
        
        <!-- Upload Area -->
        <div v-if="items.length === 0 && !isAnalyzing" 
             class="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-10 bg-gray-50 transition-colors"
             :class="{ 'bg-blue-50 border-blue-400': isDragging }"
             @dragover.prevent="isDragging = true"
             @dragleave.prevent="isDragging = false"
             @drop.prevent="onDrop"
        >
            <input type="file" ref="fileInput" @change="onFileChange" accept="image/*,application/pdf" class="hidden">
            
            <div v-if="!selectedFile" class="text-center">
                <button @click="$refs.fileInput.click()" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 mb-4">
                    画像・PDFを選択
                </button>
                <p class="text-gray-500 text-sm">またはファイルをドロップしてください</p>
            </div>
            
            <div v-else class="text-center">
                <div class="text-4xl mb-3">📄</div>
                <p class="font-bold text-gray-700 mb-4">{{ selectedFile.name }}</p>
                <button @click="selectedFile = null; $refs.fileInput.value = ''" class="text-red-500 hover:underline text-sm">
                    キャンセル
                </button>
            </div>
        </div>
        
        <!-- Tax Mode Setting (Visible before analysis) -->
        <div v-if="!isAnalyzing && items.length === 0" class="mb-4 bg-gray-50 p-3 rounded text-center">
            <span class="text-sm font-bold text-gray-700 mr-2">読み取る金額は:</span>
            <label class="inline-flex items-center mr-4 cursor-pointer">
                <input type="radio" v-model="taxMode" value="INCLUDED" class="mr-1">
                <span>税込</span>
            </label>
            <label class="inline-flex items-center cursor-pointer">
                <input type="radio" v-model="taxMode" value="EXCLUDED" class="mr-1">
                <span>税抜 (食費8%/他10%で自動計算)</span>
            </label>
        </div>

        <!-- Loading -->
        <div v-if="isAnalyzing" class="flex-1 flex flex-col items-center justify-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p class="text-gray-600 font-bold">AI解析中...</p>
        </div>

        <!-- Result Editor -->
        <div v-if="items.length > 0" class="flex-1 overflow-hidden flex flex-col">
            <div class="mb-2 flex justify-between items-center">
                <h4 class="font-bold text-gray-600">解析結果の確認・修正</h4>
                <div class="text-sm text-gray-500">合計: {{ calculatedTotal.toLocaleString() }}</div>
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
                                <select v-model="item.category_code" class="border rounded p-1 w-full">
                                    <option v-for="cat in categories" :key="cat.code" :value="cat.code">
                                        {{ cat.name }}
                                    </option>
                                </select>
                            </td>
                            <td class="p-2">
                                <input type="text" v-model="item.description" class="border rounded p-1 w-full">
                            </td>
                            <td class="p-2">
                                <input type="number" v-model="item.amount" class="border rounded p-1 w-full text-right">
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
