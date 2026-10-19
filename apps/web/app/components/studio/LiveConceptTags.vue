<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue'
import ConceptPicker from '~/components/studio/ConceptPicker.vue'
import { studioArticlesApi, studioClassesApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import { sameSet, type TagLink } from '~/lib/concept-picker'
import { liveTagHint, liveTagSavedMessage } from '~/lib/studio'

const props = defineProps<{
  kind: 'article' | 'class'
  id: string
  status: string
  links: TagLink[]
}>()

const emit = defineEmits<{ saved: [] }>()

const savedIds = computed(() => props.links.map((link) => link.conceptId))
const chosen = ref<string[]>([...savedIds.value])
const dirty = computed(() => !sameSet(chosen.value, savedIds.value))
const saving = ref(false)
const notice = ref<string | null>(null)
const problem = ref<string | null>(null)
const hintId = useId()

watch(savedIds, (value) => {
  chosen.value = [...value]
})

async function save() {
  if (saving.value || !dirty.value) return
  saving.value = true
  notice.value = null
  problem.value = null
  try {
    const api = props.kind === 'article' ? studioArticlesApi : studioClassesApi
    await api.setConcepts(props.id, chosen.value)
    notice.value = liveTagSavedMessage(props.status)
    emit('saved')
  } catch (err) {
    problem.value = describeApiError(err, 'Tag gagal disimpan.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="rc-live-tags" :aria-describedby="hintId">
    <p :id="hintId" class="rc-alert" role="note">{{ liveTagHint(status) }}</p>
    <ConceptPicker v-model="chosen" :links="links" :disabled="saving" />
    <p v-if="notice" class="rc-alert rc-alert--success" role="status">{{ notice }}</p>
    <p v-if="problem" class="rc-alert rc-alert--error" role="alert">{{ problem }}</p>
    <div class="rc-actions">
      <PlayButton variant="secondary" :loading="saving" :disabled="!dirty" @click="save">Simpan tag</PlayButton>
    </div>
  </section>
</template>

<style>
.rc-live-tags {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
