<script setup lang="ts">
import { CANARY_MAX_PERCENT, CANARY_MIN_PERCENT, REASON_MAX, canaryProblem, reasonProblem } from '~/lib/admin';

const props = withDefaults(defineProps<{ open: boolean; busy?: boolean; error?: string | null }>(), { busy: false, error: null });
const emit = defineEmits<{ confirm: [payload: { percent: number; reason: string }]; cancel: [] }>();

const percent = ref(10);
const reason = ref('');
const touched = ref(false);
const field = ref<HTMLInputElement | null>(null);
const titleId = useId();

const percentProblem = computed(() => canaryProblem(percent.value));
const textProblem = computed(() => reasonProblem(reason.value));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    percent.value = 10;
    reason.value = '';
    touched.value = false;
    await nextTick();
    field.value?.focus();
  },
);

function submit() {
  touched.value = true;
  if (percentProblem.value || textProblem.value || props.busy) return;
  emit('confirm', { percent: percent.value, reason: reason.value.trim() });
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.busy) emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="rc-dialog__backdrop" @click.self="!busy && emit('cancel')" @keydown="onKeydown">
      <form class="rc-dialog__panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" novalidate @submit.prevent="submit">
        <h2 :id="titleId">Mulai uji coba</h2>
        <p>Sebagian kecil pelajar akan menerima versi ini. Pelajar yang sama selalu mendapat versi yang sama.</p>
        <label class="rc-label">
          Porsi pelajar (persen)
          <input
            ref="field"
            v-model.number="percent"
            type="number"
            :min="CANARY_MIN_PERCENT"
            :max="CANARY_MAX_PERCENT"
            step="1"
            class="rc-field"
            :aria-invalid="touched && percentProblem ? 'true' : undefined"
          />
        </label>
        <p v-if="touched && percentProblem" class="rc-error-text" role="alert">{{ percentProblem }}</p>
        <label class="rc-label">
          Alasan
          <textarea v-model="reason" rows="3" :maxlength="REASON_MAX" class="rc-field" :aria-invalid="touched && textProblem ? 'true' : undefined" />
        </label>
        <p v-if="touched && textProblem" class="rc-error-text" role="alert">{{ textProblem }}</p>
        <p v-if="error" class="rc-alert rc-alert--error" role="alert">{{ error }}</p>
        <div class="rc-dialog__actions">
          <PlayButton variant="outline" :disabled="busy" @click="emit('cancel')">Batal</PlayButton>
          <PlayButton type="submit" :loading="busy">Mulai uji coba</PlayButton>
        </div>
      </form>
    </div>
  </Teleport>
</template>
