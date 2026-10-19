<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import PlayProgress from '~/components/play/PlayProgress.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import type { BenchmarkCaseView, BenchmarkDecision, BenchmarkRunDetail, BenchmarkRunSummary, BenchmarkSampleView } from '~/interfaces/admin';
import { formatMillis, gateLabel, statusMeta } from '~/lib/admin';
import { describeApiError } from '~/lib/api-error';
import {
  CAVEATS,
  DECISION_MAX,
  canDecide,
  canProposeFrom,
  datasetRoleLabel,
  decisionProblem,
  differenceLabel,
  dimensionRows,
  intervalLabel,
  isActiveRun,
  levelLabel,
  progressPercent,
  runTitle,
  VERDICT_META,
  verdictOf,
  worseCases,
} from '~/lib/benchmark';
import { formatDateTime } from '~/lib/format';
import { adminService } from '~/services/admin';

const props = defineProps<{ run: BenchmarkRunSummary }>();
const emit = defineEmits<{ changed: [] }>();

const detail = ref<BenchmarkRunDetail | null>(null);
const loadError = ref<string | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    detail.value = await adminService.optimization.benchmarks.detail(props.run.id);
  } catch (err) {
    loadError.value = describeApiError(err, 'Hasil benchmark gagal dimuat.');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

watch(
  () => [props.run.id, props.run.status, props.run.progress.done, props.run.decision] as const,
  (next, previous) => {
    if (next[0] !== previous[0]) {
      detail.value = null;
      openCase.value = null;
      caseView.value = null;
    }
    void load();
  },
);

const report = computed(() => detail.value?.report ?? null);
const rows = computed(() => (report.value ? dimensionRows(report.value) : []));
const worse = computed(() => (report.value ? worseCases(report.value) : []));
const criteria = computed(() => detail.value?.criteria ?? []);
const percent = computed(() => progressPercent(props.run.progress));

const caveats = computed(() => {
  const list: string[] = [];
  if (props.run.identicalArms) list.push(CAVEATS.identical);
  if (props.run.datasetRole === 'DEVELOPMENT') list.push(CAVEATS.development);
  if (props.run.judge) list.push(CAVEATS.judge);
  list.push(CAVEATS.authorDraft);
  return list;
});

const openCase = ref<string | null>(null);
const caseView = ref<BenchmarkCaseView | null>(null);
const caseError = ref<string | null>(null);
const caseLoading = ref(false);

async function showCase(caseId: string) {
  if (openCase.value === caseId) {
    openCase.value = null;
    caseView.value = null;
    return;
  }
  openCase.value = caseId;
  caseView.value = null;
  caseError.value = null;
  caseLoading.value = true;
  try {
    caseView.value = await adminService.optimization.benchmarks.caseDetail(props.run.id, caseId);
  } catch (err) {
    caseError.value = describeApiError(err, 'Kasus gagal dimuat.');
  } finally {
    caseLoading.value = false;
  }
}

function sampleFlags(sample: BenchmarkSampleView): string[] {
  const flags: string[] = [];
  if (!sample.dimensions.correctness) {
    const missing = sample.checks.facts?.missing ?? [];
    const violated = sample.checks.facts?.violated ?? [];
    if (missing.length) flags.push(`Fakta kurang: ${missing.join(', ')}`);
    if (violated.length) flags.push(`Fakta terlarang: ${violated.join(', ')}`);
  }
  if (!sample.dimensions.citation) flags.push('Sitasi tidak sesuai harapan');
  if (!sample.dimensions.safety) flags.push('Masalah keamanan');
  if (sample.judge?.verdict.unsafe) flags.push('Juri menandai tidak aman');
  return flags;
}

const decision = reactive<{ value: BenchmarkDecision; rationale: string }>({ value: 'DEFERRED', rationale: '' });
const decisionTouched = ref(false);
const decisionBusy = ref(false);
const decisionError = ref<string | null>(null);
const decisionNotice = ref<string | null>(null);
const problem = computed(() => decisionProblem(decision.rationale));

const DECISION_OPTIONS: ReadonlyArray<{ value: BenchmarkDecision; label: string }> = [
  { value: 'ACCEPTED', label: 'Setujui hasil ini' },
  { value: 'REJECTED', label: 'Tolak hasil ini' },
  { value: 'DEFERRED', label: 'Tunda' },
];

async function decide() {
  decisionTouched.value = true;
  if (problem.value || decisionBusy.value) return;
  decisionBusy.value = true;
  decisionError.value = null;
  decisionNotice.value = null;
  try {
    await adminService.optimization.benchmarks.decide(props.run.id, { decision: decision.value, rationale: decision.rationale.trim() });
    decisionNotice.value = 'Keputusan tercatat. Run ini tidak bisa diubah lagi.';
    emit('changed');
  } catch (err) {
    decisionError.value = describeApiError(err, 'Keputusan gagal dicatat.');
  } finally {
    decisionBusy.value = false;
  }
}

const proposeBusy = ref(false);
const proposeError = ref<string | null>(null);
const proposeNotice = ref<string | null>(null);

async function proposeFromRun() {
  if (proposeBusy.value) return;
  proposeBusy.value = true;
  proposeError.value = null;
  proposeNotice.value = null;
  try {
    const created = await adminService.optimization.benchmarks.proposeFromRun(props.run.id);
    proposeNotice.value = `AI mengusulkan ${created.label} dari ${created.baselineLabel}. Hasilnya draf: ukur dulu pada benchmark penilai sebelum memulai uji coba.`;
    emit('changed');
  } catch (err) {
    proposeError.value = describeApiError(err, 'AI belum bisa membuat usulan dari run ini.');
  } finally {
    proposeBusy.value = false;
  }
}
</script>

<template>
  <PlayCard as="section" class="rc-detail rc-detail--wide" :aria-label="`Detail benchmark ${runTitle(run)}`">
    <h2>{{ runTitle(run) }}</h2>
    <dl>
      <div>
        <dt>Status</dt>
        <dd><StatusBadge :tone="statusMeta('benchmark', run.status).tone" :label="statusMeta('benchmark', run.status).label" /></dd>
      </div>
      <div><dt>Set data</dt><dd>{{ datasetRoleLabel(run.datasetRole) }} <span class="rc-table__sub">sha256 {{ run.datasetDigest.slice(0, 12) }}</span></dd></div>
      <div><dt>Pengulangan</dt><dd>{{ run.repeats }} kali per kasus, juri AI {{ run.judge ? 'aktif' : 'tidak dipakai' }}</dd></div>
      <div><dt>Dimulai</dt><dd>{{ run.startedAt ? formatDateTime(run.startedAt) : '—' }}</dd></div>
      <div><dt>Selesai</dt><dd>{{ run.completedAt ? formatDateTime(run.completedAt) : '—' }}</dd></div>
      <div v-if="detail"><dt>Templat</dt><dd class="rc-table__sub">dasar {{ detail.baselineHash.slice(0, 12) }} · kandidat {{ detail.candidateHash.slice(0, 12) }}</dd></div>
    </dl>

    <PlayProgress v-if="isActiveRun(run)" :value="percent" :label="`Kemajuan benchmark, ${run.progress.done} dari ${run.progress.total} panggilan`" show-value />
    <p v-if="isActiveRun(run)" class="rc-hint" role="status">{{ run.progress.done }} dari {{ run.progress.total }} panggilan model selesai. Halaman ini diperbarui otomatis.</p>
    <p v-if="run.error" class="rc-alert rc-alert--error" role="alert">{{ run.error }}</p>
    <p v-if="loadError" class="rc-alert rc-alert--error" role="alert">{{ loadError }}</p>

    <ul class="rc-reasons" aria-label="Hal yang perlu diingat saat membaca hasil">
      <li v-for="caveat in caveats" :key="caveat">{{ caveat }}</li>
    </ul>

    <section v-if="report" aria-labelledby="bench-dim-h">
      <h3 id="bench-dim-h">Hasil per dimensi</h3>
      <div class="rc-table-wrap">
        <table class="rc-table">
          <caption>Dasar melawan kandidat pada {{ report.comparison.pairedCases }} kasus yang sama</caption>
          <thead>
            <tr>
              <th scope="col">Dimensi</th>
              <th scope="col" class="rc-table__num">Dasar</th>
              <th scope="col" class="rc-table__num">Kandidat</th>
              <th scope="col" class="rc-table__num">Selisih</th>
              <th scope="col">Interval 95%</th>
              <th scope="col" class="rc-table__num">Menang / kalah / sama</th>
              <th scope="col">Penilaian</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ row.label }}</td>
              <td class="rc-table__num">{{ levelLabel(row.difference.baseline, row.kind) }}</td>
              <td class="rc-table__num">{{ levelLabel(row.difference.candidate, row.kind) }}</td>
              <td class="rc-table__num">{{ differenceLabel(row.difference.diff, row.kind) }}</td>
              <td class="rc-table__nowrap">{{ intervalLabel(row.difference, row.kind) }}</td>
              <td class="rc-table__num">{{ row.difference.wins }} / {{ row.difference.losses }} / {{ row.difference.ties }}</td>
              <td><StatusBadge :tone="VERDICT_META[verdictOf(row.difference)].tone" :label="VERDICT_META[verdictOf(row.difference)].label" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="rc-hint">
        Selisih dihitung per kasus pada kasus yang dijawab kedua lengan. Sebuah beda baru dianggap terbukti bila seluruh interval 95% ada di satu sisi nol.
        Latensi p95: dasar {{ formatMillis(report.baseline.latencyMs.p95) }}, kandidat {{ formatMillis(report.candidate.latencyMs.p95) }}.
        Panggilan gagal: dasar {{ report.baseline.failures }}, kandidat {{ report.candidate.failures }}.
      </p>
    </section>

    <section v-if="criteria.length" aria-labelledby="bench-gate-h">
      <h3 id="bench-gate-h">Kriteria gerbang dari benchmark</h3>
      <div class="rc-table-wrap">
        <table class="rc-table">
          <caption>Kriteria ini ikut menentukan gerbang. Yang gagal menahan uji coba; yang datanya kurang tidak.</caption>
          <thead>
            <tr>
              <th scope="col">Kriteria</th>
              <th scope="col">Status</th>
              <th scope="col" class="rc-table__num">Dasar</th>
              <th scope="col" class="rc-table__num">Kandidat</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="criterion in criteria" :key="criterion.id">
              <td>{{ gateLabel(criterion.id) }}<span class="rc-table__sub">{{ criterion.rule }}</span></td>
              <td><StatusBadge :tone="statusMeta('gate', criterion.status).tone" :label="statusMeta('gate', criterion.status).label" /></td>
              <td class="rc-table__num">{{ criterion.baseline === null ? '—' : criterion.baseline.toFixed(3) }}</td>
              <td class="rc-table__num">{{ criterion.candidate === null ? '—' : criterion.candidate.toFixed(3) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="report" aria-labelledby="bench-worse-h">
      <h3 id="bench-worse-h">Kasus yang memburuk</h3>
      <p v-if="worse.length === 0" class="rc-hint">Tidak ada kasus yang turun satu langkah penuh pada dimensi mana pun.</p>
      <p v-else class="rc-hint">
        Daftar ini ikut memuat penurunan yang hanya berasal dari variasi acak model, karena tiap jawaban dihasilkan ulang. Bandingkan dengan run dasar melawan dirinya sendiri
        sebelum menganggap sebuah kasus benar-benar memburuk.
      </p>
      <ul v-if="worse.length" class="rc-bench-list">
        <li v-for="item in worse" :key="item.caseId">
          <button type="button" class="rc-table__link" :aria-expanded="openCase === item.caseId" @click="showCase(item.caseId)">{{ item.caseId }}</button>
          <span class="rc-table__sub">{{ item.dimensions.join(', ') }}</span>
        </li>
      </ul>
      <p v-if="caseError" class="rc-alert rc-alert--error" role="alert">{{ caseError }}</p>
      <p v-if="caseLoading" class="rc-hint" role="status">Memuat kasus…</p>
      <div v-if="caseView" class="rc-bench-case">
        <p><strong>{{ caseView.case.id }}</strong> · {{ caseView.case.category }} · risiko {{ caseView.case.risk === 'high' ? 'tinggi' : 'standar' }}</p>
        <p class="rc-bench-case__ask">“{{ caseView.case.message }}”</p>
        <p class="rc-hint">Yang diharapkan: {{ caseView.case.expect.rubric }}</p>
        <div class="rc-bench-grid">
          <div v-for="arm in [{ key: 'baseline', title: 'Dasar', samples: caseView.baseline }, { key: 'candidate', title: 'Kandidat', samples: caseView.candidate }]" :key="arm.key">
            <h4>{{ arm.title }}</h4>
            <p v-if="arm.samples.length === 0" class="rc-hint">Tidak ada jawaban untuk lengan ini.</p>
            <article v-for="sample in arm.samples" :key="`${arm.key}-${sample.repeat}`" class="rc-bench-reply">
              <p class="rc-table__sub">Pengulangan {{ sample.repeat + 1 }}<template v-if="sample.judge"> · pedagogi {{ sample.judge.verdict.pedagogy }}/5</template></p>
              <p class="rc-bench-reply__text">{{ sample.text }}</p>
              <ul v-if="sampleFlags(sample).length" class="rc-reasons">
                <li v-for="flag in sampleFlags(sample)" :key="flag">{{ flag }}</li>
              </ul>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section v-if="canProposeFrom(run)" aria-labelledby="bench-propose-h">
      <h3 id="bench-propose-h">Usulan dari run ini</h3>
      <p class="rc-hint">AI membaca kelemahan di set pengembangan ini (bukan benchmark penilai) dan menulis satu draf perubahan kecil. Draf itu belum dipakai siapa pun.</p>
      <p v-if="proposeError" class="rc-alert rc-alert--error" role="alert">{{ proposeError }}</p>
      <p v-if="proposeNotice" class="rc-alert rc-alert--success" role="status">{{ proposeNotice }}</p>
      <div class="rc-actions rc-ai-propose">
        <PlayButton :loading="proposeBusy" @click="proposeFromRun">{{ proposeBusy ? 'AI sedang menulis usulan…' : 'Usulkan perbaikan dari run ini' }}</PlayButton>
      </div>
    </section>

    <section v-if="canDecide(run)" aria-labelledby="bench-decide-h">
      <h3 id="bench-decide-h">Keputusan kamu</h3>
      <form class="rc-studio-form" novalidate @submit.prevent="decide">
        <fieldset class="rc-fieldset">
          <legend class="rc-label">Keputusan</legend>
          <label v-for="option in DECISION_OPTIONS" :key="option.value" class="rc-check">
            <input v-model="decision.value" type="radio" name="benchmark-decision" :value="option.value" />
            {{ option.label }}
          </label>
        </fieldset>
        <label class="rc-label">
          Alasan
          <textarea v-model="decision.rationale" rows="3" :maxlength="DECISION_MAX" class="rc-field" placeholder="Apa yang membuatmu memutuskan begitu?" />
        </label>
        <p v-if="decisionTouched && problem" class="rc-error-text" role="alert">{{ problem }}</p>
        <p v-if="decisionError" class="rc-alert rc-alert--error" role="alert">{{ decisionError }}</p>
        <div class="rc-actions">
          <PlayButton type="submit" :loading="decisionBusy">Catat keputusan</PlayButton>
        </div>
      </form>
    </section>
    <p v-else-if="run.status === 'COMPLETED'" class="rc-hint">
      Keputusan: {{ statusMeta('optimizationRun', run.decision).label }}<template v-if="run.decisionRationale"> — {{ run.decisionRationale }}</template>
    </p>
    <p v-if="decisionNotice" class="rc-alert rc-alert--success" role="status">{{ decisionNotice }}</p>
  </PlayCard>
</template>
