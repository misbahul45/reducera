<script setup lang="ts">
import type { VariantCheckResult } from '~/interfaces/sandbox/practice'
import { equationText, formatRupiah, scoreText, sortFindings } from '~/lib/sandbox'
import SolutionPanel from '~/components/sandbox/SolutionPanel.vue'

const props = defineProps<{ result: VariantCheckResult }>()

const findings = computed(() => sortFindings(props.result.findings))
const percent = computed(() => Math.round(props.result.score * 100))
</script>

<template>
  <section class="rc-sbx-result" :class="result.correct ? 'is-correct' : 'is-wrong'" aria-labelledby="result-h">
    <h2 id="result-h" class="rc-h2">{{ result.correct ? 'Jurnalmu tepat' : scoreText(result.score) }}</h2>
    <div class="rc-sbx-meter" role="img" :aria-label="`Skor ${percent} persen`">
      <span class="rc-sbx-meter__fill" :style="{ width: `${percent}%` }"></span>
    </div>
    <p class="rc-hint">Debit {{ formatRupiah(result.totalDebit) }} · kredit {{ formatRupiah(result.totalCredit) }}</p>

    <template v-if="result.correct">
      <p v-if="result.explanation" class="rc-sbx-result__why">{{ result.explanation }}</p>
      <SolutionPanel v-if="result.solution" :solution="result.solution" title="Jurnal yang benar" />
    </template>
    <template v-else>
      <ul v-if="findings.length" class="rc-sbx-findings" aria-label="Temuan pada jurnalmu">
        <li v-for="finding in findings" :key="`${finding.code}-${finding.lineIndexes.join('-')}`" :data-severity="finding.severity">{{ finding.message }}</li>
      </ul>
      <p class="rc-hint">{{ equationText(result.equation) }}.</p>
    </template>
    <p class="rc-hint">Latihan angka lain tidak menambah bukti belajar dan tidak mengubah skor skenario aslinya.</p>
  </section>
</template>
