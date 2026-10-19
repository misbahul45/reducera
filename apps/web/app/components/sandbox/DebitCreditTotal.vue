<script setup lang="ts">
import { formatRupiah, type Totals } from '~/lib/sandbox'

const props = defineProps<{ totals: Totals; started: boolean }>()

const statusText = computed(() => {
  if (!props.started) return 'Isi akun dan jumlah untuk melihat keseimbangan.'
  if (props.totals.balanced) return 'Debit dan kredit seimbang.'
  return `Belum seimbang, selisih ${formatRupiah(props.totals.difference)}.`
})
</script>

<template>
  <div class="rc-sbx-total" :class="{ 'is-balanced': started && totals.balanced, 'is-off': started && !totals.balanced }">
    <dl class="rc-sbx-total__figures">
      <div>
        <dt>Total debit</dt>
        <dd>{{ formatRupiah(totals.debit) }}</dd>
      </div>
      <div>
        <dt>Total kredit</dt>
        <dd>{{ formatRupiah(totals.credit) }}</dd>
      </div>
    </dl>
    <p class="rc-sbx-total__status" role="status">{{ statusText }}</p>
  </div>
</template>
