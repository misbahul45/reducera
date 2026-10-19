<script setup lang="ts">
import { computed, ref } from 'vue'
import Chatbot from '~/components/my-learning/Chatbot.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import NotesPanel from '~/components/my-learning/NotesPanel.vue'
import StepMaterial from '~/components/my-learning/StepMaterial.vue'
import { personalizationApi } from '~/lib/api'
import { reviewParam, reviewQuiz } from '~/lib/review'
import { userStepService } from '~/services/learning/userStep'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const userStepId = computed(() => String(route.params.userStepId || ''))

const { data: response, refresh } = await useAsyncData(
  () => `user-step-${userStepId.value}`,
  () => userStepService.findOne<true>(userStepId.value, { include: 'chat' }),
  { watch: [userStepId] },
)

const step = computed(() => response.value?.data ?? null)
const completing = ref(false)

const reviewConceptId = computed(() => reviewParam(route.query))
const { data: conceptOptions } = useAsyncData(
  () => `review-concepts-${reviewConceptId.value ?? 'none'}`,
  async () => (reviewConceptId.value ? await personalizationApi.concepts() : []),
  { lazy: true, server: false, watch: [reviewConceptId] },
)
const reviewAction = computed(() => {
  const title = conceptOptions.value?.find((concept) => concept.id === reviewConceptId.value)?.title
  return title ? reviewQuiz(title) : null
})

function clearReviewParam() {
  const { ulas: _removed, ...rest } = route.query
  router.replace({ query: rest })
}

useHead({ title: computed(() => `${step.value?.title ?? 'Langkah belajar'} | ReduCera`) })

async function complete() {
  if (!step.value || completing.value) return
  completing.value = true
  try {
    const result = await userStepService.complete(step.value.id)
    if (result.success) {
      await refresh()
      toast.add({ title: 'Langkah selesai', color: 'success', icon: 'i-lucide-check-circle' })
      return
    }
    toast.add({ title: 'Langkah belum bisa diselesaikan', description: 'Coba lagi sebentar lagi.', color: 'error' })
  } finally {
    completing.value = false
  }
}
</script>

<template>
  <div class="rc-stack rc-learning">
    <EmptyState
      v-if="!step"
      icon-name="i-lucide-file-question"
      title="Langkah tidak ditemukan"
      message="Langkah ini tidak ada atau bukan milikmu."
      cta-label="Kembali ke pelajaran"
      cta-to="/my-learning/steps"
    />

    <template v-else>
      <PageHeader :title="step.title">
        <template #actions>
          <PlayButton variant="outline" size="sm" @click="router.back()">Kembali</PlayButton>
        </template>
      </PageHeader>

      <StepMaterial v-if="step.chat?.id" :chat-id="step.chat.id" />
      <PlayCard v-else as="section" aria-labelledby="step-content">
        <h2 id="step-content" class="rc-h2">Materi</h2>
        <p class="rc-hint">Materi untuk langkah ini sedang disiapkan.</p>
      </PlayCard>

      <PlayCard as="section" aria-labelledby="step-practice">
        <h2 id="step-practice" class="rc-h2">Latihan</h2>
        <p v-if="step.quizId" class="rc-hint">Soal latihan sudah siap. Nilainya ikut menghitung penguasaanmu.</p>
        <p v-else class="rc-hint">Belum ada soal latihan. Tekan Tanya CORE lalu pilih Buat soal latihan, nanti soalnya muncul di sini.</p>
        <PlayButton v-if="step.quizId" :to="`/my-learning/quizzes/${step.quizId}`">Kerjakan soal latihan</PlayButton>
      </PlayCard>

      <NotesPanel :user-step-id="step.id" />

      <div class="rc-lessons__nav">
        <Chatbot v-if="step.chat?.id" :chat-id="step.chat.id" :user-step-id="step.id" :auto-action="reviewAction" @auto-started="clearReviewParam" />
        <PlayButton v-if="!step.isDone" :loading="completing" @click="complete">Tandai selesai</PlayButton>
        <p v-else class="rc-alert rc-alert--success" role="status">Langkah ini sudah selesai.</p>
      </div>
    </template>
  </div>
</template>
