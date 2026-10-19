<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import { tryoutApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import {
  OPTION_LETTERS,
  SAVE_DELAY_MS,
  answeredCount,
  diffAnswers,
  formatClock,
  groupBySubtest,
  hasChanges,
  optionLetter,
  remainingFrom,
  serverOffsetMs,
  timerTone,
  unansweredIndexes,
} from '~/lib/tryout'

definePageMeta({
  title: 'Mengerjakan Tryout — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

useHead({ title: 'Mengerjakan Tryout — ReduCera' })

const route = useRoute()
const id = computed(() => String(route.params.id || ''))

const { data: session, error, refresh } = await useAsyncData(() => `sandbox:tryout:run:${id.value}`, () => tryoutApi.view(id.value), {
  watch: [id],
})

if (session.value && session.value.status === 'SUBMITTED') {
  await navigateTo(`/sandbox/tryout/${id.value}/hasil`, { replace: true })
}

const questions = computed(() => session.value?.items ?? [])
const answers = ref<Record<string, number>>({ ...(session.value?.answers ?? {}) })
const saved = ref<Record<string, number>>({ ...(session.value?.answers ?? {}) })

const firstOpen = unansweredIndexes(questions.value, answers.value)[0]
const index = ref(firstOpen ?? 0)
const current = computed(() => questions.value[index.value] ?? null)
const answered = computed(() => answeredCount(answers.value))
const remaining = ref(session.value?.remainingSeconds ?? 0)
const tone = computed(() => timerTone(remaining.value))
const finishing = ref(false)
const confirming = ref(false)
const saveProblem = ref<string | null>(null)
const finishProblem = ref<string | null>(null)
const timeUp = ref(false)

const titles = computed(() => Object.fromEntries((session.value?.subtests ?? []).map((subtest) => [subtest.key, subtest.title])))
const groups = computed(() => groupBySubtest(questions.value, titles.value))
const open = computed(() => unansweredIndexes(questions.value, answers.value))
const currentTitle = computed(() => (current.value ? (titles.value[current.value.subtest] ?? '') : ''))

let offsetMs = 0
let tick: ReturnType<typeof setInterval> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let saving = false

function stopTimers() {
  if (tick) clearInterval(tick)
  if (saveTimer) clearTimeout(saveTimer)
  if (retryTimer) clearTimeout(retryTimer)
  tick = null
  saveTimer = null
  retryTimer = null
}

async function flush() {
  if (saving || finishing.value) return
  const diff = diffAnswers(saved.value, answers.value)
  if (!hasChanges(diff)) return
  saving = true
  const snapshot = { ...answers.value }
  try {
    await tryoutApi.saveAnswers(id.value, diff)
    saved.value = snapshot
    saveProblem.value = null
  } catch (failure) {
    const text = describeApiError(failure)
    if (/habis/i.test(text)) {
      void finish(true)
    } else {
      saveProblem.value = 'Jawaban terakhir belum tersimpan. Kami mencoba lagi.'
      retryTimer = setTimeout(() => void flush(), 5000)
    }
  } finally {
    saving = false
    if (hasChanges(diffAnswers(saved.value, answers.value)) && !saveProblem.value) scheduleSave()
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS)
}

async function finish(byTime = false) {
  if (finishing.value) return
  finishing.value = true
  timeUp.value = byTime
  confirming.value = false
  finishProblem.value = null
  stopTimers()
  try {
    await tryoutApi.submit(id.value, { ...answers.value })
    await navigateTo(`/sandbox/tryout/${id.value}/hasil`, { replace: true })
  } catch (failure) {
    finishProblem.value = describeApiError(failure)
    finishing.value = false
  }
}

function choose(option: number) {
  if (!current.value || finishing.value) return
  const key = current.value.id
  if (answers.value[key] === option) return
  answers.value = { ...answers.value, [key]: option }
  scheduleSave()
}

function clearAnswer() {
  if (!current.value || !(current.value.id in answers.value)) return
  const next = { ...answers.value }
  delete next[current.value.id]
  answers.value = next
  scheduleSave()
}

function goTo(position: number) {
  if (position < 0 || position >= questions.value.length) return
  index.value = position
}

function onKeydown(event: KeyboardEvent) {
  if (confirming.value || finishing.value || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && (target as HTMLInputElement).type !== 'radio') return
  const key = event.key.toLowerCase()
  const letter = OPTION_LETTERS.findIndex((candidate) => candidate.toLowerCase() === key)
  if (letter >= 0 && current.value && letter < current.value.options.length) {
    event.preventDefault()
    choose(letter)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    goTo(index.value + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goTo(index.value - 1)
  }
}

onMounted(() => {
  if (!session.value || session.value.status !== 'IN_PROGRESS') return
  offsetMs = serverOffsetMs(session.value.serverNow, Date.now())
  const update = () => {
    remaining.value = remainingFrom(session.value!.deadlineAt, offsetMs, Date.now())
    if (remaining.value <= 0) void finish(true)
  }
  update()
  tick = setInterval(update, 1000)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  stopTimers()
  if (import.meta.client) window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="rc-try">
    <LoadingSkeleton v-if="!session && !error" variant="card" :count="2" />
    <ErrorState v-else-if="error && !session" title="Tryout tidak bisa dibuka" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else-if="session && current">
      <header class="rc-try__bar">
        <div class="rc-try__timer" :data-tone="tone" role="timer" aria-label="Sisa waktu">
          <UIcon name="i-lucide-timer" aria-hidden="true" />
          <span>{{ formatClock(remaining) }}</span>
        </div>
        <p class="rc-try__count" role="status">Soal {{ index + 1 }} dari {{ questions.length }} · terjawab {{ answered }}</p>
        <PlayButton variant="outline" size="sm" :disabled="finishing" @click="confirming = true">Akhiri tryout</PlayButton>
      </header>

      <p v-if="remaining <= 60 && remaining > 0" class="rc-alert rc-alert--error" role="alert">Waktu hampir habis. Pastikan jawabanmu sudah terpilih.</p>
      <p v-if="timeUp" class="rc-alert" role="status">Waktu habis. Jawabanmu sedang dikirim.</p>
      <p v-if="saveProblem" class="rc-alert rc-alert--error" role="status">{{ saveProblem }}</p>
      <p v-if="finishProblem" class="rc-alert rc-alert--error" role="alert">{{ finishProblem }}</p>

      <div v-if="confirming" class="rc-alert rc-try__confirm" role="alertdialog" aria-labelledby="try-confirm-h">
        <h2 id="try-confirm-h" class="rc-h2">Akhiri tryout sekarang?</h2>
        <p v-if="open.length">
          Masih ada {{ open.length }} soal yang belum dijawab (nomor {{ open.slice(0, 12).map((position) => position + 1).join(', ') }}<template v-if="open.length > 12">, dan lainnya</template>). Soal yang kosong dihitung salah.
        </p>
        <p v-else>Semua soal sudah dijawab. Setelah diakhiri, jawaban tidak bisa diubah.</p>
        <div class="rc-actions">
          <PlayButton :loading="finishing" @click="finish(false)">Akhiri dan lihat hasil</PlayButton>
          <PlayButton variant="ghost" @click="confirming = false">Kembali mengerjakan</PlayButton>
        </div>
      </div>

      <div class="rc-try__body">
        <section class="rc-try__question" aria-labelledby="try-q-h">
          <p class="rc-hint">{{ currentTitle }} · {{ current.section }}</p>
          <h2 id="try-q-h" class="sr-only">Soal nomor {{ index + 1 }}</h2>
          <article v-if="current.passage" class="rc-try__passage" aria-label="Teks bacaan">
            <h3>{{ current.passage.title }}</h3>
            <p>{{ current.passage.text }}</p>
          </article>
          <p class="rc-try__stem">{{ current.stem }}</p>
          <fieldset class="rc-try__options">
            <legend class="sr-only">Pilihan jawaban soal {{ index + 1 }}</legend>
            <label v-for="(option, optionIndex) in current.options" :key="optionIndex" class="rc-try__option" :class="{ 'is-chosen': answers[current.id] === optionIndex }">
              <input type="radio" :name="`try-${current.id}`" :value="optionIndex" :checked="answers[current.id] === optionIndex" :disabled="finishing" @change="choose(optionIndex)" />
              <span class="rc-try__letter" aria-hidden="true">{{ optionLetter(optionIndex) }}</span>
              <span class="rc-try__text">{{ option }}</span>
            </label>
          </fieldset>
          <div class="rc-actions rc-try__moves">
            <PlayButton variant="outline" :disabled="index === 0" @click="goTo(index - 1)">Sebelumnya</PlayButton>
            <PlayButton variant="ghost" size="sm" :disabled="!(current.id in answers)" @click="clearAnswer">Kosongkan jawaban</PlayButton>
            <PlayButton v-if="index < questions.length - 1" @click="goTo(index + 1)">Berikutnya</PlayButton>
            <PlayButton v-else variant="secondary" @click="confirming = true">Selesai</PlayButton>
          </div>
          <p class="rc-hint">Pintasan: tekan A sampai E untuk memilih, panah kiri dan kanan untuk berpindah soal.</p>
        </section>

        <nav class="rc-try__nav" aria-label="Navigasi soal">
          <div v-for="group in groups" :key="group.key" class="rc-try__navgroup">
            <h3>{{ group.title }}</h3>
            <ul>
              <li v-for="entry in group.items" :key="entry.question.id">
                <button
                  type="button"
                  class="rc-try__dot"
                  :class="{ 'is-answered': entry.question.id in answers, 'is-current': entry.index === index }"
                  :aria-current="entry.index === index ? 'step' : undefined"
                  :aria-label="`Soal ${entry.index + 1}${entry.question.id in answers ? ', sudah dijawab' : ', belum dijawab'}`"
                  @click="goTo(entry.index)"
                >
                  {{ entry.index + 1 }}
                </button>
              </li>
            </ul>
          </div>
        </nav>
      </div>
    </template>
  </div>
</template>
