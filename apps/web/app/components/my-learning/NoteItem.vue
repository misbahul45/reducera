<script setup lang="ts">
import { ref } from 'vue'
import { noteDate, stepLink, type NoteView } from '~/lib/notes'

defineProps<{ note: NoteView; showStep?: boolean }>()
const emit = defineEmits<{ edit: []; remove: [] }>()

const confirming = ref(false)

function remove() {
  confirming.value = false
  emit('remove')
}
</script>

<template>
  <PlayCard as="article" class="rc-note">
    <header class="rc-note__head">
      <h3 class="rc-note__title">{{ note.title }}</h3>
      <span class="rc-hint">{{ noteDate(note.createdAt) }}</span>
    </header>
    <p class="rc-note__body">{{ note.body }}</p>
    <p v-if="showStep && stepLink(note)" class="rc-hint">
      Dari langkah:
      <NuxtLink :to="stepLink(note)!">{{ note.userStepTitle ?? 'Langkah belajar' }}</NuxtLink>
    </p>
    <footer class="rc-note__actions">
      <template v-if="!confirming">
        <PlayButton variant="ghost" size="sm" @click="emit('edit')">Ubah</PlayButton>
        <PlayButton variant="ghost" size="sm" @click="confirming = true">Hapus</PlayButton>
      </template>
      <template v-else>
        <span class="rc-hint" role="alert">Hapus catatan ini?</span>
        <PlayButton variant="danger" size="sm" @click="remove">Ya, hapus</PlayButton>
        <PlayButton variant="ghost" size="sm" @click="confirming = false">Batal</PlayButton>
      </template>
    </footer>
  </PlayCard>
</template>

<style>
.rc-note {
  display: grid;
  gap: 0.5rem;
}
.rc-note__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}
.rc-note__title {
  margin: 0;
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.rc-note__body {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}
.rc-note__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
}
</style>
