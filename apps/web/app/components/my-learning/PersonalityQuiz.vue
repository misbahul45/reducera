<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '~/composable/useApi'
import type { PersonalityQuiz, PersonalityQuizUserAttemptItem } from '~/interfaces/learning/personalityQuiz'
import { normalizeCitations } from '~/lib/chat'
import { attemptFor, submitOutcome } from '~/lib/placement-quiz'
import { personalityQuizService } from '~/services/learning/personalityQuiz'
import SourceList from './SourceList.vue'

const props = defineProps<{
  open: boolean
  quiz: PersonalityQuiz | null
  lessonId: string
  lessonTitle?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  submitted: []
}>()

const { ensure: ensureLearningIds } = useLearningIds()
const { call, loading, respon } = useApi(personalityQuizService.submitQuiz)
const toast = useToast()

const questions = computed(() => props.quiz?.questions ?? [])
const quizCitations = computed(() => normalizeCitations(props.quiz?.sources))

const showQuiz = ref(0)
const answers = ref<PersonalityQuizUserAttemptItem[]>([])
const direction = ref('next')
const failure = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    showQuiz.value = 0
    answers.value = []
    failure.value = null
  },
)

const current = computed(() => questions.value[showQuiz.value])
const currentCitations = computed(() => {
  const wanted = current.value?.sources ?? []
  return quizCitations.value.filter((citation) => wanted.includes(citation.index))
})
const answerOf = (question: string) => answers.value.find((item) => item.question === question)

const setAnswer = (value: PersonalityQuizUserAttemptItem) => {
  const index = answers.value.findIndex((item) => item.question === value.question)
  if (index !== -1) answers.value[index] = value
  else answers.value.push(value)
}

const onInputChange = (event: Event, question: string) => {
  setAnswer({ question, userAnswer: (event.target as HTMLTextAreaElement).value })
}

const answered = computed(() => Boolean(current.value && answerOf(current.value.question)?.userAnswer?.trim()))
const isLast = computed(() => showQuiz.value === questions.value.length - 1)
const complete = computed(() => questions.value.length > 0 && questions.value.every((item) => answerOf(item.question)?.userAnswer?.trim()))

const next = () => {
  if (!answered.value) return
  direction.value = 'next'
  if (!isLast.value) showQuiz.value++
}

const back = () => {
  direction.value = 'back'
  if (showQuiz.value > 0) showQuiz.value--
}

const submit = async () => {
  if (!props.quiz || !complete.value) return
  failure.value = null

  const ids = await ensureLearningIds(props.lessonId)
  await call(props.quiz.id, { learningStyleId: ids.learningStyleId }, attemptFor(questions.value, answers.value))

  const outcome = submitOutcome(respon.value)
  if (outcome.kind === 'failed') {
    failure.value = outcome.message
    return
  }

  toast.add({
    title: outcome.kind === 'submitted' ? 'Jawabanmu terkirim' : 'Jawabanmu sudah terkirim',
    description: 'Jalur belajarmu sedang disusun.',
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
  emit('submitted')
  emit('update:open', false)
}

const trySubmit = async () => {
  try {
    await submit()
  } catch {
    failure.value = 'Jawabanmu belum terkirim. Coba kirim lagi.'
  }
}
</script>

<template>
  <UModal :open="open" fullscreen @update:open="emit('update:open', $event)">
    <template #content>
      <div class="rc-quiz">
        <header class="rc-quiz__head">
          <div>
            <h2 class="rc-quiz__title">Kuis jalur belajar</h2>
            <p class="rc-hint">{{ lessonTitle }}</p>
          </div>
          <PlayButton variant="ghost" size="sm" aria-label="Tutup kuis, jawabanmu belum dikirim" @click="emit('update:open', false)">Tutup</PlayButton>
        </header>

        <div v-if="questions.length > 0 && current" class="rc-quiz__body">
          <PlayProgress
            :value="((showQuiz + 1) / questions.length) * 100"
            :label="`Soal ${showQuiz + 1} dari ${questions.length}`"
            tone="success"
          />

          <Transition name="fade" mode="out-in">
            <div :key="showQuiz" class="rc-quiz__question">
              <UiRenderMarkdown :text="current.question" />

              <div class="rc-quiz__answers">
                <template v-if="current.type === 'multiple_choice'">
                  <button
                    v-for="value in current.options"
                    :key="value"
                    type="button"
                    class="rc-quiz__option"
                    :aria-pressed="answerOf(current.question)?.userAnswer === value"
                    @click="setAnswer({ question: current.question, userAnswer: value })"
                  >
                    {{ value }}
                  </button>
                </template>

                <template v-else>
                  <label class="rc-label" for="quiz-answer">Jawabanmu</label>
                  <textarea
                    id="quiz-answer"
                    class="rc-field"
                    rows="4"
                    :value="answerOf(current.question)?.userAnswer || ''"
                    placeholder="Tulis jawabanmu di sini"
                    @input="onInputChange($event, current.question)"
                  ></textarea>
                </template>
              </div>

              <SourceList
                v-if="currentCitations.length"
                :citations="currentCitations"
                :prefix="`quiz-${showQuiz}`"
                title="Soal ini disusun dari"
              />
            </div>
          </Transition>

          <p v-if="failure" class="rc-error-text" role="alert">{{ failure }}</p>

          <div class="rc-quiz__nav">
            <PlayButton variant="outline" :disabled="showQuiz === 0" @click="back">Sebelumnya</PlayButton>

            <PlayButton v-if="isLast" :disabled="!complete" :loading="loading" @click="trySubmit">Kirim jawaban</PlayButton>
            <PlayButton v-else :disabled="!answered" @click="next">Berikutnya</PlayButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style>
.rc-quiz {
  display: grid;
  gap: 1.5rem;
  align-content: start;
  width: 100%;
  max-width: 42rem;
  height: 100dvh;
  margin: 0 auto;
  padding: 1.5rem 1rem 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background-color: var(--rc-surface);
  color: var(--rc-fg);
}
.rc-quiz__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.rc-quiz__title {
  margin: 0;
  font-size: 1.5rem;
}
.rc-quiz__body,
.rc-quiz__question {
  display: grid;
  gap: 1.25rem;
}
.rc-quiz__answers {
  display: grid;
  gap: 0.75rem;
}
.rc-quiz__option {
  width: 100%;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  border: 2px solid var(--rc-border);
  border-radius: calc(var(--rc-radius, 16px) - 2px);
  background-color: var(--rc-surface);
  box-shadow: 0 var(--rc-depth, 4px) 0 0 var(--rc-border);
  color: var(--rc-fg);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.rc-quiz__option:hover {
  background-color: var(--rc-foam);
}
.rc-quiz__option[aria-pressed="true"] {
  border-color: var(--rc-secondary);
  background-color: color-mix(in srgb, var(--rc-secondary) 12%, var(--rc-surface));
  box-shadow: 0 var(--rc-depth, 4px) 0 0 var(--rc-secondary-depth);
}
.rc-quiz__option:focus-visible {
  outline: 3px solid var(--rc-focus);
  outline-offset: 3px;
}
.rc-quiz__nav {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem 0 1rem;
  background-color: var(--rc-surface);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>
