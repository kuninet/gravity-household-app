<script setup>
import { ref, computed } from 'vue'
import { checkReceipts } from '../api'
import { getFiscalMonth } from '../utils'

const emit = defineEmits(['prefill'])

const fileInput = ref(null)
const selectedFiles = ref([])
const selectedMonth = ref(getFiscalMonth(new Date()))
const isLoading = ref(false)
const errorMessage = ref('')
const result = ref(null)

const availableMonths = computed(() => {
    const today = new Date()
    const currentYear = today.getFullYear()
    const selectedYear = parseInt(selectedMonth.value.split('-')[0], 10) || currentYear

    const maxYear = Math.max(currentYear + 1, selectedYear)
    const minYear = Math.min(currentYear - 10, selectedYear)

    const months = []
    for (let y = maxYear; y >= minYear; y--) {
        for (let m = 12; m >= 1; m--) {
            const val = `${y}-${String(m).padStart(2, '0')}`
            months.push({ value: val, label: `${y}年${m}月` })
        }
    }
    return months
})

const onFileSelect = (e) => {
    selectedFiles.value = Array.from(e.target.files || [])
}

const triggerSelect = () => {
    fileInput.value?.click()
}

const canCheck = computed(() => selectedFiles.value.length > 0 && !isLoading.value)

// aria-live で読み上げる状態文言
const statusMessage = computed(() => {
    if (isLoading.value) return '照合中です。しばらくお待ちください。'
    if (errorMessage.value) return errorMessage.value
    if (result.value) return '照合が完了しました。'
    return ''
})

const runCheck = async () => {
    if (selectedFiles.value.length === 0) {
        errorMessage.value = 'ファイルを選択してください。'
        return
    }
    isLoading.value = true
    errorMessage.value = ''
    try {
        const fileNames = selectedFiles.value.map((f) => f.name)
        const data = await checkReceipts({ fileNames, month: selectedMonth.value })
        result.value = data
    } catch (e) {
        result.value = null
        errorMessage.value = e.message || '照合に失敗しました。'
    } finally {
        isLoading.value = false
    }
}

const registerFromMissing = (item) => {
    emit('prefill', { date: item.date, memo: item.store })
}

const fmtYen = (n) => `¥${Number(n || 0).toLocaleString()}`
</script>

<template>
  <div class="animate-fade-in">
    <div class="bg-surface border border-rule rounded-xl p-5 mb-6">
      <div class="flex items-baseline gap-2 mb-1">
        <h2 class="text-[14px] font-semibold text-ink m-0">レシート照合</h2>
        <span class="text-[10px] tracking-[0.14em] uppercase text-ink-3 font-semibold">RECEIPT CHECK</span>
      </div>
      <p class="text-[12px] text-ink-2 mb-4">
        レシート画像ファイルを選択すると、ファイル名の日付と店名から登録漏れを検査します。画像は送信されず、ファイル名だけを使います。
      </p>

      <div class="flex flex-col md:flex-row md:items-end gap-3">
        <div class="flex-1">
          <label for="receipt-check-file-input" class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">レシートファイル</label>
          <input
            id="receipt-check-file-input"
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onFileSelect"
          >
          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="triggerSelect"
              class="bg-accent-soft hover:bg-accent hover:text-white text-accent px-3 py-2 rounded-md text-[12px] font-semibold transition"
            >
              ファイルを選択
            </button>
            <span class="text-[12px] text-ink-2">
              {{ selectedFiles.length > 0 ? `${selectedFiles.length} 件のファイルを選択中` : '未選択' }}
            </span>
          </div>
        </div>

        <div>
          <label for="receipt-check-month-select" class="block text-[10px] tracking-[0.12em] uppercase text-ink-3 font-semibold mb-1">対象会計月</label>
          <select
            id="receipt-check-month-select"
            v-model="selectedMonth"
            data-testid="receipt-check-month"
            class="border border-rule bg-surface text-ink p-2 rounded-md text-[13px] focus:outline-none focus:border-accent"
          >
            <option value="">ファイルの日付から自動</option>
            <option v-for="m in availableMonths" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>

        <button
          type="button"
          @click="runCheck"
          :disabled="!canCheck"
          class="bg-accent text-white py-2.5 px-5 rounded-md font-semibold text-[13px] disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <span v-if="isLoading">照合中...</span>
          <span v-else>照合する</span>
        </button>
      </div>

      <p v-if="errorMessage" class="mt-3 text-[12px] text-neg">{{ errorMessage }}</p>
      <p class="sr-only" role="status" aria-live="polite">{{ statusMessage }}</p>
    </div>

    <!-- Results（照合中は前回の結果を残したまま aria-busy で示す） -->
    <div v-if="result || isLoading" :aria-busy="isLoading ? 'true' : 'false'">
      <div v-if="!result && isLoading" class="bg-surface border border-rule rounded-xl p-4 text-[12px] text-ink-3">
        照合中...
      </div>
      <template v-else-if="result">
      <!-- Summary -->
      <div data-testid="receipt-check-summary" class="bg-surface border border-rule rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
        <div>
          <div class="text-[10px] tracking-[0.1em] uppercase text-ink-3 font-semibold">登録済み</div>
          <div class="text-[18px] font-semibold text-ink font-mono font-tabular">{{ result.summary.matched }}</div>
        </div>
        <div>
          <div class="text-[10px] tracking-[0.1em] uppercase text-ink-3 font-semibold">入れ忘れ候補</div>
          <div class="text-[18px] font-semibold font-mono font-tabular" :class="result.summary.missing > 0 ? 'text-neg' : 'text-ink'">{{ result.summary.missing }}</div>
        </div>
        <div>
          <div class="text-[10px] tracking-[0.1em] uppercase text-ink-3 font-semibold">対象外</div>
          <div class="text-[18px] font-semibold text-ink font-mono font-tabular">{{ result.summary.outOfRange }}</div>
        </div>
        <div>
          <div class="text-[10px] tracking-[0.1em] uppercase text-ink-3 font-semibold">DB にのみ存在</div>
          <div class="text-[18px] font-semibold text-ink font-mono font-tabular">{{ result.summary.dbOnly }}</div>
        </div>
        <div>
          <div class="text-[10px] tracking-[0.1em] uppercase text-ink-3 font-semibold">解析不能</div>
          <div class="text-[18px] font-semibold text-ink font-mono font-tabular">{{ result.summary.unparsed }}</div>
        </div>
        <div>
          <div class="text-[10px] tracking-[0.1em] uppercase text-ink-3 font-semibold">店名なし</div>
          <div class="text-[18px] font-semibold text-ink font-mono font-tabular">{{ result.summary.noMemo }}</div>
        </div>
      </div>

      <!-- 入れ忘れ候補 -->
      <div class="bg-surface border border-rule rounded-xl p-4 mb-6">
        <h3 class="text-[13px] font-semibold text-ink mb-2">入れ忘れ候補</h3>
        <p v-if="result.summary.noMemo > 0 && result.missing.length > 0" class="text-[11px] text-ink-3 mb-2">
          （店名なし取引 {{ result.summary.noMemo }} 件は照合対象外のため、誤検出の可能性があります）
        </p>
        <div v-if="result.missing.length === 0" class="text-[12px] text-ink-3">（該当なし）</div>
        <div v-else data-testid="receipt-check-missing" class="overflow-x-auto">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-ink-3 border-b border-rule text-left">
                <th class="py-1.5 font-semibold">日付</th>
                <th class="py-1.5 font-semibold">店名</th>
                <th class="py-1.5 font-semibold">ファイル名</th>
                <th class="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in result.missing" :key="`${item.date}-${item.filename}-${index}`" class="border-b border-rule-soft last:border-0">
                <td class="py-1.5 font-mono font-tabular text-ink">{{ item.date }}</td>
                <td class="py-1.5 text-ink">{{ item.store }}</td>
                <td class="py-1.5 text-ink-3 truncate max-w-[220px]">{{ item.filename }}</td>
                <td class="py-1.5 text-right">
                  <button
                    type="button"
                    @click="registerFromMissing(item)"
                    class="bg-accent-soft hover:bg-accent hover:text-white text-accent px-2.5 py-1 rounded-md text-[11px] font-semibold transition"
                  >
                    登録する
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 登録済み -->
      <div class="bg-surface border border-rule rounded-xl p-4 mb-6">
        <h3 class="text-[13px] font-semibold text-ink mb-2">登録済み</h3>
        <div v-if="result.matched.length === 0" class="text-[12px] text-ink-3">（該当なし）</div>
        <div v-else data-testid="receipt-check-matched" class="overflow-x-auto">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-ink-3 border-b border-rule text-left">
                <th class="py-1.5 font-semibold">日付</th>
                <th class="py-1.5 font-semibold">店名</th>
                <th class="py-1.5 font-semibold">ファイル名</th>
                <th class="py-1.5 font-semibold text-right">一致した取引</th>
                <th class="py-1.5 font-semibold">警告</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in result.matched" :key="`${item.date}-${item.filename}-${index}`" class="border-b border-rule-soft last:border-0">
                <td class="py-1.5 font-mono font-tabular text-ink">{{ item.date }}</td>
                <td class="py-1.5 text-ink">{{ item.store }}</td>
                <td class="py-1.5 text-ink-3 truncate max-w-[220px]">{{ item.filename }}</td>
                <td class="py-1.5 text-right font-mono font-tabular text-ink">{{ item.transactionCount }}件 合計{{ fmtYen(item.totalAmount) }}</td>
                <td class="py-1.5 text-ink-3">{{ item.warning }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 対象外 -->
      <div class="bg-surface border border-rule rounded-xl p-4 mb-6">
        <h3 class="text-[13px] font-semibold text-ink mb-2">対象外（別会計月）</h3>
        <div v-if="result.outOfRange.length === 0" class="text-[12px] text-ink-3">（該当なし）</div>
        <div v-else data-testid="receipt-check-out-of-range" class="overflow-x-auto">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-ink-3 border-b border-rule text-left">
                <th class="py-1.5 font-semibold">日付</th>
                <th class="py-1.5 font-semibold">ファイル名</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in result.outOfRange" :key="`${item.date}-${item.filename}-${index}`" class="border-b border-rule-soft last:border-0">
                <td class="py-1.5 font-mono font-tabular text-ink">{{ item.date }}</td>
                <td class="py-1.5 text-ink-3">{{ item.filename }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- DB にのみ存在 -->
      <div class="bg-surface border border-rule rounded-xl p-4 mb-6">
        <h3 class="text-[13px] font-semibold text-ink mb-2">DB にのみ存在</h3>
        <div v-if="result.dbOnly.length === 0" class="text-[12px] text-ink-3">（該当なし）</div>
        <div v-else data-testid="receipt-check-db-only" class="overflow-x-auto">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-ink-3 border-b border-rule text-left">
                <th class="py-1.5 font-semibold">日付</th>
                <th class="py-1.5 font-semibold">メモ</th>
                <th class="py-1.5 font-semibold text-right">件数</th>
                <th class="py-1.5 font-semibold text-right">合計金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in result.dbOnly" :key="`${item.date}-${item.memo}-${index}`" class="border-b border-rule-soft last:border-0">
                <td class="py-1.5 font-mono font-tabular text-ink">{{ item.date }}</td>
                <td class="py-1.5 text-ink">{{ item.memo }}</td>
                <td class="py-1.5 text-right font-mono font-tabular text-ink">{{ item.count }}件</td>
                <td class="py-1.5 text-right font-mono font-tabular text-ink">{{ fmtYen(item.totalAmount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 解析不能ファイル -->
      <div class="bg-surface border border-rule rounded-xl p-4">
        <h3 class="text-[13px] font-semibold text-ink mb-2">解析不能ファイル</h3>
        <div v-if="result.unparsed.length === 0" class="text-[12px] text-ink-3">（該当なし）</div>
        <ul v-else data-testid="receipt-check-unparsed" class="text-[12px] text-ink-3 space-y-1">
          <li v-for="(name, index) in result.unparsed" :key="`${name}-${index}`">{{ name }}</li>
        </ul>
      </div>
      </template>
    </div>
  </div>
</template>
