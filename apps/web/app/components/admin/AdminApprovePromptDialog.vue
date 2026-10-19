<script setup lang="ts">
import { REASON_MAX, gateLabel, reasonProblem } from '~/lib/admin';

const props = withDefaults(defineProps<{ open: boolean; unmeasured: string[]; busy?: boolean; error?: string | null }>(), {
  busy: false,
  error: null,
});
const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>();

const reason = ref('');
const acknowledged = ref(false);
const touched = ref(false);
const field = ref<HTMLTextAreaElement | null>(null);
const titleId = useId();

const problem = computed(() => reasonProblem(reason.value));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    reason.value = '';
    acknowledged.value = false;
    touched.value = false;
    await nextTick();
    field.value?.focus();
  },
);

function submit() {
  touched.value = true;
  if (problem.value || !acknowledged.value || props.busy) return;
  emit('confirm', reason.value.trim());
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.busy) emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="rc-dialog__backdrop" @click.self="!busy && emit('cancel')" @keydown="onKeydown">
      <form class="rc-dialog__panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" novalidate @submit.prevent="submit">
        <h2 :id="titleId">Setujui versi prompt</h2>
        <p>Versi ini menjadi prompt aktif untuk semua pelajar. Versi aktif sebelumnya diarsipkan dan bisa dipulihkan lewat penarikan.</p>
        <label class="rc-label">
          Alasan
          <textarea ref="field" v-model="reason" rows="3" :maxlength="REASON_MAX" class="rc-field" :aria-invalid="touched && problem ? 'true' : undefined" />
        </label>
        <p v-if="touched && problem" class="rc-error-text" role="alert">{{ problem }}</p>
        <label class="rc-check">
          <input v-model="acknowledged" type="checkbox" />
          <span>
            Saya paham kriteria ini belum terukur oleh sistem:
            {{ unmeasured.map(gateLabel).join(', ') || 'tidak ada' }}.
          </span>
        </label>
        <p v-if="touched && !acknowledged" class="rc-error-text" role="alert">Centang pernyataan ini untuk melanjutkan.</p>
        <p v-if="error" class="rc-alert rc-alert--error" role="alert">{{ error }}</p>
        <div class="rc-dialog__actions">
          <PlayButton variant="outline" :disabled="busy" @click="emit('cancel')">Batal</PlayButton>
          <PlayButton type="submit" :loading="busy">Setujui</PlayButton>
        </div>
      </form>
    </div>
  </Teleport>
</template>
