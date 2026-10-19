<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useUserTheme } from '~/composables/useUserTheme';
import { describeApiError } from '~/lib/api-error';
import { MAX_MOODS, THEME_MOODS, draftProblem, intensityLabel, previewStyle, sameChoice, toggleMood } from '~/lib/user-theme';
import { themeService } from '~/services/theme';
import type { ColorScheme, NormalizedTheme } from '~/theme/types';

const PREVIEW_DELAY_MS = 250;

const { state, apply } = useUserTheme();

const saved = computed(() => (state.value?.custom ? { mood: state.value.mood, intensity: state.value.intensity ?? 50 } : null));
const draft = reactive<{ mood: string[]; intensity: number }>({ mood: [...(saved.value?.mood ?? [])], intensity: saved.value?.intensity ?? 50 });
const scheme = ref<ColorScheme>('light');
const previewTheme = ref<NormalizedTheme | null>(state.value?.theme ?? null);
const busy = ref<'save' | 'reset' | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const problem = computed(() => draftProblem(draft));
const unchanged = computed(() => sameChoice(draft, saved.value));
const full = computed(() => draft.mood.length >= MAX_MOODS);
const style = computed(() => previewStyle(previewTheme.value, scheme.value));

let timer: ReturnType<typeof setTimeout> | null = null;
let ticket = 0;

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function refreshPreview() {
  stopTimer();
  ticket += 1;
  const mine = ticket;
  if (problem.value) {
    previewTheme.value = null;
    return;
  }
  timer = setTimeout(async () => {
    try {
      const view = await themeService.preview({ mood: draft.mood, intensity: draft.intensity });
      if (mine === ticket) previewTheme.value = view.theme;
    } catch (err) {
      if (mine === ticket) error.value = describeApiError(err, 'Pratinjau belum bisa dimuat.');
    }
  }, PREVIEW_DELAY_MS);
}

watch(() => [draft.mood.join('|'), draft.intensity], refreshPreview);
onBeforeUnmount(stopTimer);

function pick(mood: string) {
  notice.value = null;
  draft.mood = toggleMood(draft.mood, mood);
}

async function save() {
  if (problem.value || busy.value) return;
  busy.value = 'save';
  error.value = null;
  notice.value = null;
  try {
    const view = await themeService.save({ mood: draft.mood, intensity: draft.intensity });
    apply(view);
    previewTheme.value = view.theme;
    notice.value = 'Tema disimpan. Seluruh aplikasi memakai warna ini.';
  } catch (err) {
    error.value = describeApiError(err, 'Tema belum bisa disimpan. Coba lagi.');
  } finally {
    busy.value = null;
  }
}

async function reset() {
  if (busy.value) return;
  busy.value = 'reset';
  error.value = null;
  notice.value = null;
  try {
    apply(await themeService.reset());
    stopTimer();
    ticket += 1;
    draft.mood = [];
    draft.intensity = 50;
    previewTheme.value = null;
    notice.value = 'Kembali ke tema bawaan.';
  } catch (err) {
    error.value = describeApiError(err, 'Tema belum bisa dikembalikan. Coba lagi.');
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <PlayCard as="section" aria-labelledby="theme-title">
    <h2 id="theme-title" class="rc-h2">Tema gamifikasi milikmu</h2>
    <div class="rc-theme-form">
      <p class="rc-hint">Pilih suasana yang kamu suka. Warna streak, XP, bintang, dan level di seluruh aplikasi mengikuti pilihanmu, hanya untuk akunmu. Tanpa pilihan, kamu memakai tema bawaan.</p>

      <fieldset class="rc-fieldset">
        <legend>Suasana (pilih sampai {{ MAX_MOODS }}: {{ draft.mood.length }} dipilih)</legend>
        <div class="rc-row">
          <button
            v-for="mood in THEME_MOODS"
            :key="mood.id"
            type="button"
            class="rc-chip rc-filter__chip"
            :class="draft.mood.includes(mood.id) && 'rc-chip--info'"
            :aria-pressed="draft.mood.includes(mood.id)"
            :disabled="full && !draft.mood.includes(mood.id)"
            @click="pick(mood.id)"
          >
            {{ mood.label }}
          </button>
        </div>
      </fieldset>

      <label class="rc-label rc-theme-intensity" for="theme-intensity">
        Intensitas: {{ intensityLabel(draft.intensity) }} ({{ draft.intensity }})
        <input id="theme-intensity" v-model.number="draft.intensity" type="range" min="0" max="100" step="5" class="rc-theme-intensity__range" />
        <span class="rc-hint">Makin pekat, warna makin tajam dan gerak latar makin terasa. Gerak tetap mati bila perangkatmu meminta gerak dikurangi.</span>
      </label>

      <div class="rc-row" role="group" aria-label="Mode pratinjau">
        <button type="button" class="rc-chip rc-filter__chip" :class="scheme === 'light' && 'rc-chip--info'" :aria-pressed="scheme === 'light'" @click="scheme = 'light'">Terang</button>
        <button type="button" class="rc-chip rc-filter__chip" :class="scheme === 'dark' && 'rc-chip--info'" :aria-pressed="scheme === 'dark'" @click="scheme = 'dark'">Gelap</button>
      </div>

      <div class="rc-theme-preview" :style="style || undefined" role="group" aria-label="Pratinjau tema">
        <p class="rc-theme-preview__title">Pratinjau</p>
        <div class="rc-row">
          <StatPill icon="streak" :value="7" label="Streak" tone="flame" show-label />
          <StatPill icon="xp" :value="320" label="XP" tone="gold" show-label />
          <StatPill icon="star" :value="12" label="Bintang" tone="gold" show-label />
        </div>
        <div class="rc-theme-preview__body">
          <LevelRing :level="4" :progress="0.6" :size="72" />
          <div class="rc-theme-preview__col">
            <PlayProgress :value="60" label="Menuju level 5" />
            <div class="rc-row">
              <PlayButton size="sm">Lanjutkan belajar</PlayButton>
              <PlayButton size="sm" variant="outline">Lihat topik</PlayButton>
            </div>
          </div>
        </div>
      </div>

      <p v-if="problem && draft.mood.length === 0" class="rc-hint">{{ problem }}</p>
      <p v-else-if="problem" class="rc-error-text" role="alert">{{ problem }}</p>
      <p v-if="error" class="rc-alert rc-alert--error" role="alert">{{ error }}</p>
      <p v-if="notice" class="rc-alert rc-alert--success" role="status">{{ notice }}</p>

      <div class="rc-row">
        <PlayButton :loading="busy === 'save'" :disabled="Boolean(problem) || unchanged" @click="save">Simpan tema</PlayButton>
        <PlayButton v-if="saved" variant="outline" :loading="busy === 'reset'" @click="reset">Pakai tema bawaan</PlayButton>
      </div>
    </div>
  </PlayCard>
</template>
