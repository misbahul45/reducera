<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import NoteComposerDialog from '~/components/my-learning/NoteComposerDialog.vue'
import NoteItem from '~/components/my-learning/NoteItem.vue'
import { describeApiError } from '~/lib/api-error'
import type { NoteView } from '~/lib/notes'
import { noteService } from '~/services/notes'

definePageMeta({
  title: 'Catatanku — ReduCera',
  protection: { kind: 'authenticated' },
})

useHead({ title: 'Catatanku — ReduCera' })

const PAGE_SIZE = 20
const DEBOUNCE_MS = 300

const toast = useToast()
const typed = ref('')
const query = ref('')
const page = ref(1)

let timer: ReturnType<typeof setTimeout> | null = null
watch(typed, (value) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    query.value = value.trim()
    page.value = 1
  }, DEBOUNCE_MS)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const { data, status, error, refresh } = await useAsyncData(
  () => `notes-all-${query.value}-${page.value}`,
  async () => {
    const result = await noteService.list({ page: page.value, limit: PAGE_SIZE, ...(query.value ? { q: query.value } : {}) })
    if (!result.success) throw new Error(result.message ?? 'Catatan gagal dimuat')
    return result.data
  },
  { watch: [query, page] },
)

const notes = computed<NoteView[]>(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 })

const open = ref(false)
const saving = ref(false)
const failure = ref<string | null>(null)
const editing = ref<NoteView | null>(null)

function openEdit(note: NoteView) {
  editing.value = note
  failure.value = null
  open.value = true
}

async function save(value: { title: string; body: string }) {
  if (!editing.value) return
  saving.value = true
  failure.value = null
  const result = await noteService.update(editing.value.id, value)
  saving.value = false
  if (!result.success) {
    failure.value = 'Catatan belum tersimpan. Coba lagi sebentar lagi.'
    return
  }
  open.value = false
  toast.add({ title: 'Catatan diperbarui', color: 'success', icon: 'i-lucide-notebook-pen' })
  await refresh()
}

async function remove(note: NoteView) {
  const result = await noteService.remove(note.id)
  if (!result.success) {
    toast.add({ title: 'Catatan belum terhapus', description: 'Coba lagi sebentar lagi.', color: 'error' })
    return
  }
  if (notes.value.length === 1 && page.value > 1) page.value -= 1
  await refresh()
}
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Catatanku" subtitle="Semua catatan dari langkah belajarmu, termasuk yang disimpan dari CORE." />

    <div>
      <label class="rc-label" for="notes-search">Cari catatan</label>
      <input id="notes-search" v-model="typed" class="rc-field" type="search" placeholder="Cari di judul atau isi catatan" autocomplete="off" />
    </div>

    <LoadingSkeleton v-if="status === 'pending' && !data" variant="panel" :count="2" />
    <ErrorState v-else-if="error" title="Catatan gagal dimuat" :message="describeApiError(error)" @retry="refresh()" />
    <EmptyState
      v-else-if="notes.length === 0"
      icon-name="i-lucide-notebook-pen"
      :title="query ? 'Tidak ada catatan yang cocok' : 'Belum ada catatan'"
      :message="query ? 'Coba kata kunci lain.' : 'Tulis catatan dari halaman langkah belajar, atau minta CORE menyimpan penjelasan yang berguna.'"
      cta-label="Mulai belajar"
      cta-to="/my-learning/steps"
    />
    <div v-else class="rc-stack">
      <NoteItem v-for="note in notes" :key="note.id" :note="note" show-step @edit="openEdit(note)" @remove="remove(note)" />

      <nav v-if="meta.totalPages > 1" class="rc-row rc-notes__pager" aria-label="Halaman catatan">
        <PlayButton variant="outline" size="sm" :disabled="page <= 1" @click="page -= 1">Sebelumnya</PlayButton>
        <span class="rc-hint">Halaman {{ meta.page }} dari {{ meta.totalPages }}</span>
        <PlayButton variant="outline" size="sm" :disabled="page >= meta.totalPages" @click="page += 1">Berikutnya</PlayButton>
      </nav>
    </div>

    <NoteComposerDialog
      v-model:open="open"
      heading="Ubah catatan"
      :initial-title="editing?.title ?? ''"
      :initial-body="editing?.body ?? ''"
      :saving="saving"
      :failure="failure"
      @save="save"
    />
  </div>
</template>

<style>
.rc-notes__pager {
  justify-content: space-between;
  gap: 0.75rem;
}
</style>
