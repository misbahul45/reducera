<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue'
import type { LineStatus, SandboxAccount } from '~/interfaces/sandbox/practice'
import { MAX_ROWS, VERDICT_LABEL, VERDICT_TONE, groupAccounts, groupDigits, newRow, parseRupiah, formatRupiah, type JournalRow } from '~/lib/sandbox'

const props = withDefaults(
  defineProps<{
    modelValue: JournalRow[]
    accounts: SandboxAccount[]
    disabled?: boolean
    verdicts?: Record<number, LineStatus>
  }>(),
  { disabled: false, verdicts: () => ({}) },
)

const emit = defineEmits<{ 'update:modelValue': [value: JournalRow[]] }>()

const groups = computed(() => groupAccounts(props.accounts))
const nextId = computed(() => props.modelValue.reduce((max, row) => Math.max(max, row.id), 0) + 1)

function patch(id: number, change: Partial<JournalRow>) {
  emit(
    'update:modelValue',
    props.modelValue.map((row) => (row.id === id ? { ...row, ...change } : row)),
  )
}

function onAmount(id: number, event: Event) {
  patch(id, { amount: groupDigits((event.target as HTMLInputElement).value) })
}

function add() {
  if (props.modelValue.length >= MAX_ROWS) return
  const last = props.modelValue[props.modelValue.length - 1]
  emit('update:modelValue', [...props.modelValue, newRow(nextId.value, last?.side === 'DEBIT' ? 'CREDIT' : 'DEBIT')])
}

function remove(id: number) {
  if (props.modelValue.length <= 2) return
  emit('update:modelValue', props.modelValue.filter((row) => row.id !== id))
}

const hint = (row: JournalRow) => {
  const value = parseRupiah(row.amount)
  return value === null ? '' : formatRupiah(value)
}
</script>

<template>
  <div class="rc-sbx-grid">
    <ol class="rc-sbx-rows" aria-label="Baris jurnal">
      <li v-for="(row, index) in modelValue" :key="row.id" class="rc-sbx-row" :class="verdicts[row.id] ? `rc-sbx-row--${VERDICT_TONE[verdicts[row.id]!]}` : ''">
        <div class="rc-sbx-row__head">
          <span class="rc-sbx-row__no">Baris {{ index + 1 }}</span>
          <span v-if="verdicts[row.id]" class="rc-sbx-verdict" :class="`rc-sbx-verdict--${VERDICT_TONE[verdicts[row.id]!]}`">{{ VERDICT_LABEL[verdicts[row.id]!] }}</span>
        </div>

        <label class="rc-label">
          Akun
          <select class="rc-field" :disabled="disabled" @change="patch(row.id, { account: ($event.target as HTMLSelectElement).value })">
            <option value="" :selected="row.account === ''">Pilih akun</option>
            <optgroup v-for="group in groups" :key="group.label" :label="group.label">
              <option v-for="account in group.accounts" :key="account.code" :value="account.code" :selected="row.account === account.code">{{ account.code }} {{ account.name }}</option>
            </optgroup>
          </select>
        </label>

        <fieldset class="rc-sbx-side" :disabled="disabled">
          <legend class="rc-label">Sisi</legend>
          <label class="rc-sbx-side__option" :class="{ 'is-on': row.side === 'DEBIT' }">
            <input type="radio" :name="`side-${row.id}`" value="DEBIT" :checked="row.side === 'DEBIT'" @change="patch(row.id, { side: 'DEBIT' })" />
            Debit
          </label>
          <label class="rc-sbx-side__option" :class="{ 'is-on': row.side === 'CREDIT' }">
            <input type="radio" :name="`side-${row.id}`" value="CREDIT" :checked="row.side === 'CREDIT'" @change="patch(row.id, { side: 'CREDIT' })" />
            Kredit
          </label>
        </fieldset>

        <label class="rc-label">
          Jumlah (Rp)
          <input class="rc-field" inputmode="numeric" autocomplete="off" placeholder="0" :value="row.amount" :disabled="disabled" @input="onAmount(row.id, $event)" />
          <span v-if="hint(row)" class="rc-hint">{{ hint(row) }}</span>
        </label>

        <PlayButton v-if="modelValue.length > 2 && !disabled" class="rc-sbx-row__remove" variant="ghost" size="sm" :aria-label="`Hapus baris ${index + 1}`" @click="remove(row.id)">Hapus</PlayButton>
      </li>
    </ol>

    <div v-if="!disabled" class="rc-actions">
      <PlayButton variant="secondary" size="sm" :disabled="modelValue.length >= MAX_ROWS" @click="add">Tambah baris</PlayButton>
      <span v-if="modelValue.length >= MAX_ROWS" class="rc-hint">Maksimal {{ MAX_ROWS }} baris.</span>
    </div>
  </div>
</template>
