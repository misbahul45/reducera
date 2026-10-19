<script setup lang="ts">
import InfiniteFooter from '~/components/ui/InfiniteFooter.vue'
import type { SqlStatementOutput } from '~/interfaces/sandbox/sql'
import { OUTPUT_ROW_STEP, cellText, isNumericCell, outputSummary } from '~/lib/sql'

const props = defineProps<{ output: SqlStatementOutput; index: number }>()

const rows = computed(() => props.output.rows)
const rowWindow = useIncremental(rows, { step: OUTPUT_ROW_STEP, resetOn: () => props.output })
</script>

<template>
  <figure class="rc-sql-out">
    <figcaption class="rc-sql-out__caption">
      <span class="rc-sql-out__no">Hasil {{ index + 1 }}</span>
      <span>{{ outputSummary(output) }}</span>
      <span class="rc-hint">{{ output.elapsedMs }} ms</span>
    </figcaption>
    <pre class="rc-sql-out__sql"><code>{{ output.sql }}</code></pre>
    <div v-if="output.columns.length > 0" class="rc-sql-table-wrap" tabindex="0" role="region" :aria-label="`Tabel hasil ${index + 1}`">
      <table class="rc-sql-table">
        <thead>
          <tr>
            <th v-for="(column, columnIndex) in output.columns" :key="columnIndex" scope="col">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rowWindow.visible.value" :key="rowIndex">
            <td
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              :class="{ 'is-number': isNumericCell(cell), 'is-null': cell === null }"
            >
              {{ cellText(cell) }}
            </td>
          </tr>
          <tr v-if="output.rows.length === 0">
            <td class="is-empty" :colspan="output.columns.length">Tidak ada baris yang cocok.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <InfiniteFooter v-if="output.rows.length > OUTPUT_ROW_STEP" :shown="rowWindow.visible.value.length" :total="output.rows.length" noun="baris" :has-more="rowWindow.hasMore.value" @more="rowWindow.more()" />
    <p v-if="output.truncated" class="rc-hint" role="note">Hanya {{ output.rows.length }} baris pertama yang ditampilkan. Tambahkan WHERE atau LIMIT untuk mempersempit hasil.</p>
  </figure>
</template>
