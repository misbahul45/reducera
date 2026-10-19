<script setup lang="ts">
import { nextTick } from 'vue'
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import SqlResultTable from '~/components/sandbox/SqlResultTable.vue'
import SqlSchemaPanel from '~/components/sandbox/SqlSchemaPanel.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import InfiniteFooter from '~/components/ui/InfiniteFooter.vue'
import StatusBadge from '~/components/ui/StatusBadge.vue'
import type { SqlCheckResult, SqlErrorView, SqlExerciseSummary, SqlProgress, SqlRevealResult, SqlStatementOutput } from '~/interfaces/sandbox/sql'
import { sqlSandboxApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import {
  EXERCISE_PAGE_STEP,
  EXPLORE_ID,
  SQL_STATUS_FILTER_LABEL,
  SQL_STATUS_LABEL,
  SQL_STATUS_TONE,
  STARTER_SQL,
  VERDICT_HEADLINE,
  filterExercises,
  groupExercises,
  hintButtonLabel,
  nextExerciseId,
  progressPercent,
  sqlLevelLabel,
  verdictTone,
  type SqlStatusFilter,
} from '~/lib/sql'

definePageMeta({
  title: 'Latihan SQL — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

useHead({ title: 'Latihan SQL — ReduCera' })

const route = useRoute()
const router = useRouter()

const { data: catalog, error, refresh } = await useAsyncData('sandbox:sql:catalog', () => sqlSandboxApi.catalog())

const exercises = ref<SqlExerciseSummary[]>(catalog.value?.exercises ?? [])
watch(catalog, (value) => {
  if (value) exercises.value = value.exercises
})

const dataset = computed(() => catalog.value?.datasets[0] ?? null)
const filter = reactive({ q: '', status: 'ALL' as SqlStatusFilter, level: '' })
const levels = computed(() => [...new Set(exercises.value.map((exercise) => exercise.level))].sort((a, b) => a - b))
const filtering = computed(() => filter.q.trim() !== '' || filter.status !== 'ALL' || filter.level !== '')
const filtered = computed(() => filterExercises(exercises.value, { q: filter.q, status: filter.status, level: filter.level === '' ? null : Number(filter.level) }))
const list = useIncremental(filtered, { step: EXERCISE_PAGE_STEP, resetOn: () => [filter.q, filter.status, filter.level] })
const groups = computed(() => groupExercises(list.visible.value))

function clearFilter() {
  filter.q = ''
  filter.status = 'ALL'
  filter.level = ''
}
const solved = computed(() => exercises.value.filter((exercise) => exercise.progress.status === 'SOLVED').length)
const percent = computed(() => progressPercent(solved.value, exercises.value.length))

function initialSelection(): string {
  const wanted = typeof route.query.latihan === 'string' ? route.query.latihan : ''
  if (wanted === EXPLORE_ID) return EXPLORE_ID
  if (exercises.value.some((exercise) => exercise.id === wanted)) return wanted
  return nextExerciseId(exercises.value, null) ?? exercises.value[0]?.id ?? EXPLORE_ID
}

const selectedId = ref(initialSelection())

function revealInList(id: string) {
  const position = filtered.value.findIndex((exercise) => exercise.id === id)
  if (position >= 0) list.reveal(position)
}

revealInList(selectedId.value)
const exploring = computed(() => selectedId.value === EXPLORE_ID)
const current = computed(() => exercises.value.find((exercise) => exercise.id === selectedId.value) ?? null)

const editors = reactive<Record<string, string>>({})
for (const exercise of exercises.value) editors[exercise.id] = exercise.progress.lastSql ?? ''
editors[EXPLORE_ID] = STARTER_SQL

const sql = computed({
  get: () => editors[selectedId.value] ?? '',
  set: (value: string) => {
    editors[selectedId.value] = value
  },
})

const runOutputs = ref<SqlStatementOutput[]>([])
const runError = ref<SqlErrorView | null>(null)
const runNotice = ref<string | null>(null)
const checkResult = ref<SqlCheckResult | null>(null)
const hintNotice = ref<string | null>(null)
const revealed = ref<Record<string, SqlRevealResult>>({})
const busy = ref<'run' | 'check' | 'hint' | 'reveal' | null>(null)
const problem = ref<string | null>(null)
const confirmingReveal = ref(false)
const resultHeading = ref<HTMLElement | null>(null)

function clearTransient() {
  runOutputs.value = []
  runError.value = null
  runNotice.value = null
  checkResult.value = null
  hintNotice.value = null
  problem.value = null
  confirmingReveal.value = false
}

function select(id: string) {
  if (id === selectedId.value) return
  selectedId.value = id
  revealInList(id)
  clearTransient()
  void router.replace({ query: { ...route.query, latihan: id } })
}

function applyProgress(id: string, progress: SqlProgress) {
  exercises.value = exercises.value.map((exercise) => (exercise.id === id ? { ...exercise, progress } : exercise))
}

async function focusResult() {
  await nextTick()
  resultHeading.value?.focus()
}

async function run() {
  if (busy.value || !dataset.value) return
  if (sql.value.trim() === '') {
    problem.value = 'Tuliskan pernyataan SQL terlebih dahulu.'
    return
  }
  busy.value = 'run'
  clearTransient()
  try {
    const result = await sqlSandboxApi.run(dataset.value.id, sql.value)
    runOutputs.value = result.outputs
    runError.value = result.error
    runNotice.value = result.accepted ? null : result.notice
    await focusResult()
  } catch (failure) {
    problem.value = describeApiError(failure)
  } finally {
    busy.value = null
  }
}

async function check() {
  if (busy.value || !current.value) return
  if (sql.value.trim() === '') {
    problem.value = 'Tuliskan pernyataan SQL terlebih dahulu.'
    return
  }
  busy.value = 'check'
  const id = current.value.id
  clearTransient()
  try {
    const result = await sqlSandboxApi.check(id, sql.value)
    checkResult.value = result
    applyProgress(id, result.progress)
    await focusResult()
  } catch (failure) {
    problem.value = describeApiError(failure)
  } finally {
    busy.value = null
  }
}

async function openHint() {
  if (busy.value || !current.value) return
  busy.value = 'hint'
  hintNotice.value = null
  problem.value = null
  const id = current.value.id
  try {
    const result = await sqlSandboxApi.hint(id)
    const base = exercises.value.find((exercise) => exercise.id === id)
    if (base) applyProgress(id, { ...base.progress, hintLevel: result.hintLevel, hints: result.hints })
    hintNotice.value = result.notice
  } catch (failure) {
    problem.value = describeApiError(failure)
  } finally {
    busy.value = null
  }
}

async function revealAnswer() {
  if (busy.value || !current.value) return
  busy.value = 'reveal'
  confirmingReveal.value = false
  problem.value = null
  const id = current.value.id
  try {
    const result = await sqlSandboxApi.reveal(id)
    revealed.value = { ...revealed.value, [id]: result }
    const base = exercises.value.find((exercise) => exercise.id === id)
    if (base) applyProgress(id, { ...base.progress, revealed: true, status: base.progress.status === 'NEW' ? 'IN_PROGRESS' : base.progress.status })
  } catch (failure) {
    problem.value = describeApiError(failure)
  } finally {
    busy.value = null
  }
}

function useReference(text: string) {
  sql.value = text
}

const nextId = computed(() => nextExerciseId(exercises.value, current.value?.id ?? null))
const canOpenMoreHints = computed(() => (current.value ? current.value.progress.hintLevel < current.value.hintCount : false))
const canReveal = computed(() => (current.value ? current.value.progress.attempts > 0 : false))
const reference = computed(() => (current.value ? (revealed.value[current.value.id] ?? null) : null))
const verdictLabel = computed(() => (checkResult.value ? VERDICT_HEADLINE[checkResult.value.verdict] : ''))

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void run()
  }
}
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Latihan SQL" subtitle="Tulis SQL dan jalankan pada basis data PostgreSQL contoh. Setiap kali dijalankan, data kembali ke keadaan awal, jadi bebas mencoba.">
      <template #actions>
        <PlayButton to="/sandbox" variant="ghost" size="sm">Semua sandbox</PlayButton>
      </template>
    </PageHeader>

    <LoadingSkeleton v-if="!catalog && !error" variant="card" :count="3" />
    <ErrorState v-else-if="error && !catalog" title="Latihan SQL gagal dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else-if="catalog && dataset">
      <p v-if="!catalog.available" class="rc-alert rc-alert--error" role="alert">
        Mesin SQL sedang tidak tersedia. Soal tetap dapat dibaca, tetapi SQL belum bisa dijalankan. Coba lagi beberapa saat lagi.
      </p>

      <div class="rc-sql">
        <aside class="rc-sql__side" aria-label="Daftar latihan">
          <details class="rc-sql__list" open>
            <summary>
              <span>Latihan</span>
              <span class="rc-hint">{{ solved }} dari {{ exercises.length }} selesai</span>
            </summary>
            <div class="rc-sbx-meter" role="img" :aria-label="`${percent} persen latihan selesai`">
              <span class="rc-sbx-meter__fill" :style="{ width: `${percent}%` }"></span>
            </div>
            <form class="rc-sql__filters" role="search" aria-label="Saring latihan" @submit.prevent>
              <label>
                Cari
                <input v-model="filter.q" type="search" class="rc-field" maxlength="60" placeholder="Contoh: JOIN" autocomplete="off" />
              </label>
              <label>
                Status
                <select v-model="filter.status" class="rc-field">
                  <option v-for="(label, key) in SQL_STATUS_FILTER_LABEL" :key="key" :value="key">{{ label }}</option>
                </select>
              </label>
              <label>
                Level
                <select v-model="filter.level" class="rc-field">
                  <option value="">Semua level</option>
                  <option v-for="level in levels" :key="level" :value="String(level)">{{ sqlLevelLabel(level) }}</option>
                </select>
              </label>
              <PlayButton v-if="filtering" variant="ghost" size="sm" @click="clearFilter">Hapus filter</PlayButton>
            </form>
            <button type="button" class="rc-sql__item" :class="{ 'is-current': exploring }" :aria-current="exploring ? 'true' : undefined" @click="select(EXPLORE_ID)">
              <span class="rc-sql__item-title">Eksplorasi bebas</span>
              <span class="rc-hint">Coba SQL apa saja tanpa dinilai</span>
            </button>
            <p v-if="filtered.length === 0" class="rc-hint" role="status">Tidak ada latihan yang cocok. Ubah atau hapus filter.</p>
            <div v-for="group in groups" :key="group.level" class="rc-sql__group">
              <h3 class="rc-sql__group-title">{{ group.label }}</h3>
              <ul class="rc-sql__items">
                <li v-for="exercise in group.exercises" :key="exercise.id">
                  <button
                    type="button"
                    class="rc-sql__item"
                    :class="{ 'is-current': selectedId === exercise.id }"
                    :aria-current="selectedId === exercise.id ? 'true' : undefined"
                    @click="select(exercise.id)"
                  >
                    <span class="rc-sql__item-title">{{ exercise.title }}</span>
                    <StatusBadge :tone="SQL_STATUS_TONE[exercise.progress.status]" :label="SQL_STATUS_LABEL[exercise.progress.status]" />
                  </button>
                </li>
              </ul>
            </div>
            <InfiniteFooter :shown="list.visible.value.length" :total="filtered.length" noun="latihan" :has-more="list.hasMore.value" @more="list.more()" />
          </details>
        </aside>

        <section class="rc-sql__main" aria-labelledby="sql-task-h">
          <PlayCard as="div">
            <template v-if="exploring">
              <h2 id="sql-task-h" class="rc-h2">Eksplorasi bebas</h2>
              <p>Tulis pernyataan SQL apa saja pada tabel di bawah. Gunakan SELECT untuk melihat data, atau INSERT, UPDATE, DELETE, dan CREATE TABLE untuk mengubahnya. Perubahanmu tidak disimpan.</p>
            </template>
            <template v-else-if="current">
              <div class="rc-sbx-meta">
                <StatusBadge :tone="SQL_STATUS_TONE[current.progress.status]" :label="SQL_STATUS_LABEL[current.progress.status]" />
                <span class="rc-hint">{{ sqlLevelLabel(current.level) }} · {{ current.subTopic }}</span>
              </div>
              <h2 id="sql-task-h" class="rc-h2">{{ current.title }}</h2>
              <p class="rc-sbx-story">{{ current.task }}</p>
              <p v-if="current.ordered" class="rc-hint">Urutan baris pada hasil ikut dinilai.</p>
            </template>
            <SqlSchemaPanel :dataset="dataset" />
          </PlayCard>

          <form class="rc-sql__editor" @submit.prevent="run">
            <label for="sql-editor" class="rc-label">Editor SQL</label>
            <textarea
              id="sql-editor"
              v-model="sql"
              class="rc-field rc-sql__textarea"
              rows="8"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              maxlength="6000"
              placeholder="SELECT * FROM pelanggan;"
              aria-describedby="sql-editor-hint"
              @keydown="onKeydown"
            ></textarea>
            <p id="sql-editor-hint" class="rc-hint">Tekan Ctrl + Enter (atau Cmd + Enter) untuk menjalankan. Pisahkan beberapa pernyataan dengan titik koma.</p>
            <p v-if="problem" class="rc-alert rc-alert--error" role="alert">{{ problem }}</p>
            <div class="rc-actions">
              <PlayButton type="submit" :variant="exploring ? 'primary' : 'secondary'" :loading="busy === 'run'" :disabled="!catalog.available || (busy !== null && busy !== 'run')">Jalankan</PlayButton>
              <PlayButton v-if="!exploring" :loading="busy === 'check'" :disabled="!catalog.available || (busy !== null && busy !== 'check')" @click="check">Periksa jawaban</PlayButton>
            </div>
          </form>

          <section v-if="current && !exploring" class="rc-sbx-hints" aria-labelledby="sql-hints-h">
            <h3 id="sql-hints-h" class="rc-sbx-h3">Petunjuk</h3>
            <ol v-if="current.progress.hints.length" class="rc-sbx-hints__list" aria-live="polite">
              <li v-for="(text, index) in current.progress.hints" :key="index">
                <span class="rc-sbx-hints__no">Petunjuk {{ index + 1 }}</span>
                {{ text }}
              </li>
            </ol>
            <p v-else class="rc-hint">Petunjuk dibuka bertahap, dari yang paling umum. Mencoba dulu sebelum membuka petunjuk membuat kamu lebih ingat.</p>
            <p v-if="hintNotice" class="rc-hint" role="status">{{ hintNotice }}</p>
            <div class="rc-actions">
              <PlayButton variant="secondary" size="sm" :loading="busy === 'hint'" :disabled="!canOpenMoreHints || (busy !== null && busy !== 'hint')" @click="openHint">
                {{ hintButtonLabel(current.progress.hintLevel, current.hintCount) }}
              </PlayButton>
              <PlayButton v-if="canReveal && !confirmingReveal && !reference" variant="ghost" size="sm" @click="confirmingReveal = true">Lihat jawaban</PlayButton>
            </div>
            <div v-if="confirmingReveal" class="rc-alert" role="alertdialog" aria-label="Konfirmasi melihat jawaban">
              <p>Setelah melihat jawaban, kamu tetap bisa menjalankan SQL sendiri. Tetap lihat jawaban?</p>
              <div class="rc-actions">
                <PlayButton variant="danger" size="sm" :loading="busy === 'reveal'" @click="revealAnswer">Ya, lihat jawaban</PlayButton>
                <PlayButton variant="ghost" size="sm" @click="confirmingReveal = false">Batal</PlayButton>
              </div>
            </div>
            <div v-if="reference" class="rc-sql__reference">
              <h4 class="rc-sbx-h3">Contoh jawaban</h4>
              <pre class="rc-sql-out__sql"><code>{{ reference.referenceSql }}</code></pre>
              <p>{{ reference.explanation }}</p>
              <PlayButton variant="outline" size="sm" @click="useReference(reference.referenceSql)">Salin ke editor</PlayButton>
            </div>
          </section>

          <section v-if="checkResult" class="rc-sbx-result" :class="checkResult.correct ? 'is-correct' : 'is-wrong'" aria-labelledby="sql-result-h">
            <h2 id="sql-result-h" ref="resultHeading" class="rc-h2" tabindex="-1">{{ verdictLabel }}</h2>
            <StatusBadge :tone="verdictTone(checkResult.verdict)" :label="`Percobaan ke-${checkResult.progress.attempts}`" />
            <p>{{ checkResult.feedback }}</p>
            <template v-if="checkResult.correct">
              <p v-if="checkResult.explanation" class="rc-sbx-result__why">{{ checkResult.explanation }}</p>
              <div class="rc-actions">
                <PlayButton v-if="nextId" @click="select(nextId)">Latihan berikutnya</PlayButton>
                <p v-else class="rc-alert rc-alert--success" role="status">Semua latihan sudah selesai. Coba eksplorasi bebas untuk bereksperimen.</p>
              </div>
            </template>
          </section>

          <section v-else-if="runOutputs.length || runError || runNotice" class="rc-sbx-result" aria-labelledby="sql-run-h">
            <h2 id="sql-run-h" ref="resultHeading" class="rc-h2" tabindex="-1">Hasil eksekusi</h2>
            <p v-if="runNotice" class="rc-alert rc-alert--error" role="alert">{{ runNotice }}</p>
          </section>

          <div v-if="checkResult?.error || runError" class="rc-alert rc-alert--error rc-sql__error" role="alert">
            <p class="rc-sql__error-lead">{{ (checkResult?.error ?? runError)!.friendly }}</p>
            <pre class="rc-sql-out__sql"><code>{{ (checkResult?.error ?? runError)!.message }}</code></pre>
            <p v-if="(checkResult?.error ?? runError)!.detail" class="rc-hint">{{ (checkResult?.error ?? runError)!.detail }}</p>
            <p v-if="(checkResult?.error ?? runError)!.hint" class="rc-hint">Saran PostgreSQL: {{ (checkResult?.error ?? runError)!.hint }}</p>
          </div>

          <div v-if="(checkResult?.outputs ?? runOutputs).length" class="rc-sql__outputs" aria-live="polite">
            <SqlResultTable v-for="(output, index) in checkResult?.outputs ?? runOutputs" :key="index" :output="output" :index="index" />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
