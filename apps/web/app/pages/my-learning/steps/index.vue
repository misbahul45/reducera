<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AiGenerating from '~/components/ai/AiGenerating.vue'
import CitedText from '~/components/my-learning/CitedText.vue'
import PersonalityQuiz from '~/components/my-learning/PersonalityQuiz.vue'
import SourceList from '~/components/my-learning/SourceList.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import type { User } from '~/interfaces/auth'
import type { ChatCitation } from '~/interfaces/chats/chatExtras'
import { applyStageEvent, createStagePacer, introStages, parseStageEvent, type AiStage } from '~/lib/ai-stages'
import { normalizeCitations } from '~/lib/chat'
import { missingIdsProblem } from '~/lib/learning-ids'
import {
  PATH_WAIT_MS,
  POLL_MS,
  QUIZ_WAIT_MS,
  STREAM_SILENCE_MS,
  callout,
  initialJourney,
  introCompleted,
  pathStage,
  quizStage,
  waitExpired,
} from '~/lib/journey'
import { lessonsService } from '~/services/curriculum/lessons'
import { lessonProgressService } from '~/services/learning/lessonsProgress'
import { personalityQuizService } from '~/services/learning/personalityQuiz'
import { userStepService } from '~/services/learning/userStep'

const STAGE_GAP_MS = 450

const route = useRoute()
const toast = useToast()
useHead({ title: 'Pengantar | ReduCera' })
const user = useState<User | null>('user')
const { ensure: ensureLearningIds } = useLearningIds()

const lessonId = computed(() => (typeof route.query.lessonId === 'string' ? route.query.lessonId : ''))

const journey = reactive(initialJourney())
const stages = ref<AiStage[]>(introStages())
const streamText = ref('')
const savedText = ref('')
const citations = ref<ChatCitation[]>([])
const failure = ref<string | null>(null)
const setupProblem = ref<string | null>(null)
const quizOpen = ref(false)
const streamedHere = ref(false)
const firstStep = ref<{ stepId: string; userStepId: string } | null>(null)
const actionButton = ref<{ $el?: HTMLElement } | null>(null)

const { data: resProgress, refresh: refreshProgress } = await useAsyncData(
  () => `lesson-progress-${lessonId.value}`,
  () =>
    !lessonId.value
      ? null
      : lessonProgressService.findAll({ page: 1, limit: 1, userId: user.value?.id, lessonId: lessonId.value }),
)

const { data: resQuiz, refresh: refreshQuizData } = await useAsyncData(
  () => `personality-quiz-${lessonId.value}`,
  () =>
    !lessonId.value
      ? null
      : personalityQuizService.findAll({ page: 1, limit: 1, userId: user.value?.id, lessonId: lessonId.value }),
)

const { data: resLesson } = await useAsyncData(
  () => `intro-lesson-${lessonId.value}`,
  () => (!lessonId.value ? null : lessonsService.findOne<true>(lessonId.value, { include: 'steps' })),
)

const quiz = computed(() => resQuiz.value?.data?.data?.[0] ?? null)
const lessonTitle = computed(() => resLesson.value?.data?.title ?? '')

watch(
  resProgress,
  (value) => {
    const row = value?.data?.data?.[0]
    if (!row?.introduction || journey.introWriting) return
    savedText.value = row.introduction
    if (!streamedHere.value) citations.value = normalizeCitations(row.introductionCitations)
    journey.introSaved = true
    journey.introFailed = false
    journey.introBusyElsewhere = false
  },
  { immediate: true },
)

watch(
  quiz,
  (value) => {
    journey.quizExists = Boolean(value && value.questions.length > 0)
    journey.quizTaken = Boolean(value?.takenAt)
    journey.quizSize = value?.questions.length ?? 0
  },
  { immediate: true },
)

const shownText = computed(() => streamText.value || savedText.value)
const introStageList = computed<AiStage[]>(() =>
  journey.introSaved && !streamedHere.value ? introStages().map((stage) => ({ ...stage, state: 'done' as const })) : stages.value,
)
const pipelineStages = computed<AiStage[]>(() => [...introStageList.value, quizStage(journey), pathStage(journey)])
const calloutState = computed(() => callout(journey))
const busy = computed(
  () =>
    journey.introWriting ||
    journey.introBusyElsewhere ||
    (introCompleted(journey) && !journey.quizExists && !journey.quizTimedOut) ||
    (journey.quizTaken && !journey.stepsReady && !journey.pathTimedOut),
)
const pipelineNote = computed(() =>
  calloutState.value.kind === 'quiz-ready' ? 'Kuis sudah siap. Tekan tombol di bawah materi untuk memulai.' : '',
)

let source: EventSource | null = null
let silence: ReturnType<typeof setTimeout> | null = null
let quizSse: EventSource | null = null
let quizPoll: ReturnType<typeof setInterval> | null = null
let pathPoll: ReturnType<typeof setInterval> | null = null
let introPoll: ReturnType<typeof setInterval> | null = null
let quizStartedAt: number | null = null
let pathStartedAt: number | null = null
let introStartedAt: number | null = null

const pacer = createStagePacer((event) => {
  stages.value = applyStageEvent(stages.value, event)
}, STAGE_GAP_MS)

function clearSilence() {
  if (silence) clearTimeout(silence)
  silence = null
}

function armSilence() {
  clearSilence()
  silence = setTimeout(() => fail('Pembuatan pengantar terlalu lama tanpa kabar. Coba lagi.'), STREAM_SILENCE_MS)
}

function stopStream() {
  source?.close()
  source = null
  clearSilence()
}

function fail(message: string) {
  stopStream()
  pacer.stop()
  journey.introWriting = false
  journey.introFailed = true
  failure.value = message
  stages.value = stages.value.map((stage) => (stage.state === 'active' ? { ...stage, state: 'failed' as const } : stage))
}

function finish(raw: string) {
  stopStream()
  pacer.flush()
  let parsed: { text?: string; citations?: unknown; persisted?: boolean } = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = {}
  }
  if (parsed.text) streamText.value = parsed.text
  citations.value = normalizeCitations(parsed.citations)
  stages.value = applyStageEvent(stages.value, { key: 'writing', state: 'done', data: {} })
  journey.introWriting = false

  if (parsed.persisted) {
    savedText.value = streamText.value
    journey.introSaved = true
    refreshProgress()
    toast.add({ title: 'Pengantar selesai', description: 'Sumbernya tercantum di bawah teks.', color: 'success', icon: 'i-lucide-circle-check' })
    beginQuizWait()
    return
  }
  journey.introFailed = true
  failure.value = 'Pengantar selesai ditulis tetapi belum tersimpan. Buat ulang supaya tersimpan.'
}

async function startGenerate() {
  if (!lessonId.value || source) return
  failure.value = null
  setupProblem.value = null
  streamedHere.value = true
  Object.assign(journey, { introFailed: false, introBusyElsewhere: false, introSaved: false, introWriting: true })
  streamText.value = ''
  savedText.value = ''
  citations.value = []
  stages.value = introStages()

  const ids = await ensureLearningIds(lessonId.value)
  const missing = missingIdsProblem(ids)
  if (missing) {
    setupProblem.value = missing
    fail(missing)
    return
  }
  const stream = await personalityQuizService.generateStream({
    lessonId: lessonId.value,
    topicId: ids.topicId,
    learningStyleId: ids.learningStyleId,
    userId: user.value?.id as string,
  })
  source = stream
  armSilence()

  stream.addEventListener('stage', (event) => {
    armSilence()
    const parsed = parseStageEvent((event as MessageEvent).data)
    if (parsed) pacer.push(parsed)
  })
  stream.addEventListener('sources', (event) => {
    armSilence()
    try {
      citations.value = normalizeCitations(JSON.parse((event as MessageEvent).data))
    } catch {
      citations.value = []
    }
  })
  stream.addEventListener('introduction_chunk', (event) => {
    armSilence()
    streamText.value += (event as MessageEvent).data
  })
  const yieldToNewerRequest = () => {
    stopStream()
    journey.introWriting = false
    journey.introBusyElsewhere = true
    beginIntroWait()
  }
  stream.addEventListener('busy', yieldToNewerRequest)
  stream.addEventListener('superseded', yieldToNewerRequest)
  stream.addEventListener('end', (event) => finish((event as MessageEvent).data))
  stream.onerror = (event) => {
    const data = (event as MessageEvent).data
    if (!journey.introWriting) return
    fail(data ? 'Pengantar belum berhasil dibuat. Coba lagi.' : 'Koneksi terputus saat menulis pengantar. Coba lagi.')
  }
}

async function safeStart() {
  try {
    await startGenerate()
  } catch {
    fail('Pengantar belum bisa dimulai. Periksa koneksimu lalu coba lagi.')
  }
}

function beginIntroWait() {
  introStartedAt = Date.now()
  if (introPoll) clearInterval(introPoll)
  introPoll = setInterval(async () => {
    await refreshProgress()
    if (journey.introSaved) {
      stopIntroWait()
      beginQuizWait()
    } else if (waitExpired(introStartedAt, Date.now(), QUIZ_WAIT_MS)) {
      stopIntroWait()
      journey.introBusyElsewhere = false
      journey.introFailed = true
      failure.value = 'Pengantar belum muncul. Coba buat ulang.'
    }
  }, POLL_MS)
}

function stopIntroWait() {
  if (introPoll) clearInterval(introPoll)
  introPoll = null
}

function beginQuizWait() {
  if (journey.quizExists || quizPoll) return
  quizStartedAt = Date.now()
  journey.quizTimedOut = false
  quizSse = personalityQuizService.listenPersonalityQuizSse()
  quizSse.onmessage = () => {
    refreshQuizData()
  }
  quizPoll = setInterval(async () => {
    await refreshQuizData()
    if (journey.quizExists) stopQuizWait()
    else if (waitExpired(quizStartedAt, Date.now(), QUIZ_WAIT_MS)) {
      journey.quizTimedOut = true
      stopQuizWait()
    }
  }, POLL_MS)
}

function stopQuizWait() {
  quizSse?.close()
  quizSse = null
  if (quizPoll) clearInterval(quizPoll)
  quizPoll = null
}

watch(
  () => journey.quizExists,
  async (ready, was) => {
    if (!ready || was) return
    stopQuizWait()
    toast.add({ title: 'Kuis jalur belajar siap', description: `${journey.quizSize} soal dari sumber yang sama.`, color: 'success', icon: 'i-lucide-list-checks' })
    await nextTick()
    actionButton.value?.$el?.focus()
  },
)

async function checkSteps() {
  const templateIds = (resLesson.value?.data?.steps ?? []).map((step) => step.id)
  let total = 0
  let first: { stepId: string; userStepId: string } | null = null
  for (const stepId of templateIds) {
    const res = await userStepService.findAll({ page: 1, limit: 100, stepTemplateId: stepId, userId: user.value?.id, sort: 'order:asc' })
    const rows = res.data?.data ?? []
    total += rows.length
    if (!first && rows[0]) first = { stepId, userStepId: rows[0].id }
  }
  journey.stepCount = total
  firstStep.value = first
  journey.stepsReady = total > 0
}

function beginPathWait() {
  if (pathPoll) return
  pathStartedAt = Date.now()
  journey.pathTimedOut = false
  pathPoll = setInterval(async () => {
    await checkSteps()
    if (journey.stepsReady) stopPathWait()
    else if (waitExpired(pathStartedAt, Date.now(), PATH_WAIT_MS)) {
      journey.pathTimedOut = true
      stopPathWait()
    }
  }, POLL_MS)
}

function stopPathWait() {
  if (pathPoll) clearInterval(pathPoll)
  pathPoll = null
}

watch(
  () => journey.stepsReady,
  async (ready, was) => {
    if (!ready || was) return
    stopPathWait()
    toast.add({ title: 'Jalur belajarmu siap', description: `${journey.stepCount} langkah belajar.`, color: 'success', icon: 'i-lucide-route' })
    await nextTick()
    actionButton.value?.$el?.focus()
  },
)

async function retryQuiz() {
  const ids = await ensureLearningIds(lessonId.value)
  const missing = missingIdsProblem(ids)
  if (missing) {
    toast.add({ title: 'Kuis belum bisa dibuat ulang', description: missing, color: 'error' })
    return
  }
  const result = await personalityQuizService.requestQuiz({
    lessonId: lessonId.value,
    topicId: ids.topicId,
    learningStyleId: ids.learningStyleId,
    userId: user.value?.id as string,
  })
  if (!result.success) {
    toast.add({ title: 'Kuis belum bisa dibuat ulang', description: 'Coba lagi sebentar lagi.', color: 'error' })
    return
  }
  journey.quizTimedOut = false
  stopQuizWait()
  beginQuizWait()
}

async function onAction() {
  const state = calloutState.value
  if (state.kind === 'quiz-ready') quizOpen.value = true
  else if (state.kind === 'quiz-failed') await retryQuiz()
  else if (state.kind === 'path-failed') {
    journey.pathTimedOut = false
    await checkSteps()
    if (!journey.stepsReady) beginPathWait()
  } else if (state.kind === 'path-ready' && firstStep.value) {
    await navigateTo(`/my-learning/steps/${firstStep.value.stepId}/${firstStep.value.userStepId}`)
  }
}

async function onSubmitted() {
  journey.quizTaken = true
  refreshQuizData()
  beginPathWait()
}

onMounted(async () => {
  if (!lessonId.value) return
  if (!journey.introSaved) {
    await safeStart()
    return
  }
  if (!journey.quizExists) beginQuizWait()
  if (journey.quizTaken) {
    await checkSteps()
    if (!journey.stepsReady) beginPathWait()
  }
})

onBeforeUnmount(() => {
  stopStream()
  pacer.stop()
  stopQuizWait()
  stopPathWait()
  stopIntroWait()
})
</script>

<template>
  <div class="rc-stack rc-learning">
    <EmptyState
      v-if="!lessonId"
      icon-name="i-lucide-book-open"
      title="Pilih pelajaran dulu"
      message="Buka pelajaran dari jalur belajar, lalu tekan Mulai belajar."
      cta-label="Ke course saya"
      cta-to="/learn/profile/my-learning"
    />
    <template v-else>
      <PageHeader title="Pengantar" subtitle="Ringkasan pelajaran ini dibuat untuk gaya belajarmu, hanya dari sumber course yang ada di database." />

      <AiGenerating
        v-if="!journey.stepsReady"
        title="Menyiapkan pelajaranmu"
        done-title="Tahap selesai, tinggal giliranmu"
        :stages="pipelineStages"
        :busy="busy"
        :note="pipelineNote"
      />

      <PlayCard as="section" aria-labelledby="intro-content">
        <h2 id="intro-content" class="rc-h2">Materi pengantar</h2>

        <EmptyState
          v-if="setupProblem && !shownText"
          icon-name="i-lucide-user-round-cog"
          title="Lengkapi pengaturan belajarmu dulu"
          :message="setupProblem"
          cta-label="Ke course saya"
          cta-to="/learn/profile/my-learning"
        />
        <ErrorState
          v-else-if="failure && !shownText"
          title="Pengantar belum berhasil dibuat"
          :message="failure"
          retry-label="Buat ulang pengantar"
          @retry="safeStart()"
        />
        <p v-else-if="journey.introBusyElsewhere" class="rc-hint" role="status">
          Pengantar sedang disiapkan di tab lain. Halaman ini akan terisi sendiri.
        </p>
        <div v-else-if="!shownText" class="rc-stepgroup__loading" aria-busy="true">
          <span v-for="value in 4" :key="value" class="rc-skel rc-skel--line"></span>
        </div>
        <template v-else>
          <CitedText :text="shownText" :citations="citations" prefix="intro" />
          <SourceList v-if="!journey.introWriting" :citations="citations" prefix="intro" title="Sumber pengantar" note />
          <div v-if="failure" class="rc-alert" role="alert">
            <p>{{ failure }}</p>
            <PlayButton size="sm" variant="outline" @click="safeStart()">Buat ulang pengantar</PlayButton>
          </div>
        </template>
      </PlayCard>

      <PlayCard
        v-if="calloutState.kind !== 'hidden'"
        as="section"
        :tone="calloutState.kind === 'quiz-ready' || calloutState.kind === 'path-ready' ? 'success' : 'soft'"
        aria-labelledby="journey-callout"
      >
        <h2 id="journey-callout" class="rc-h2">{{ calloutState.title }}</h2>
        <p class="rc-hint" role="status" aria-live="polite">{{ calloutState.message }}</p>
        <PlayButton v-if="calloutState.actionLabel" ref="actionButton" size="lg" @click="onAction">
          {{ calloutState.actionLabel }}
        </PlayButton>
      </PlayCard>

      <PersonalityQuiz v-model:open="quizOpen" :quiz="quiz" :lesson-id="lessonId" :lesson-title="lessonTitle" @submitted="onSubmitted" />
    </template>
  </div>
</template>
