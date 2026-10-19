<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue'
import { HINT_STEPS, nextHintLabel } from '~/lib/sandbox'

const props = defineProps<{
  hints: string[]
  level: number
  busy: boolean
  canReveal: boolean
  error: string | null
  cooldown: number
}>()

const emit = defineEmits<{ hint: []; reveal: [] }>()

const confirming = ref(false)
const canOpenMore = computed(() => props.level < HINT_STEPS)

function reveal() {
  confirming.value = false
  emit('reveal')
}
</script>

<template>
  <section class="rc-sbx-hints" aria-labelledby="hints-h">
    <h3 id="hints-h" class="rc-sbx-h3">Petunjuk</h3>
    <ol v-if="hints.length" class="rc-sbx-hints__list" aria-live="polite">
      <li v-for="(text, index) in hints" :key="index">
        <span class="rc-sbx-hints__no">Petunjuk {{ index + 1 }}</span>
        {{ text }}
      </li>
    </ol>
    <p v-else class="rc-hint">Petunjuk dibuka bertahap, dari yang paling umum. Mencoba dulu sebelum membuka petunjuk membuat kamu lebih ingat.</p>
    <p v-if="error" class="rc-alert rc-alert--error" role="alert">{{ error }}</p>
    <div class="rc-actions">
      <PlayButton variant="secondary" size="sm" :loading="busy" :disabled="!canOpenMore || cooldown > 0" @click="emit('hint')">{{ nextHintLabel(level, canOpenMore, cooldown) }}</PlayButton>
      <PlayButton v-if="canReveal && !confirming" variant="ghost" size="sm" @click="confirming = true">Lihat jawaban</PlayButton>
    </div>
    <div v-if="confirming" class="rc-alert" role="alertdialog" aria-label="Konfirmasi melihat jawaban">
      <p>Jawaban yang dilihat tidak dihitung sebagai bukti belajar, dan skenario ini tidak menambah penguasaanmu. Tetap lihat jawaban?</p>
      <div class="rc-actions">
        <PlayButton variant="danger" size="sm" @click="reveal">Ya, lihat jawaban</PlayButton>
        <PlayButton variant="ghost" size="sm" @click="confirming = false">Batal</PlayButton>
      </div>
    </div>
  </section>
</template>
