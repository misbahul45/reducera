<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import LearningPath from '~/components/play/LearningPath.vue'
import PlayProgress from '~/components/play/PlayProgress.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import { buildStepPath, pathSummary } from '~/lib/learning-path'
import { fetchLessonStepGroups } from '~/services/learning/lessonStepPath'
import { userStepService } from '~/services/learning/userStep'

const props = defineProps<{
  lessonId: string
  userId: string
  activeId?: string | null
}>()

const { data: groups, status, refresh } = await useAsyncData(
  () => `lesson-step-path-${props.userId}-${props.lessonId}`,
  () => fetchLessonStepGroups(props.lessonId, props.userId),
  { watch: [() => props.lessonId, () => props.userId] },
)

const nodes = computed(() => buildStepPath(groups.value, { lessonId: props.lessonId, activeId: props.activeId }))
const summary = computed(() => pathSummary(nodes.value))
const loading = computed(() => status.value === 'pending' && nodes.value.length === 0)

let source: EventSource | null = null

const stopListening = () => {
  source?.close()
  source = null
}

const startListening = () => {
  if (import.meta.server || source) return
  source = userStepService.listenUserStepsSse()
  source.onmessage = async (event) => {
    try {
      if (JSON.parse(event.data)?.userId !== props.userId) return
    } catch {
      return
    }
    await refresh()
    if (nodes.value.length > 0) stopListening()
  }
  source.onerror = stopListening
}

watch(
  () => nodes.value.length > 0,
  (ready) => (ready ? stopListening() : startListening()),
  { immediate: true },
)

onBeforeUnmount(stopListening)
</script>

<template>
  <div class="rc-steppath">
    <PlayProgress
      v-if="summary.total"
      :value="summary.percent"
      :label="`${summary.done} dari ${summary.total} langkah selesai`"
      tone="success"
      show-value
    />
    <p v-if="summary.total" class="rc-hint">{{ summary.done }} dari {{ summary.total }} langkah selesai.</p>

    <LoadingSkeleton v-if="loading" variant="card" :count="3" aria-label="Memuat jalur langkah" />
    <p v-else-if="nodes.length === 0" class="rc-hint" role="status">Langkah muncul setelah kuis gaya belajar selesai dan materinya siap.</p>
    <LearningPath v-else :nodes="nodes" />
  </div>
</template>

<style>
.rc-steppath {
  display: grid;
  gap: 0.75rem;
}
</style>
