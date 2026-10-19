<script setup lang="ts">
import { personalizationApi } from '~/lib/api'
import { MAX_CONCEPT_TAGS, filterConcepts, pickerStatus, statusLabel, titleFor, toggleConcept, type TagLink } from '~/lib/concept-picker'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    links?: TagLink[]
    disabled?: boolean
    max?: number
  }>(),
  { links: () => [], disabled: false, max: MAX_CONCEPT_TAGS },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const search = ref('')
const searchId = useId()
const hintId = useId()

const ready = ref(false)
onMounted(() => {
  ready.value = true
})

const { data: options, status, error, refresh } = useAsyncData('concept-options', () => personalizationApi.concepts(), { lazy: true, server: false })

const all = computed(() => options.value ?? [])
const shown = computed(() => filterConcepts(all.value, search.value))
const atMax = computed(() => props.modelValue.length >= props.max)

const toggle = (id: string) => emit('update:modelValue', toggleConcept(props.modelValue, id, props.max))
</script>

<template>
  <fieldset class="rc-picker" :disabled="disabled" :aria-describedby="hintId">
    <legend class="rc-label">Konsep yang dibahas</legend>
    <p :id="hintId" class="rc-hint">
      Pilih konsep yang benar-benar kamu bahas. Setelah disetujui peninjau, karyamu disarankan kepada pelajar yang sedang membutuhkan konsep itu.
    </p>

    <ul v-if="modelValue.length" class="rc-picker__chosen" aria-label="Konsep terpilih">
      <li v-for="id in modelValue" :key="id" class="rc-picker__tag">
        <span class="rc-chip rc-chip--info">
          {{ titleFor(all, id) }}
          <button type="button" class="rc-picker__remove" :aria-label="`Hapus ${titleFor(all, id)}`" :disabled="disabled" @click="toggle(id)">
            <UIcon name="i-lucide-x" aria-hidden="true" />
          </button>
        </span>
        <span v-if="statusLabel(links, id)" class="rc-hint">{{ statusLabel(links, id) }}</span>
      </li>
    </ul>

    <label class="rc-label" :for="searchId">
      Cari konsep
      <input :id="searchId" v-model="search" type="search" class="rc-field" maxlength="60" placeholder="Contoh: jurnal penyesuaian" autocomplete="off" />
    </label>
    <p class="rc-hint" role="status">{{ pickerStatus(modelValue.length, max) }}</p>

    <p v-if="ready && status === 'pending'" class="rc-hint">Memuat daftar konsep…</p>
    <p v-else-if="ready && error" class="rc-alert rc-alert--error" role="alert">
      Daftar konsep belum bisa dimuat.
      <button type="button" class="rc-picker__retry" @click="refresh()">Coba lagi</button>
    </p>
    <ul v-else class="rc-picker__list" aria-label="Daftar konsep">
      <li v-for="option in shown" :key="option.id">
        <label class="rc-picker__item">
          <input type="checkbox" :checked="modelValue.includes(option.id)" :disabled="disabled || (atMax && !modelValue.includes(option.id))" @change="toggle(option.id)" />
          <span>
            {{ option.title }}
            <span class="rc-hint">Tingkat {{ option.level }}</span>
          </span>
        </label>
      </li>
      <li v-if="shown.length === 0" class="rc-hint">Tidak ada konsep yang cocok.</li>
    </ul>
  </fieldset>
</template>

<style>
.rc-picker {
  display: grid;
  gap: 0.625rem;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.rc-picker__chosen {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rc-picker__tag {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.rc-picker__remove,
.rc-picker__retry {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.rc-picker__retry {
  text-decoration: underline;
}
.rc-picker__remove:focus-visible,
.rc-picker__retry:focus-visible,
.rc-picker__item input:focus-visible {
  outline: 3px solid var(--rc-focus);
  outline-offset: 2px;
}
.rc-picker__list {
  display: grid;
  gap: 0.25rem;
  max-height: 14rem;
  margin: 0;
  padding: 0.5rem;
  overflow-y: auto;
  list-style: none;
  border: 2px solid var(--rc-border);
  border-radius: var(--rc-radius, 16px);
  background-color: var(--rc-surface);
}
.rc-picker__item {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.375rem 0.25rem;
  cursor: pointer;
}
.rc-picker__item input {
  flex: none;
  margin-top: 0.2rem;
  accent-color: var(--rc-primary);
}
.rc-picker__item span {
  display: grid;
}
</style>
