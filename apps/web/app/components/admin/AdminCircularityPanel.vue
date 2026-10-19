<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue';
import type { CircularityMetric, CircularityMetricId } from '~/interfaces/admin';
import { DEFAULT_WINDOW_DAYS, METRIC_ORDER, WINDOW_OPTIONS, windowQuery } from '~/lib/circularity';
import { formatDateTime } from '~/lib/format';
import { adminService } from '~/services/admin';

const days = ref(DEFAULT_WINDOW_DAYS);

const { data, status, error, refresh } = useAsyncData(
  'admin:circularity',
  () => adminService.metrics.circularity(windowQuery(days.value, new Date())),
  { lazy: true, watch: [days] },
);

const metrics = computed<CircularityMetric[]>(() => {
  const byId = new Map<CircularityMetricId, CircularityMetric>((data.value?.metrics ?? []).map((metric) => [metric.id, metric]));
  return METRIC_ORDER.flatMap((id) => {
    const metric = byId.get(id);
    return metric ? [metric] : [];
  });
});
const state = computed(() => (data.value ? 'success' : status.value));
</script>

<template>
  <section class="rc-stack" aria-labelledby="circularity-h">
    <div class="rc-metric__intro">
      <h2 id="circularity-h" class="rc-h2">Lima metrik komponen</h2>
      <p class="rc-hint">
        Dihitung server dari kejadian nyata, tanpa kunjungan halaman, klik, atau waktu di aplikasi, dan tanpa skor tunggal. Tiap angka menyebut jendela waktu,
        ukuran sampel, dan keadaan "belum cukup bukti". Perubahan sebelum dan sesudah adalah perubahan yang teramati, bukan bukti sebab-akibat.
      </p>
      <div class="rc-metric__controls">
        <label class="rc-label">
          Jendela waktu
          <select v-model.number="days" class="rc-field rc-field--narrow">
            <option v-for="option in WINDOW_OPTIONS" :key="option.days" :value="option.days">{{ option.label }}</option>
          </select>
        </label>
        <PlayButton variant="outline" size="sm" @click="() => refresh()">Muat ulang</PlayButton>
      </div>
      <p v-if="data" class="rc-hint">
        Jendela {{ formatDateTime(data.window.from) }} sampai {{ formatDateTime(data.window.to) }} · definisi {{ data.definitionVersion }} · dibuat
        {{ formatDateTime(data.generatedAt) }}
      </p>
    </div>

    <AdminState :status="state" :error="error" :empty="state === 'success' && metrics.length === 0" empty-title="Belum ada metrik" :skeleton="3" @retry="() => refresh()">
      <div class="rc-metric__grid">
        <AdminCircularityCard v-for="metric in metrics" :key="metric.id" :metric="metric" :demo-domain="data?.demoAccountDomain ?? 'reducera.local'" />
      </div>
    </AdminState>
  </section>
</template>
