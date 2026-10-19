<script setup lang="ts">
import { nextTick } from 'vue'
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import DebitCreditTotal from '~/components/sandbox/DebitCreditTotal.vue'
import HintPanel from '~/components/sandbox/HintPanel.vue'
import JournalEntryGrid from '~/components/sandbox/JournalEntryGrid.vue'
import SolutionPanel from '~/components/sandbox/SolutionPanel.vue'
import VariantResultPanel from '~/components/sandbox/VariantResultPanel.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import type { LineStatus, Solution, VariantCheckResult } from '~/interfaces/sandbox/practice'
import { sandboxApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import {
  DIFFICULTY_LABEL,
  HINT_COOLDOWN_SECONDS,
  HINT_STEPS,
  initialRows,
  isFilled,
  journalProblem,
  journalTotals,
  levelLabel,
  nextSeed,
  parseSeed,
  toLines,
  variantProgressText,
  type JournalRow,
} from '~/lib/sandbox'

definePageMeta({
  title: 'Latihan Angka Lain — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

const route = useRoute()
const scenarioId = computed(() => String(route.params.id || ''))
const seed = computed(() => parseSeed(route.query.v))

const { data: detail, error, refresh } = await useAsyncData(
  () => `sandbox:variant:${scenarioId.value}:${seed.value ?? 0}`,
  () => (seed.value === null ? Promise.resolve(null) : sandboxApi.variant(scenarioId.value, seed.value)),
  { watch: [scenarioId, seed] },
)

const rows = ref<JournalRow[]>(initialRows())
const result = ref<VariantCheckResult | null>(null)
const verdicts = ref<Record<number, LineStatus>>({})
const problem = ref<string | null>(null)
const checking = ref(false)
const hintLevel = ref(0)
const hintError = ref<string | null>(null)
const revealed = ref<Solution | null>(null)
const revealBusy = ref(false)
const attempted = ref(false)
const cooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null
const loadedKey = ref('')

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
    if (!value) return
    const key = `${value.scenarioId}:${value.seed}`
    if (loadedKey.value === key) return
    loadedKey.value = key
    rows.value = initialRows()
    result.value = null
    verdicts.value = {}
    problem.value = null
    hintLevel.value = 0
    hintError.value = null
    revealed.value = null
    attempted.value = false
    stopCooldown()
    cooldown.value = 0
  },
  { immediate: true },
)

const started = computed(() => rows.value.some((row) => isFilled(row)))
const totals = computed(() => journalTotals(rows.value))
const hints = computed(() => (detail.value ? detail.value.hints.slice(0, hintLevel.value) : []))
const canReveal = computed(() => attempted.value || hintLevel.value >= HINT_STEPS)
const solved = computed(() => result.value?.correct === true)
const solution = computed<Solution | null>(() => revealed.value)
const progress = computed(() => (detail.value && seed.value ? variantProgressText(seed.value, detail.value.variantCount) : ''))

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
    const outcome = await sandboxApi.checkVariant(detail.value.scenarioId, detail.value.seed, toLines(rows.value))
    result.value = outcome
    attempted.value = true
    const byRow: Record<number, LineStatus> = {}
    for (const verdict of outcome.verdicts) {
      const rowId = filledIds[verdict.index]
      if (rowId !== undefined) byRow[rowId] = verdict.status
    }
    verdicts.value = byRow
    await focusResult()
  } catch (err) {
    problem.value = describeApiError(err, 'Pemeriksaan gagal. Coba lagi.')
  } finally {
    checking.value = false
  }
}

function openHint() {
  if (cooldown.value > 0 || hintLevel.value >= HINT_STEPS) return
  hintLevel.value += 1
  if (hintLevel.value < HINT_STEPS) startCooldown()
}

async function reveal() {
  if (revealBusy.value || !detail.value) return
  revealBusy.value = true
  hintError.value = null
  try {
    const outcome = await sandboxApi.revealVariant(detail.value.scenarioId, detail.value.seed)
    revealed.value = { key: outcome.key, why: outcome.why, equation: outcome.equation }
  } catch (err) {
    hintError.value = describeApiError(err, 'Jawaban belum bisa dibuka. Coba lagi.')
  } finally {
    revealBusy.value = false
  }
}

function another() {
  if (!detail.value) return
  navigateTo({ path: route.path, query: { v: String(nextSeed(detail.value.seed, detail.value.variantCount)) } })
}

function reset() {
  rows.value = initialRows()
  result.value = null
  verdicts.value = {}
  problem.value = null
}

useHead({ title: () => (detail.value ? `Angka lain: ${detail.value.title} — ReduCera` : 'Latihan Angka Lain — ReduCera') })
</script>

<template>
  <div class="rc-stack rc-sbx-page">
    <ErrorState v-if="seed === null" title="Variasi tidak dikenal" message="Buka latihan angka lain dari halaman skenario yang sudah kamu selesaikan." />
    <ErrorState v-else-if="error && !detail" title="Latihan angka lain belum bisa dibuka" :message="describeApiError(error, 'Selesaikan skenario aslinya dulu.')" @retry="refresh()" />
    <LoadingSkeleton v-else-if="!detail" variant="panel" :count="2" />

    <template v-else>
      <PageHeader :title="`Angka lain: ${detail.title}`">
        <template #actions>
          <PlayButton :to="`/sandbox/${detail.scenarioId}`" variant="outline" size="sm">Kembali ke skenario</PlayButton>
        </template>
      </PageHeader>

      <div class="rc-sbx-meta">
        <span class="rc-hint">{{ progress }} · {{ levelLabel(detail.level) }} · {{ DIFFICULTY_LABEL[detail.difficulty] }}</span>
      </div>

      <p class="rc-sbx-note" role="note">
        <strong>Latihan bebas</strong>
        <span>Transaksinya sama dengan skenario yang sudah kamu selesaikan, tetapi angkanya berbeda. Latihan ini tidak menambah bukti belajar dan tidak mengubah skormu.</span>
      </p>

      <PlayCard as="section" aria-labelledby="story-h">
        <h2 id="story-h" class="rc-h2">Transaksi</h2>
        <p class="rc-sbx-story">{{ detail.story }}</p>
      </PlayCard>

      <PlayCard v-if="!solved" as="form" class="rc-sbx-form" aria-label="Jurnal" novalidate @submit.prevent="check">
        <h2 class="rc-h2">Jurnal umum</h2>
        <JournalEntryGrid v-model="rows" :accounts="detail.accounts" :disabled="checking" :verdicts="verdicts" />
        <DebitCreditTotal :totals="totals" :started="started" />
        <p v-if="problem" class="rc-alert rc-alert--error" role="alert">{{ problem }}</p>
        <div class="rc-actions">
          <PlayButton type="submit" :loading="checking">Periksa jurnal</PlayButton>
          <PlayButton variant="ghost" size="sm" :disabled="checking" @click="reset">Kosongkan</PlayButton>
        </div>
      </PlayCard>

      <VariantResultPanel v-if="result" :result="result" />

      <PlayCard v-if="!solved">
        <HintPanel :hints="hints" :level="hintLevel" :busy="revealBusy" :can-reveal="canReveal" :error="hintError" :cooldown="cooldown" @hint="openHint" @reveal="reveal" />
      </PlayCard>

      <PlayCard v-if="solution && !solved" tone="soft" as="section">
        <SolutionPanel :solution="solution" />
      </PlayCard>

      <div class="rc-actions">
        <PlayButton v-if="solved || solution" @click="another">Coba angka lain lagi</PlayButton>
        <PlayButton v-else variant="ghost" size="sm" @click="another">Lewati ke angka lain</PlayButton>
        <PlayButton :to="`/sandbox/${detail.scenarioId}`" variant="outline" size="sm">Selesai berlatih</PlayButton>
      </div>
    </template>
  </div>
</template>
