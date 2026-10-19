<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, noteProblem } from '~/lib/notes'

const props = withDefaults(
  defineProps<{
    open: boolean
    heading?: string
    initialTitle?: string
    initialBody?: string
    saving?: boolean
    failure?: string | null
  }>(),
  { heading: 'Catatan baru', initialTitle: '', initialBody: '', saving: false, failure: null },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: { title: string; body: string }]
}>()

const title = ref(props.initialTitle)
const body = ref(props.initialBody)
const touched = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    title.value = props.initialTitle
    body.value = props.initialBody
    touched.value = false
  },
)

const problem = computed(() => (touched.value ? noteProblem(title.value, body.value) : null))

function submit() {
  touched.value = true
  if (noteProblem(title.value, body.value)) return
  emit('save', { title: title.value.trim(), body: body.value.trim() })
}
</script>

<template>
  <UModal
    :open="open"
    :title="heading"
    description="Catatan ini hanya bisa kamu lihat sendiri."
    :ui="{ content: 'rc-learning-modal' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form class="rc-note-form" novalidate @submit.prevent="submit">
        <div>
          <label class="rc-label" for="note-title">Judul</label>
          <input id="note-title" v-model="title" class="rc-field" type="text" :maxlength="NOTE_TITLE_MAX" autocomplete="off" />
        </div>
        <div>
          <label class="rc-label" for="note-body">Isi catatan</label>
          <textarea id="note-body" v-model="body" class="rc-field" rows="8" :maxlength="NOTE_BODY_MAX" />
          <p class="rc-hint">{{ body.length }} / {{ NOTE_BODY_MAX }}</p>
        </div>
        <p v-if="problem || failure" class="rc-error-text" role="alert">{{ problem ?? failure }}</p>
        <div class="rc-note-form__actions">
          <PlayButton variant="ghost" @click="emit('update:open', false)">Batal</PlayButton>
          <PlayButton type="submit" :loading="saving">Simpan catatan</PlayButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

<style>
.rc-note-form {
  display: grid;
  gap: 1rem;
}
.rc-note-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
