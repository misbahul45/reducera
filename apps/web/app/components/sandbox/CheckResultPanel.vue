<script setup lang="ts">
import type { CheckResult } from '~/interfaces/sandbox/practice'
import { equationText, formatRupiah, recommendationLink, scoreText, sortFindings } from '~/lib/sandbox'

const props = defineProps<{ result: CheckResult }>()

const findings = computed(() => sortFindings(props.result.findings))
const percent = computed(() => Math.round(props.result.score * 100))
const gained = computed(() => (props.result.learning ? Math.round((props.result.learning.masteryAfter - props.result.learning.masteryBefore) * 100) : 0))
</script>

<template>
  <section class="rc-sbx-result" :class="result.correct ? 'is-correct' : 'is-wrong'" aria-labelledby="result-h">
    <h2 id="result-h" class="rc-h2">{{ result.correct ? 'Jurnalmu tepat' : scoreText(result.score) }}</h2>
    <div class="rc-sbx-meter" role="img" :aria-label="`Skor ${percent} persen`">
      <span class="rc-sbx-meter__fill" :style="{ width: `${percent}%` }"></span>
    </div>
    <p class="rc-hint">Percobaan ke-{{ result.attemptNumber }} · debit {{ formatRupiah(result.totalDebit) }} · kredit {{ formatRupiah(result.totalCredit) }}</p>

    <template v-if="result.correct">
      <p v-if="result.explanation" class="rc-sbx-result__why">{{ result.explanation }}</p>
      <p v-if="result.learning" class="rc-alert rc-alert--success" role="status">
        Bukti belajar tercatat: penguasaan konsep naik dari {{ Math.round(result.learning.masteryBefore * 100) }}% ke
        {{ Math.round(result.learning.masteryAfter * 100) }}%<template v-if="gained > 0"> (+{{ gained }} poin)</template>.
      </p>
      <p v-else-if="result.firstSolve" class="rc-hint">Jawaban ini tidak menambah bukti belajar karena kamu sudah melihat kuncinya.</p>
      <p v-else class="rc-hint">Skenario ini sudah selesai sebelumnya, jadi tidak menambah bukti belajar lagi.</p>
      <p v-if="result.next" class="rc-sbx-next">
        Berikutnya: <NuxtLink :to="recommendationLink(result.next)" class="rc-sbx-link">{{ result.next.title }}</NuxtLink>
        <span class="rc-hint">{{ result.next.message }}</span>
      </p>
    </template>

    <template v-else>
      <ul v-if="findings.length" class="rc-sbx-findings" aria-label="Temuan pada jurnalmu">
        <li v-for="finding in findings" :key="`${finding.code}-${finding.lineIndexes.join('-')}`" :data-severity="finding.severity">
          {{ finding.message }}
        </li>
      </ul>
      <p class="rc-hint">{{ equationText(result.equation) }}. Persamaan akuntansi {{ result.equation.holds ? 'tetap seimbang' : 'tidak seimbang' }}.</p>
    </template>
  </section>
</template>
