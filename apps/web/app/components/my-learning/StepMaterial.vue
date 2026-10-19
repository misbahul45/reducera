<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { normalizeCitations } from '~/lib/chat'
import { materialVersions, versionLabel } from '~/lib/material'
import { noteDate } from '~/lib/notes'
import { contentService } from '~/services/chat/contents'
import CitedText from './CitedText.vue'
import SourceList from './SourceList.vue'

const props = defineProps<{ chatId: string }>()

const POLL_MS = 4000
const POLL_LIMIT = 45

const { data, refresh } = await useAsyncData(`step-material-${props.chatId}`, () =>
  contentService.findAll({ chatId: props.chatId, sort: 'createdAt:desc', page: 1, limit: 10 }),
)

const raw = computed(() => data.value?.data?.data ?? [])
const versions = computed(() => materialVersions(raw.value.map((item) => ({ id: item.id, data: item.data, createdAt: item.createdAt as string }))))
const latest = computed(() => versions.value[0] ?? null)
const earlier = computed(() => versions.value.slice(1))
const citationsOf = (id: string | undefined) => normalizeCitations(raw.value.find((item) => item.id === id)?.citations)
const latestCitations = computed(() => citationsOf(latest.value?.id))

let source: EventSource | null = null
let timer: ReturnType<typeof setInterval> | null = null
let polls = 0

onMounted(() => {
  source = contentService.listenChatContent()
  source.onmessage = (event) => {
    try {
      if (JSON.parse(event.data)?.chatId === props.chatId) refresh()
    } catch {
      return
    }
  }
  timer = setInterval(() => {
    if (latest.value || polls >= POLL_LIMIT) return
    polls += 1
    refresh()
  }, POLL_MS)
})

onBeforeUnmount(() => {
  source?.close()
  if (timer) clearInterval(timer)
})
</script>

<template>
  <PlayCard id="step-material" as="section" aria-labelledby="step-material-title">
    <div class="rc-row rc-material__head">
      <h2 id="step-material-title" class="rc-h2">Materi</h2>
      <span v-if="latest" class="rc-chip rc-chip--info">{{ versionLabel(latest) }} · {{ noteDate(latest.createdAt) }}</span>
    </div>

    <CitedText v-if="latest" :text="latest.data" :citations="latestCitations" :prefix="latest.id" />
    <p v-else class="rc-hint" role="status">Materi untuk langkah ini sedang disiapkan. Halaman ini akan terisi sendiri begitu selesai.</p>

    <SourceList v-if="latest" :citations="latestCitations" :prefix="latest.id" title="Sumber materi" note />

    <details v-if="earlier.length" class="rc-material__earlier">
      <summary>Versi sebelumnya ({{ earlier.length }})</summary>
      <article v-for="version in earlier" :key="version.id" class="rc-material__version">
        <p class="rc-hint">{{ versionLabel(version) }} · {{ noteDate(version.createdAt) }}</p>
        <CitedText :text="version.data" :citations="citationsOf(version.id)" :prefix="version.id" />
        <SourceList :citations="citationsOf(version.id)" :prefix="version.id" title="Sumber versi ini" />
      </article>
    </details>
  </PlayCard>
</template>

<style>
.rc-material__head {
  justify-content: space-between;
  gap: 0.75rem;
}
.rc-material__earlier {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 2px solid var(--rc-border);
}
.rc-material__earlier summary {
  cursor: pointer;
  font-weight: 800;
}
.rc-material__version {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 2px dashed var(--rc-border);
}
</style>
