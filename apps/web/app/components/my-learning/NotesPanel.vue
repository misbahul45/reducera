<script setup lang="ts">
import { computed, ref } from 'vue'
import { noteService } from '~/services/notes'
import type { NoteView } from '~/lib/notes'
import NoteComposerDialog from './NoteComposerDialog.vue'
import NoteItem from './NoteItem.vue'

const props = defineProps<{ userStepId: string }>()

const toast = useToast()

const { data, refresh } = await useAsyncData(`notes-step-${props.userStepId}`, () =>
  noteService.list({ userStepId: props.userStepId, page: 1, limit: 20 }),
)
const notes = computed<NoteView[]>(() => data.value?.data?.data ?? [])
const total = computed(() => data.value?.data?.meta?.total ?? notes.value.length)

const open = ref(false)
const saving = ref(false)
const failure = ref<string | null>(null)
const editing = ref<NoteView | null>(null)

function openNew() {
  editing.value = null
  failure.value = null
  open.value = true
}

function openEdit(note: NoteView) {
  editing.value = note
  failure.value = null
  open.value = true
}

async function save(value: { title: string; body: string }) {
  saving.value = true
  failure.value = null
  const result = editing.value
    ? await noteService.update(editing.value.id, value)
    : await noteService.create({ ...value, userStepId: props.userStepId, source: 'MANUAL' })
  saving.value = false
  if (!result.success) {
    failure.value = 'Catatan belum tersimpan. Coba lagi sebentar lagi.'
    return
  }
  open.value = false
  toast.add({ title: editing.value ? 'Catatan diperbarui' : 'Catatan tersimpan', color: 'success', icon: 'i-lucide-notebook-pen' })
  await refresh()
}

async function remove(note: NoteView) {
  const result = await noteService.remove(note.id)
  if (!result.success) {
    toast.add({ title: 'Catatan belum terhapus', description: 'Coba lagi sebentar lagi.', color: 'error' })
    return
  }
  await refresh()
}
</script>

<template>
  <PlayCard as="section" aria-labelledby="step-notes-title">
    <div class="rc-row rc-notes__head">
      <h2 id="step-notes-title" class="rc-h2">Catatanku</h2>
      <PlayButton size="sm" variant="outline" @click="openNew">
        <UIcon name="i-lucide-notebook-pen" aria-hidden="true" />
        Tulis catatan
      </PlayButton>
    </div>

    <p v-if="notes.length === 0" class="rc-hint">
      Belum ada catatan untuk langkah ini. Tulis sendiri, atau minta CORE menyimpan penjelasan yang berguna.
    </p>
    <div v-else class="rc-stack">
      <NoteItem v-for="note in notes" :key="note.id" :note="note" @edit="openEdit(note)" @remove="remove(note)" />
      <p v-if="total > notes.length" class="rc-hint">
        Menampilkan {{ notes.length }} dari {{ total }} catatan.
        <NuxtLink to="/my-learning/notes">Lihat semua catatan</NuxtLink>
      </p>
    </div>

    <NoteComposerDialog
      v-model:open="open"
      :heading="editing ? 'Ubah catatan' : 'Catatan baru'"
      :initial-title="editing?.title ?? ''"
      :initial-body="editing?.body ?? ''"
      :saving="saving"
      :failure="failure"
      @save="save"
    />
  </PlayCard>
</template>

<style>
.rc-notes__head {
  justify-content: space-between;
  gap: 0.75rem;
}
</style>
