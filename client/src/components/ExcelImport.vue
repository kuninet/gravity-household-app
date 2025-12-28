<script setup>
import { ref, computed } from 'vue'

const fileInput = ref(null)
const restoreInput = ref(null)
const showModal = ref(false)
const phase = ref('idle') // idle, analyzing, confirm, executing, complete, error
const analysis = ref(null) // { token, summary }
const result = ref(null)
const error = ref(null)
const progressMessage = ref('')
const targetYear = ref('all')

const onRestoreSelect = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!confirm('【警告】\nこの操作を行うと、現在登録されている「すべてのデータ」が消去され、CSVの内容で上書きされます。\n\n本当によろしいですか？')) {
        restoreInput.value.value = ''
        return
    }

    const formData = new FormData()
    formData.append('file', file)
    
    // Using existing modal logic slightly hacked or just simple alert? 
    // Let's use simple alert loop since Restore is specific.
    try {
        const res = await fetch('/api/backup/restore', {
             method: 'POST',
             body: formData
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Restore failed')
        
        alert(`復元が完了しました。\nレコード件数: ${data.count}件`)
        window.location.reload() // Reload to reflect changes
    } catch (e) {
        alert('エラーが発生しました: ' + e.message)
    } finally {
        restoreInput.value.value = ''
    }
}

const availableYears = computed(() => {
    if (!analysis.value) return []
    const years = new Set()
    analysis.value.daily.forEach(d => years.add(d.year))
    analysis.value.fixed.forEach(f => years.add(f.year))
    return Array.from(years).sort().reverse()
})

const filteredAnalysis = computed(() => {
    if (!analysis.value) return { daily: [], fixed: [] }
    if (targetYear.value === 'all') return analysis.value
    return {
        daily: analysis.value.daily.filter(d => d.year === targetYear.value),
        fixed: analysis.value.fixed.filter(f => f.year === targetYear.value)
    }
})

const triggerSelect = () => {
    fileInput.value.click()
}

const onFileSelect = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    showModal.value = true
    phase.value = 'analyzing'
    error.value = null
    analysis.value = null
    progressMessage.value = '準備中...'

    const formData = new FormData()
    formData.append('file', file)

    try {
        const res = await fetch('/api/import/analyze', {
            method: 'POST',
            body: formData
        })

        if (!res.ok) throw new Error('解析に失敗しました')

        // Stream reader for progress
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                // Determine if there is leftover in buffer
                if (buffer.trim()) {
                     try {
                        const data = JSON.parse(buffer)
                        handleStreamData(data)
                     } catch(e) {}
                }
                break
            }
            
            // Decode with stream: true
            buffer += decoder.decode(value, { stream: true })
            
            // Process complete lines
            const lines = buffer.split('\n')
            // keep the last part in buffer
            buffer = lines.pop() 
            
            for (const line of lines) {
                if (line.trim() === '') continue
                try {
                    const data = JSON.parse(line)
                    handleStreamData(data)
                } catch (e) {
                     // console.error('JSON parse error', e, line)
                }
            }
        }
    } catch (e) {
        error.value = e.message
        phase.value = 'error'
    } finally {
        fileInput.value.value = ''
    }
}

const handleStreamData = (data) => {
    if (data.type === 'progress') {
        progressMessage.value = data.message
    } else if (data.type === 'complete') {
        // Flatten structure for template compatibility
        analysis.value = {
            token: data.data.token,
            daily: data.data.summary.daily,
            fixed: data.data.summary.fixed
        }
        phase.value = 'confirm'
    } else if (data.type === 'error') {
        throw new Error(data.error)
    }
}

const executeImport = async () => {
    if (!analysis.value || !analysis.value.token) return
    phase.value = 'executing'
    progressMessage.value = 'インポート準備中...'

    try {
        const res = await fetch('/api/import/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                token: analysis.value.token,
                targetYear: targetYear.value === 'all' ? null : targetYear.value
            })
        })

        if (!res.ok) throw new Error('インポート実行に失敗しました')

        // Stream reader
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                 if (buffer.trim()) {
                     try {
                        const data = JSON.parse(buffer)
                        handleStreamDataForExecute(data)
                     } catch(e) {}
                 }
                 break
            }
            
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()

            for (const line of lines) {
                if (line.trim() === '') continue
                try {
                    const data = JSON.parse(line)
                    handleStreamDataForExecute(data)
                } catch (e) {
                     // console.error('Parse error', e)
                }
            }
        }
    } catch (e) {
        error.value = e.message
        phase.value = 'error'
    }
}

const handleStreamDataForExecute = (data) => {
    if (data.type === 'progress') {
        progressMessage.value = data.message
    } else if (data.type === 'complete') {
        result.value = data
        phase.value = 'complete'
    } else if (data.type === 'error') {
        throw new Error(data.error)
    }
}

const cancelImport = () => {
    showModal.value = false
    phase.value = 'idle'
    analysis.value = null
    targetYear.value = 'all'
}

const closeModal = () => {
    showModal.value = false
    phase.value = 'idle'
    result.value = null
    error.value = null
    targetYear.value = 'all'
}
</script>

<template>
  <div class="animate-fade-in relative">
    <h2 class="text-xl font-bold text-gray-700 mb-6 font-mono">データ管理 (エクスポート・インポート)</h2>

    <div class="max-w-2xl mx-auto space-y-8">
        
        <!-- Full Backup / Restore Section -->
        <div class="bg-white p-6 rounded shadow">
            <h3 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">📦 フルバックアップ・復元</h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Export -->
                <div class="bg-blue-50 p-4 rounded text-center">
                    <h4 class="font-bold text-blue-800 mb-2">バックアップ (エクスポート)</h4>
                    <p class="text-sm text-blue-600 mb-4">
                        現在の全データをCSV形式(SJIS)でダウンロードします。
                    </p>
                    <a href="/api/backup/export" target="_blank" class="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-bold text-sm">
                        ダウンロード
                    </a>
                </div>

                <!-- Restore -->
                <div class="bg-red-50 p-4 rounded text-center">
                    <h4 class="font-bold text-red-800 mb-2">復元 (リストア)</h4>
                    <p class="text-sm text-red-600 mb-4">
                        バックアップCSVを取り込み、<br>
                        <span class="font-bold underline">現在のデータを全て消去して</span>復元します。
                    </p>
                    <input type="file" ref="restoreInput" accept=".csv" class="hidden" @change="onRestoreSelect">
                    <button @click="$refs.restoreInput.click()" class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 font-bold text-sm">
                        ファイルを選択して復元
                    </button>
                </div>
            </div>
        </div>

        <!-- Existing Excel Import Section -->
        <div class="bg-white p-6 rounded shadow relative">
            <h3 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">📊 Excelデータ追加・更新 (テンプレート)</h3>
            <div class="text-center">
                <div class="mb-6 text-gray-600 text-left text-sm max-w-lg mx-auto bg-gray-50 p-4 rounded">
                    <p class="mb-2 font-bold">特定のフォーマットのExcelファイルを取り込みます。</p>
                    <ul class="list-disc list-inside space-y-1 ml-2">
                        <li>日々の記録シート: シート名「yyyy年m月」</li>
                        <li>固定費シート: シート名「yyyy年公共料金等」</li>
                    </ul>
                </div>

                <input 
                    type="file" 
                    ref="fileInput" 
                    class="hidden" 
                    accept=".xlsx, .xls"
                    @change="onFileSelect"
                />

                <button 
                    @click="triggerSelect" 
                    class="bg-green-600 text-white px-8 py-3 rounded-lg font-bold shadow hover:bg-green-700 transition"
                >
                    Excelファイルを選択
                </button>
            </div>
        </div>
    </div>

    <!-- Modal Overlay -->
    <div v-if="showModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in">
        <div class="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full text-center max-h-[90vh] overflow-y-auto">
            
            <!-- Phase 1: Analyzing (Scanning) -->
            <div v-if="phase === 'analyzing'">
                <div class="animate-spin text-4xl mb-4">⚙️</div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">ファイル解析中...</h3>
                <p class="text-blue-600 font-bold mb-2">{{ progressMessage }}</p>
                <p class="text-gray-600 text-sm">データの概要を確認しています。</p>
            </div>

            <!-- Phase 2: Confirmation -->
            <div v-else-if="phase === 'confirm'">
                <h3 class="text-xl font-bold text-gray-800 mb-4">インポート内容の確認</h3>
                
                <!-- Year Selection -->
                <div v-if="availableYears.length > 0" class="mb-4 text-left">
                     <label class="block text-sm font-bold text-gray-700 mb-1">インポート対象:</label>
                     <select v-model="targetYear" class="w-full border p-2 rounded bg-white">
                        <option value="all">すべてのデータ</option>
                        <option v-for="y in availableYears" :key="y" :value="y">{{ y }}年のみ</option>
                     </select>
                </div>

                <div v-if="analysis && (filteredAnalysis.daily.length > 0 || filteredAnalysis.fixed.length > 0)" class="text-left bg-gray-50 p-4 rounded mb-4">
                    <p class="mb-2 font-bold text-red-600">⚠️ 以下の期間のデータは上書き（削除）されます</p>
                    <div class="overflow-y-auto max-h-48 text-sm">
                        <table class="w-full">
                            <thead>
                                <tr class="text-gray-500 border-b">
                                    <th class="pb-1">対象シート・年月</th>
                                    <th class="pb-1 text-right">件数</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="item in filteredAnalysis.daily" :key="item.sheet" class="border-b last:border-0">
                                    <td class="py-1">{{ item.year }}年{{ item.month }}月</td>
                                    <td class="py-1 text-right">{{ item.count }} 件</td>
                                </tr>
                                <tr v-for="item in filteredAnalysis.fixed" :key="item.sheet" class="border-b last:border-0 bg-yellow-50">
                                    <td class="py-1">{{ item.year }}年 (固定費)</td>
                                    <td class="py-1 text-right">上書き</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div v-else class="bg-yellow-100 p-4 rounded mb-4 text-yellow-800">
                    有効なデータが見つかりませんでした。
                </div>

                <div class="flex gap-4 justify-center">
                    <button @click="cancelImport" class="px-6 py-2 rounded border hover:bg-gray-100">キャンセル</button>
                    <button 
                        v-if="analysis && (filteredAnalysis.daily.length > 0 || filteredAnalysis.fixed.length > 0)"
                        @click="executeImport" 
                        class="bg-red-600 text-white px-6 py-2 rounded font-bold hover:bg-red-700 shadow"
                    >
                        実行する
                    </button>
                </div>
            </div>

            <!-- Phase 3: Executing (Progress) -->
            <div v-else-if="phase === 'executing'">
                <div class="animate-spin text-4xl mb-4">📥</div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">インポート実行中</h3>
                <p class="text-blue-600 font-bold mb-2">{{ progressMessage }}</p>
                <p class="text-gray-500 text-xs mb-4">ブラウザを閉じないでください</p>
            </div>

            <!-- Phase 4: Complete -->
            <div v-else-if="phase === 'complete'">
                <div class="text-4xl mb-4 text-green-500">✅</div>
                <h3 class="text-xl font-bold text-gray-800 mb-4">インポート完了</h3>
                <div class="bg-gray-100 p-4 rounded text-left mb-6 font-mono text-sm">
                    <p>日々の記録: <span class="font-bold">{{ result.results.daily }}</span> 件</p>
                    <p>固定費データ: <span class="font-bold">{{ result.results.fixed }}</span> 件</p>
                </div>
                <button @click="closeModal" class="bg-blue-600 text-white px-6 py-2 rounded shadow hover:bg-blue-700 transition">
                    閉じる
                </button>
            </div>

            <!-- Error State -->
            <div v-else-if="phase === 'error'">
                <div class="text-4xl mb-4 text-red-500">⚠️</div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">エラーが発生しました</h3>
                <div class="bg-red-50 text-red-800 p-4 rounded text-left mb-6 text-sm break-words">
                    {{ error }}
                </div>
                <button @click="closeModal" class="bg-gray-500 text-white px-6 py-2 rounded shadow hover:bg-gray-600 transition">
                    閉じる
                </button>
            </div>

        </div>
    </div>
  </div>
</template>
