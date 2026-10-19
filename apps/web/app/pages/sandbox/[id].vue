<script setup lang="ts">
import { nextTick } from 'vue'
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import CheckResultPanel from '~/components/sandbox/CheckResultPanel.vue'
import DebitCreditTotal from '~/components/sandbox/DebitCreditTotal.vue'
import HintPanel from '~/components/sandbox/HintPanel.vue'
import JournalEntryGrid from '~/components/sandbox/JournalEntryGrid.vue'
import SolutionPanel from '~/components/sandbox/SolutionPanel.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import StatusBadge from '~/components/ui/StatusBadge.vue'
import type { CheckResult, LineStatus, Solution } from '~/interfaces/sandbox/practice'
import { sandboxApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import type { RewardLine } from '~/lib/gamify'
import {
  DIFFICULTY_LABEL,
  HINT_COOLDOWN_SECONDS,
  SCAFFOLD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  initialRows,
  isFilled,
  journalProblem,
  journalTotals,
  levelLabel,
  rowsFromLines,
  scaffoldNote,
  toLines,
  type JournalRow,
} from '~/lib/sandbox'

definePageMeta({
  title: 'Skenario Latihan — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

const route = useRoute()
const { announce } = useRewardAnnouncement()
const rewards = ref<RewardLine[]>([])
const scenarioId = computed(() => String(route.params.id || ''))

const { data: detail, status, error, refresh } = await useAsyncData(() => `sandbox:detail:${scenarioId.value}`, () => sandboxApi.detail(scenarioId.value), {
  watch: [scenarioId],
})

const rows = ref<JournalRow[]>(initialRows())
const result = ref<CheckResult | null>(null)
const verdicts = ref<Record<number, LineStatus>>({})
const problem = ref<string | null>(null)
const checking = ref(false)
const hints = ref<string[]>([])
const hintLevel = ref(0)
const canReveal = ref(false)
const hintBusy = ref(false)
const hintError = ref<string | null>(null)
const revealed = ref<Solution | null>(null)
const revealBusy = ref(false)
const loadedFor = ref('')
const cooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

function stopCooldown() {
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = null
}

function startCooldown() {
  stopCooldown()
  cooldown.value = HINT_COOLDOWN_SECONDS
  cooldownTimer = setInterval(() => {
    cooldown.value = Math.max(0, cooldown.value - 1)
    if (cooldown.value === 0) stopCooldown()
  }, 1000)
}

onBeforeUnmount(stopCooldown)

watch(
  detail,
  (value) => {
    if (!value || loadedFor.value === value.id) return
    loadedFor.value = value.id
    rows.value = rowsFromLines(value.lastLines ?? [])
    result.value = null
    rewards.value = []
    verdicts.value = {}
    problem.value = null
    hints.value = [...value.hints]
    hintLevel.value = value.practice.hintLevel
    canReveal.value = value.practice.attempts >= 1 || value.practice.hintLevel >= 3
    revealed.value = null
    hintError.value = null
  },
  { immediate: true },
)

const solved = computed(() => detail.value?.practice.status === 'SOLVED')
const started = computed(() => rows.value.some((row) => isFilled(row)))
const totals = computed(() => journalTotals(rows.value))
const solution = computed<Solution | null>(() => detail.value?.solution ?? revealed.value)
const showForm = computed(() => !solved.value)
const exampleKey = computed(() => (detail.value?.example ? { key: detail.value.example.key, why: detail.value.example.why } : null))

async function focusResult() {
  await nextTick()
  const heading = document.getElementById('result-h')
  heading?.setAttribute('tabindex', '-1')
  heading?.focus()
}

async function check() {
  if (checking.value || !detail.value) return
  const invalid = journalProblem(rows.value)
  if (invalid) {
    problem.value = invalid
    return
  }
  const filledIds = rows.value.filter(isFilled).map((row) => row.id)
  checking.value = true
  problem.value = null
  try {
    const outcome = await sandboxApi.check(detail.value.id, toLines(rows.value))
    result.value = outcome
    const byRow: Record<number, LineStatus> = {}
    for (const verdict of outcome.verdicts) {
      const rowId = filledIds[verdict.index]
      if (rowId !== undefined) byRow[rowId] = verdict.status
    }
    verdicts.value = byRow
    canReveal.value = canReveal.value || outcome.attemptNumber >= 1
    if (outcome.correct) await refresh()
    rewards.value = outcome.learning ? await announce('Jurnal tepat', outcome.learning) : []
    await focusResult()
  } catch (err) {
    problem.value = describeApiError(err, 'Pemeriksaan gagal. Coba lagi.')
  } finally {
    checking.value = false
  }
}

async function openHint() {
  if (hintBusy.value || !detail.value) return
  hintBusy.value = true
  hintError.value = null
  try {
    const outcome = await sandboxApi.hint(detail.value.id)
    hints.value = outcome.hints
    hintLevel.value = outcome.level
    canReveal.value = canReveal.value || outcome.canReveal
    if (outcome.remaining > 0) startCooldown()
  } catch (err) {
    hintError.value = describeApiError(err, 'Petunjuk belum bisa dibuka. Coba lagi.')
  } finally {
    hintBusy.value = false
  }
}

async function reveal() {
  if (revealBusy.value || !detail.value) return
  revealBusy.value = true
  hintError.value = null
  try {
    const outcome = await sandboxApi.reveal(detail.value.id)
    revealed.value = { key: outcome.key, why: outcome.why, equation: outcome.equation }
  } catch (err) {
    hintError.value = describeApiError(err, 'Jawaban belum bisa dibuka. Coba lagi.')
  } finally {
    revealBusy.value = false
  }
}

function startVariant() {
  if (!detail.value) return
  const seedValue = Math.floor(Math.random() * 99) + 1
  navigateTo({ path: `/sandbox/variasi/${encodeURIComponent(detail.value.id)}`, query: { v: String(seedValue) } })
}

function reset() {
  rows.value = initialRows()
  result.value = null
  rewards.value = []
  verdicts.value = {}
  problem.value = null
}

useHead({ title: () => (detail.value ? `${detail.value.title} — ReduCera` : 'Skenario Latihan — ReduCera') })
</script>

<template>
  <div class="rc-stack rc-sbx-page">
    <LoadingSkeleton v-if="status === 'pending' && !detail" variant="panel" :count="2" />
    <ErrorState v-else-if="error && !detail" title="Skenario gagal dimuat" :message="describeApiError(error, 'Skenario ini tidak tersedia untukmu.')" @retry="refresh()" />

    <template v-else-if="detail">
      <PageHeader :title="detail.title">
        <template #actions>
          <PlayButton to="/sandbox/akuntansi" variant="outline" size="sm">Semua skenario</PlayButton>
        </template>
      </PageHeader>

      <div class="rc-sbx-meta">
        <StatusBadge :tone="STATUS_TONE[detail.practice.status]" :label="STATUS_LABEL[detail.practice.status]" />
        <span class="rc-hint">{{ levelLabel(detail.level) }} · {{ DIFFICULTY_LABEL[detail.difficulty] }} · {{ detail.lineCount }} baris jurnal</span>
      </div>

      <PlayCard as="section" aria-labelledby="story-h">
        <h2 id="story-h" class="rc-h2">Transaksi</h2>
        <p class="rc-sbx-story">{{ detail.story }}</p>
      </PlayCard>

      <p class="rc-sbx-note" role="note">
        <strong>{{ SCAFFOLD_LABEL[detail.personalization.scaffold] }}</strong>
        <span>{{ scaffoldNote(detail.personalization.scaffold, detail.personalization.mastery, detail.personalization.evidenceCount) }}</span>
      </p>

      <details v-if="detail.personalization.equationPanelOpen && !solved" class="rc-sbx-details" open>
        <summary>Pengingat: persamaan akuntansi</summary>
        <div>
          <p><strong>Aset = Kewajiban + Ekuitas</strong></p>
          <p>Debit menambah aset dan beban, serta mengurangi kewajiban, ekuitas, dan pendapatan. Kredit sebaliknya. Dalam satu jurnal, total debit harus sama dengan total kredit.</p>
        </div>
      </details>

      <details v-if="detail.example && exampleKey" class="rc-sbx-details">
        <summary>Contoh serupa yang sudah dikerjakan</summary>
        <div>
          <p>{{ detail.example.story }}</p>
          <SolutionPanel :solution="exampleKey" title="Jurnal contoh" />
        </div>
      </details>

      <PlayCard v-if="showForm" as="form" class="rc-sbx-form" aria-label="Jurnal" novalidate @submit.prevent="check">
        <h2 class="rc-h2">Jurnal umum</h2>
        <JournalEntryGrid v-model="rows" :accounts="detail.accounts" :disabled="checking" :verdicts="verdicts" />
        <DebitCreditTotal :totals="totals" :started="started" />
        <p v-if="problem" class="rc-alert rc-alert--error" role="alert">{{ problem }}</p>
        <div class="rc-actions">
          <PlayButton type="submit" :loading="checking">Periksa jurnal</PlayButton>
          <PlayButton variant="ghost" size="sm" :disabled="checking" @click="reset">Kosongkan</PlayButton>
        </div>
      </PlayCard>

      <CheckResultPanel v-if="result" :result="result" />
      <RewardSummary :lines="rewards" heading-id="sandbox-rewards" />

      <PlayCard v-if="showForm">
        <HintPanel :hints="hints" :level="hintLevel" :busy="hintBusy || revealBusy" :can-reveal="canReveal" :error="hintError" :cooldown="cooldown" @hint="openHint" @reveal="reveal" />
      </PlayCard>

      <PlayCard v-if="solution" as="section" :tone="solved ? 'success' : 'soft'">
        <p v-if="!solved" class="rc-hint">Kamu membuka jawaban, jadi skenario ini belum dihitung selesai. Coba catat sendiri jurnalnya di atas.</p>
        <SolutionPanel :solution="solution" />
      </PlayCard>

      <PlayCard v-if="solved" as="section" aria-labelledby="variant-h">
        <h2 id="variant-h" class="rc-h2">Latih lagi dengan angka lain</h2>
        <p class="rc-hint">Transaksinya sama, angkanya berbeda. Berlatih ulang membuat kamu lebih ingat, dan latihan ini tidak mengubah skormu.</p>
        <div class="rc-actions">
          <PlayButton @click="startVariant">Coba angka lain</PlayButton>
          <PlayButton to="/sandbox/akuntansi" variant="outline">Pilih skenario lain</PlayButton>
        </div>
      </PlayCard>
    </template>
  </div>
</template>
