<script setup lang="ts">
import type { KeyLine, EquationEffect } from '~/interfaces/sandbox/practice'
import { equationText, formatRupiah } from '~/lib/sandbox'

defineProps<{ solution: { key: KeyLine[]; why: string; equation?: EquationEffect }; title?: string }>()
</script>

<template>
  <section class="rc-sbx-solution" :aria-label="title ?? 'Jurnal yang benar'">
    <h3 class="rc-sbx-h3">{{ title ?? 'Jurnal yang benar' }}</h3>
    <div class="rc-table-wrap">
      <table class="rc-table">
        <caption class="sr-only">Jurnal umum: akun, debit, dan kredit</caption>
        <thead>
          <tr>
            <th scope="col">Akun</th>
            <th scope="col" class="rc-table__num">Debit</th>
            <th scope="col" class="rc-table__num">Kredit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in solution.key" :key="`${line.account}-${line.side}-${index}`">
            <td :class="{ 'rc-sbx-credit-account': line.side === 'CREDIT' }">{{ line.name }}</td>
            <td class="rc-table__num">{{ line.side === 'DEBIT' ? formatRupiah(line.amount) : '' }}</td>
            <td class="rc-table__num">{{ line.side === 'CREDIT' ? formatRupiah(line.amount) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="rc-sbx-solution__why">{{ solution.why }}</p>
    <p v-if="solution.equation" class="rc-hint">{{ equationText(solution.equation) }}</p>
  </section>
</template>
