<script setup lang="ts">
import { personalizationApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import { reminderStatus } from '~/lib/review'

const props = defineProps<{ enabled: boolean }>()
const emit = defineEmits<{ changed: [enabled: boolean] }>()

const checked = ref(props.enabled)
const busy = ref(false)
const problem = ref<string | null>(null)
const inputId = useId()

watch(
  () => props.enabled,
  (value) => {
    checked.value = value
  },
)

async function change(event: Event) {
  const next = (event.target as HTMLInputElement).checked
  if (busy.value) return
  busy.value = true
  problem.value = null
  try {
    const saved = await personalizationApi.setReviewReminders(next)
    checked.value = saved.reminders
    emit('changed', saved.reminders)
  } catch (err) {
    checked.value = !next
    problem.value = describeApiError(err, 'Pengaturan pengingat belum bisa disimpan.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="rc-remind">
    <label class="rc-check" :for="inputId">
      <input :id="inputId" type="checkbox" :checked="checked" :disabled="busy" @change="change" />
      <span>
        Ingatkan saya setiap hari
        <span class="rc-hint" role="status">{{ reminderStatus(checked) }}</span>
      </span>
    </label>
    <p v-if="problem" class="rc-alert rc-alert--error" role="alert">{{ problem }}</p>
  </div>
</template>

<style>
.rc-remind {
  display: grid;
  gap: 0.5rem;
}
</style>
