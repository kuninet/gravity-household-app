<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { addSalaryEntry, updateSalaryEntry, deleteSalaryEntry } from '../api'

const props = defineProps({
    year: { type: Number, required: true },
    // '01' 〜 '12' の 0 埋め文字列 (fiscal_month の月部分)
    month: { type: String, required: true },
    categoryName: { type: String, default: '' },
    // [{ id, amount, description }] — 親側で id 昇順にソート済みの想定
    entries: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'saved'])

const DEFAULT_DESCRIPTION = '給与(固定入力)'

// モーダル本体の ref。追加行への autofocus 時に amount input を探すのに使う。
const modalBody = ref(null)

// 内部編集用ドラフト。親側の配列を変更しないよう deep copy し、行毎に編集メタを持たせる。
// _new: この UI 内で追加した行 (id === null)
// _dirty: 既存行を編集した (amount または description が変わった)
// _deleted: 既存行を削除マークした (保存時に DELETE)
const draft = ref(
    props.entries.map((e) => ({
        id: e.id,
        amount: e.amount,
        description: e.description || '',
        _new: false,
        _dirty: false,
        _deleted: false,
    }))
)

const saving = ref(false)

// 削除済みは合計/件数から除外
const visibleRows = computed(() => draft.value.filter((r) => !r._deleted))

const totalAmount = computed(() =>
    visibleRows.value.reduce((s, r) => s + (Number(r.amount) || 0), 0)
)

const monthLabel = computed(() => Number(props.month))

const addRow = async () => {
    draft.value.push({
        id: null,
        amount: '',
        description: DEFAULT_DESCRIPTION,
        _new: true,
        _dirty: false,
        _deleted: false,
    })
    // 追加行 (末尾) の amount input にフォーカスを飛ばす
    await nextTick()
    if (modalBody.value) {
        const inputs = modalBody.value.querySelectorAll('input[data-role="salary-amount"]')
        const last = inputs[inputs.length - 1]
        if (last) last.focus()
    }
}

const removeRow = (row) => {
    if (row._new) {
        // 新規行は配列からそのまま除去 (API に送るものが無いので)
        const idx = draft.value.indexOf(row)
        if (idx !== -1) draft.value.splice(idx, 1)
    } else {
        // 既存行は削除に確認を挟む (保存時点で不可逆になるため)
        if (!window.confirm('この明細を削除しますか？（保存すると元に戻せません）')) return
        row._deleted = true
    }
}

// draft に「未保存」変更が 1 件でもあるか判定 (close 時の確認に使う)
const hasUnsavedChanges = () => {
    return draft.value.some((r) => r._new || r._dirty || r._deleted)
}

const onAmountInput = (row, event) => {
    // 数字以外を弾いて数値化 (カンマ/円記号を貼り付けても救う)
    const cleaned = String(event.target.value).replace(/[^0-9]/g, '')
    row.amount = cleaned === '' ? '' : Number(cleaned)
    row._dirty = true
    event.target.value = cleaned
}

const onDescriptionInput = (row) => {
    row._dirty = true
}

const close = () => {
    if (saving.value) return
    if (hasUnsavedChanges()) {
        if (!window.confirm('未保存の変更があります。破棄しますか？')) return
    }
    emit('close')
}

const onBackdropClick = (event) => {
    // 背景 (自分自身) クリックのみで閉じる。内側 (モーダル本体) クリックは無視。
    if (event.target === event.currentTarget) close()
}

const onKeydown = (event) => {
    if (event.key === 'Escape') close()
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
})

const validateBeforeSave = () => {
    // 保存対象 (削除対象を除く) の amount チェック
    for (const row of draft.value) {
        if (row._deleted) continue
        const n = Number(row.amount)
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
            alert('金額は 1 以上の整数で入力してください。空欄・0・小数は保存できません。')
            return false
        }
    }
    return true
}

const onSave = async () => {
    if (saving.value) return
    if (!validateBeforeSave()) return

    saving.value = true
    // 途中経過の失敗を集約する。1 件でもあれば emit を抑止してモーダルを開いたままにする。
    const errors = []
    // 削除に成功した行は draft から取り除くために index を集める
    const deletedIndexes = []

    try {
        // 1) 既存行の削除 (id あり、削除マーク、新規ではない)
        for (let i = 0; i < draft.value.length; i++) {
            const row = draft.value[i]
            if (!(row._deleted && !row._new && row.id)) continue
            try {
                await deleteSalaryEntry(row.id)
                deletedIndexes.push(i)
            } catch (e) {
                console.error('deleteSalaryEntry failed', e)
                errors.push(`削除 (id=${row.id}) に失敗しました: ${e.message}`)
            }
        }

        // 2) 既存行の更新 (id あり、編集済み、削除でも新規でもない)
        for (const row of draft.value) {
            if (!(row._dirty && !row._new && !row._deleted && row.id)) continue
            try {
                // description の空欄はサーバー側 normalizeSalaryDescription にフォールバックさせる
                await updateSalaryEntry(row.id, {
                    amount: Number(row.amount),
                    description: row.description ?? '',
                })
                row._dirty = false
            } catch (e) {
                console.error('updateSalaryEntry failed', e)
                errors.push(`更新 (id=${row.id}) に失敗しました: ${e.message}`)
            }
        }

        // 3) 新規行の追加 (id なし、削除されていない)
        for (const row of draft.value) {
            if (!(row._new && !row._deleted)) continue
            try {
                const result = await addSalaryEntry({
                    year: props.year,
                    month: Number(props.month),
                    amount: Number(row.amount),
                    description: row.description ?? '',
                })
                row.id = result.id
                row._new = false
                row._dirty = false
            } catch (e) {
                console.error('addSalaryEntry failed', e)
                errors.push(`追加に失敗しました: ${e.message}`)
            }
        }

        // 削除に成功した行を draft から取り除く (後ろから splice すれば index が崩れない)
        for (let i = deletedIndexes.length - 1; i >= 0; i--) {
            draft.value.splice(deletedIndexes[i], 1)
        }

        if (errors.length > 0) {
            // 部分失敗: state 不整合を親に流さないため emit せず、モーダルを開いたままにする
            alert(
                `${errors.length} 件の操作が失敗しました。もう一度保存してください。\n\n` +
                errors.join('\n')
            )
            return
        }

        // 全件成功: 最新スナップショットを親に返して閉じる
        const updatedEntries = draft.value
            .filter((row) => row.id && !row._deleted)
            .map((row) => ({
                id: row.id,
                amount: Number(row.amount),
                description: row.description || DEFAULT_DESCRIPTION,
            }))
            .sort((a, b) => a.id - b.id)

        emit('saved', updatedEntries)
        emit('close')
    } finally {
        saving.value = false
    }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
    @click="onBackdropClick"
    role="dialog"
    aria-modal="true"
    aria-labelledby="salary-modal-title"
  >
    <div ref="modalBody" class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 mx-4">
        <div class="flex items-center justify-between mb-4">
            <h3 id="salary-modal-title" class="text-lg font-bold text-gray-700">
                {{ year }}年 {{ monthLabel }}月 {{ categoryName }}明細
            </h3>
            <button
                @click="close"
                :disabled="saving"
                class="text-gray-400 hover:text-gray-600 disabled:opacity-50 text-2xl leading-none"
                aria-label="閉じる"
            >×</button>
        </div>

        <div class="mb-4">
            <div v-if="visibleRows.length === 0" class="text-sm text-gray-500 py-4 text-center border rounded bg-gray-50">
                明細がありません。下の「＋ 明細を追加」から追加してください。
            </div>

            <table v-else class="w-full text-sm border-collapse">
                <thead>
                    <tr class="text-left text-gray-500 border-b">
                        <th class="p-2 w-40">金額</th>
                        <th class="p-2">説明</th>
                        <th class="p-2 w-10"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, index) in draft" v-show="!row._deleted" :key="row.id ?? `new-${index}`" class="border-b">
                        <td class="p-2">
                            <input
                                type="text"
                                inputmode="numeric"
                                :value="row.amount === '' || row.amount == null ? '' : String(row.amount)"
                                @input="onAmountInput(row, $event)"
                                placeholder="0"
                                data-role="salary-amount"
                                class="w-full border rounded p-2 text-right font-mono"
                            />
                        </td>
                        <td class="p-2">
                            <input
                                type="text"
                                v-model="row.description"
                                @input="onDescriptionInput(row)"
                                :placeholder="'給与(固定入力)'"
                                class="w-full border rounded p-2"
                                maxlength="200"
                            />
                        </td>
                        <td class="p-2 text-center">
                            <button
                                @click="removeRow(row)"
                                :disabled="saving"
                                class="text-red-500 hover:text-red-700 font-bold text-lg disabled:opacity-50"
                                aria-label="削除"
                                title="この明細を削除"
                            >×</button>
                        </td>
                    </tr>
                </tbody>
            </table>

            <button
                @click="addRow"
                :disabled="saving"
                class="mt-3 text-blue-600 text-sm hover:underline font-bold disabled:opacity-50"
            >+ 明細を追加</button>
        </div>

        <div class="flex items-center justify-between border-t pt-4">
            <div class="text-sm text-gray-600">
                合計:
                <span class="font-mono font-bold text-gray-800 ml-1">
                    ¥{{ totalAmount.toLocaleString() }}
                </span>
                <span class="ml-2 text-gray-500">({{ visibleRows.length }} 件)</span>
            </div>
            <div class="flex items-center space-x-2">
                <span v-if="saving" class="text-xs text-gray-500">保存中...</span>
                <button
                    @click="close"
                    :disabled="saving"
                    class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
                >キャンセル</button>
                <button
                    @click="onSave"
                    :disabled="saving"
                    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-bold"
                >保存</button>
            </div>
        </div>
    </div>
  </div>
</template>
