<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import PlayProgress from '~/components/play/PlayProgress.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import type { BenchmarkDatasetName, BenchmarkRunSummary, PromptVersionRow } from '~/interfaces/admin';
import { statusMeta } from '~/lib/admin';
import { describeApiError } from '~/lib/api-error';
import { DATASET_OPTIONS, POLL_INTERVAL_MS, datasetRoleLabel, hasActiveRun, isActiveRun, progressPercent, runTitle } from '~/lib/benchmark';
import { formatDateTime } from '~/lib/format';
import { adminService } from '~/services/admin';

const props = defineProps<{ versions: PromptVersionRow[] }>();
const emit = defineEmits<{ changed: [] }>();

const PROMPT_NAME = 'tutor-chat';
const CLOSED = ['ACTIVE', 'REJECTED', 'ROLLED_BACK', 'ARCHIVED'];

const { data, status, error, refresh } = useAsyncData('admin:benchmarks', () => adminService.optimization.benchmarks.list(), { lazy: true });

const runs = computed<BenchmarkRunSummary[]>(() => data.value ?? []);
const state = computed(() => (data.value ? 'success' : status.value));
const candidates = computed(() => props.versions.filter((version) => !CLOSED.includes(version.status)));
const busyRun = computed(() => hasActiveRun(runs.value));

const selectedId = ref<string | null>(null);
const selected = computed(() => runs.value.find((run) => run.id === selectedId.value) ?? null);

const form = reactive<{ datasetName: BenchmarkDatasetName; candidatePromptId: string; repeats: number; judge: boolean }>({
  datasetName: 'tutor-chat-benchmark-v1',
  candidatePromptId: '',
  repeats: 1,
  judge: true,
});
const starting = ref(false);
const startError = ref<string | null>(null);
const startNotice = ref<string | null>(null);

const datasetHint = computed(() => DATASET_OPTIONS.find((option) => option.value === form.datasetName)?.hint ?? '');

async function start() {
  if (starting.value || busyRun.value) return;
  starting.value = true;
  startError.value = null;
  startNotice.value = null;
  try {
    const created = await adminService.optimization.benchmarks.start({
      name: PROMPT_NAME,
      datasetName: form.datasetName,
      ...(form.candidatePromptId ? { candidatePromptId: form.candidatePromptId } : {}),
      repeats: form.repeats,
      judge: form.judge,
    });
    startNotice.value = `Benchmark masuk antrean: ${created.total} panggilan model. Kamu boleh menutup halaman ini; hasilnya tersimpan.`;
    await refresh();
    selectedId.value = created.id;
  } catch (err) {
    startError.value = describeApiError(err, 'Benchmark gagal dimulai.');
  } finally {
    starting.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

watch(
  busyRun,
  (active) => {
    if (!import.meta.client) return;
    stopPolling();
    if (active) timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  },
  { immediate: true },
);

onBeforeUnmount(stopPolling);

function select(id: string) {
  selectedId.value = selectedId.value === id ? null : id;
}

function onChanged() {
  void refresh();
  emit('changed');
}
</script>

<template>
  <section class="rc-stack" aria-labelledby="bench-h">
    <PlayCard as="div">
      <h2 id="bench-h" class="rc-h2">Benchmark offline</h2>
      <p class="rc-hint">
        Menjalankan kasus beku yang sama pada prompt dasar dan kandidat, dengan konteks yang sama persis, lalu membandingkannya kasus demi kasus.
        Satu run memakai kuota model: jumlah kasus × pengulangan × dua lengan, ditambah penilaian juri AI. Hanya satu run berjalan pada satu waktu.
      </p>
      <form class="rc-studio-form" novalidate @submit.prevent="start">
        <label class="rc-label">
          Set data
          <select v-model="form.datasetName" class="rc-field">
            <option v-for="option in DATASET_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <span class="rc-hint">{{ datasetHint }}</span>
        </label>
        <label class="rc-label">
          Kandidat
          <select v-model="form.candidatePromptId" class="rc-field">
            <option value="">Tanpa kandidat: dasar melawan dirinya sendiri (mengukur noise)</option>
            <option v-for="version in candidates" :key="version.id" :value="version.id">{{ version.label }} · {{ statusMeta('prompt', version.status).label }}</option>
          </select>
        </label>
        <label class="rc-label">
          Pengulangan per kasus
          <select v-model.number="form.repeats" class="rc-field rc-field--narrow">
            <option v-for="count in [1, 2, 3, 4, 5]" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
        <label class="rc-check">
          <input v-model="form.judge" type="checkbox" />
          Pakai juri AI (menambah panggilan model)
        </label>
        <p v-if="busyRun" class="rc-hint" role="status">Satu benchmark masih berjalan. Tunggu sampai selesai sebelum memulai yang lain.</p>
        <p v-if="startError" class="rc-alert rc-alert--error" role="alert">{{ startError }}</p>
        <p v-if="startNotice" class="rc-alert rc-alert--success" role="status">{{ startNotice }}</p>
        <div class="rc-actions">
          <PlayButton type="submit" :loading="starting" :disabled="busyRun">Jalankan benchmark</PlayButton>
        </div>
      </form>
    </PlayCard>

    <AdminState :status="state" :error="error" error-title="Gagal memuat benchmark" @retry="refresh()">
      <div class="rc-table-wrap">
        <table class="rc-table">
          <caption>Riwayat benchmark</caption>
          <thead>
            <tr>
              <th scope="col">Perbandingan</th>
              <th scope="col">Status</th>
              <th scope="col">Keputusan</th>
              <th scope="col">Dibuat</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="runs.length === 0">
              <td colspan="4">Belum ada benchmark.</td>
            </tr>
            <tr v-for="run in runs" :key="run.id" :class="{ 'is-selected': run.id === selectedId }">
              <td>
                <button type="button" class="rc-table__link" :aria-pressed="run.id === selectedId" @click="select(run.id)">{{ runTitle(run) }}</button>
                <span class="rc-table__sub">{{ datasetRoleLabel(run.datasetRole) }} · {{ run.repeats }}× · juri {{ run.judge ? 'aktif' : 'mati' }}</span>
              </td>
              <td>
                <StatusBadge :tone="statusMeta('benchmark', run.status).tone" :label="statusMeta('benchmark', run.status).label" />
                <PlayProgress v-if="isActiveRun(run)" :value="progressPercent(run.progress)" :label="`Kemajuan ${runTitle(run)}`" show-value />
              </td>
              <td><StatusBadge :tone="statusMeta('optimizationRun', run.decision).tone" :label="statusMeta('optimizationRun', run.decision).label" /></td>
              <td class="rc-table__nowrap">{{ formatDateTime(run.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AdminState>

    <AdminBenchmarkDetail v-if="selected" :key="selected.id" :run="selected" @changed="onChanged" />
  </section>
</template>
