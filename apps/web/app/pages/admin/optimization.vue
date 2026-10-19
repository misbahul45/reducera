<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { useQueueActions } from '~/composables/useQueueActions';
import type { OptimizationRunRow, PromptEvaluationView, PromptMetricsView, PromptVersionRow } from '~/interfaces/admin';
import { aiProposalProblem, formatMillis, formatRate, gateLabel, promptActions, statusMeta, templateProblem, TEMPLATE_MAX } from '~/lib/admin';
import { describeApiError } from '~/lib/api-error';
import { formatDateTime } from '~/lib/format';
import { diffLabel, diffMarker, lineDiff, summarize, withContext } from '~/lib/prompt-diff';
import { plainText } from '~/lib/topics';
import { adminService } from '~/services/admin';

definePageMeta({
  title: 'Optimasi AI — ReduCera Admin',
  protection: { kind: 'role', role: 'ADMIN' },
  layout: 'admin',
});

useHead({ title: 'Optimasi AI — ReduCera Admin' });

const PROMPT_NAME = 'tutor-chat';

const { data, status, error, refresh } = useAsyncData(
  'admin:optimization',
  async () => {
    const [prompts, runs] = await Promise.all([adminService.optimization.prompts(), adminService.optimization.runs()]);
    return { prompts, runs };
  },
  { lazy: true },
);

const versions = computed<PromptVersionRow[]>(() => data.value?.prompts.versions ?? []);
const builtin = computed(() => data.value?.prompts.builtin.find((row) => row.name === PROMPT_NAME) ?? null);
const runs = computed<OptimizationRunRow[]>(() => data.value?.runs ?? []);
const state = computed(() => (data.value ? 'success' : status.value));

const actions = useQueueActions(async () => {
  await refresh();
});

const selectedId = ref<string | null>(null);
const selected = computed(() => versions.value.find((row) => row.id === selectedId.value) ?? null);
const dialog = ref<'canary' | 'approve' | 'reject' | 'rollback' | null>(null);
const evaluation = ref<PromptEvaluationView | null>(null);

function select(id: string) {
  selectedId.value = id;
  evaluation.value = null;
  actions.clear();
}

function open(kind: 'canary' | 'approve' | 'reject' | 'rollback') {
  actions.clear();
  dialog.value = kind;
}

async function startCanary(payload: { percent: number; reason: string }) {
  const target = selected.value;
  if (!target) return;
  const ok = await actions.run('canary', target.id, () => adminService.optimization.startCanary(target.id, payload), 'Uji coba dimulai.');
  if (ok) dialog.value = null;
}

async function evaluate() {
  const target = selected.value;
  if (!target) return;
  await actions.run(
    'evaluate',
    target.id,
    async () => {
      evaluation.value = await adminService.optimization.evaluate(target.id);
    },
    'Evaluasi selesai.',
  );
}

async function approve(reason: string) {
  const target = selected.value;
  if (!target) return;
  const ok = await actions.run('approve', target.id, () => adminService.optimization.approve(target.id, reason), 'Versi prompt disetujui.');
  if (ok) dialog.value = null;
}

async function reject(reason: string) {
  const target = selected.value;
  if (!target) return;
  const ok = await actions.run('reject', target.id, () => adminService.optimization.reject(target.id, reason), 'Versi prompt ditolak.');
  if (ok) dialog.value = null;
}

async function rollback(reason: string) {
  const target = selected.value;
  if (!target) return;
  const ok = await actions.run('rollback', target.id, () => adminService.optimization.rollback(target.id, reason), 'Versi prompt ditarik.');
  if (ok) dialog.value = null;
}

const aiBusy = ref(false);
const aiError = ref<string | null>(null);
const aiNotice = ref<string | null>(null);

async function proposeWithAi() {
  if (aiBusy.value) return;
  aiBusy.value = true;
  aiError.value = null;
  aiNotice.value = null;
  try {
    const created = await adminService.optimization.proposeImprovement(PROMPT_NAME);
    aiNotice.value = `AI mengusulkan ${created.label} dari ${created.baselineLabel}. Hasilnya masih draf: periksa perubahannya sebelum memulai uji coba.`;
    await refresh();
    select(created.id);
  } catch (err) {
    aiError.value = aiProposalProblem(describeApiError(err, ''), 'AI belum bisa membuat usulan sekarang.');
  } finally {
    aiBusy.value = false;
  }
}

const builtinBody = ref<string | null>(null);

async function ensureBuiltinBody() {
  if (builtinBody.value !== null) return;
  try {
    builtinBody.value = (await adminService.optimization.builtin(PROMPT_NAME)).body;
  } catch {
    builtinBody.value = '';
  }
}

watch(selected, (row) => {
  if (row && !row.parentVersionId) void ensureBuiltinBody();
});

const baseOfSelected = computed(() => {
  const row = selected.value;
  if (!row) return null;
  if (row.parentVersionId) return versions.value.find((version) => version.id === row.parentVersionId)?.body ?? null;
  return builtinBody.value;
});

const selectedDiff = computed(() => {
  const row = selected.value;
  const base = baseOfSelected.value;
  if (!row || base === null || base === '') return null;
  const lines = lineDiff(base, row.body);
  return { lines: withContext(lines), summary: summarize(lines) };
});

const draft = reactive({ body: '', rationale: '' });
const draftTouched = ref(false);
const draftBusy = ref(false);
const draftError = ref<string | null>(null);
const draftNotice = ref<string | null>(null);

const draftProblem = computed(() => templateProblem(draft.body) ?? (draft.rationale.trim().length < 3 ? 'Alasan usulan minimal 3 karakter.' : null));

async function loadBuiltin() {
  draftError.value = null;
  try {
    draft.body = (await adminService.optimization.builtin(PROMPT_NAME)).body;
  } catch (err) {
    draftError.value = describeApiError(err, 'Prompt bawaan gagal dimuat.');
  }
}

async function propose() {
  draftTouched.value = true;
  if (draftProblem.value || draftBusy.value) return;
  draftBusy.value = true;
  draftError.value = null;
  draftNotice.value = null;
  try {
    const created = await adminService.optimization.propose({
      name: PROMPT_NAME,
      body: draft.body,
      rationale: draft.rationale.trim(),
      ...(selected.value ? { parentVersionId: selected.value.id } : {}),
    });
    draftNotice.value = `Versi ${created.label} dibuat sebagai draf.`;
    draft.body = '';
    draft.rationale = '';
    draftTouched.value = false;
    await refresh();
  } catch (err) {
    draftError.value = describeApiError(err, 'Usulan gagal dikirim.');
  } finally {
    draftBusy.value = false;
  }
}

const ACTION_LABEL = {
  canary: 'Mulai uji coba',
  evaluate: 'Evaluasi',
  approve: 'Setujui',
  reject: 'Tolak',
  rollback: 'Tarik versi',
} as const;

function metricsRow(metrics: PromptMetricsView) {
  return [
    metrics.episodes,
    formatRate(metrics.successRate),
    formatRate(metrics.groundedRate),
    formatMillis(metrics.p95LatencyMs),
    metrics.avgTokensIn === null || metrics.avgTokensOut === null ? '—' : Math.round(metrics.avgTokensIn + metrics.avgTokensOut),
  ];
}

function runLabel(run: OptimizationRunRow) {
  return run.candidateJson?.label ?? run.optimizerName;
}

function onAction(action: keyof typeof ACTION_LABEL) {
  if (action === 'evaluate') void evaluate();
  else open(action);
}
</script>

<template>
  <div class="rc-stack">
    <PageHeader
      title="Optimasi AI"
      subtitle="Versi prompt tutor diuji pada sebagian kecil pelajar, diukur dari hasil belajar mereka, dan hanya aktif setelah kamu menyetujuinya."
    />
    <p v-if="actions.notice.value" class="rc-alert rc-alert--success" role="status">{{ actions.notice.value }}</p>

    <AdminState :status="state" :error="error" error-title="Gagal memuat optimasi AI" @retry="refresh()">
      <div class="rc-stack">
        <div class="rc-stack">
          <div class="rc-table-wrap">
            <table class="rc-table">
              <caption>Versi prompt tutor</caption>
              <thead>
                <tr>
                  <th scope="col">Versi</th>
                  <th scope="col">Status</th>
                  <th scope="col" class="rc-table__num">Uji coba</th>
                  <th scope="col" class="rc-table__num">Jawaban</th>
                  <th scope="col" class="rc-table__num">Hasil belajar</th>
                  <th scope="col" class="rc-table__num">Beracuan sumber</th>
                  <th scope="col" class="rc-table__num">Latensi p95</th>
                  <th scope="col" class="rc-table__num">Token</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="builtin">
                  <td class="rc-table__nowrap">
                    {{ builtin.label }}
                    <span class="rc-table__sub">Bawaan, dipakai bila tidak ada versi aktif</span>
                  </td>
                  <td><StatusBadge tone="neutral" label="Bawaan" /></td>
                  <td class="rc-table__num">—</td>
                  <td v-for="(cell, index) in metricsRow(builtin.metrics)" :key="`b-${index}`" class="rc-table__num">{{ cell }}</td>
                </tr>
                <tr v-for="row in versions" :key="row.id" :class="{ 'is-selected': row.id === selectedId }">
                  <td class="rc-table__nowrap">
                    <button type="button" class="rc-table__link" :aria-pressed="row.id === selectedId" @click="select(row.id)">{{ row.label }}</button>
                    <span class="rc-table__sub">{{ formatDateTime(row.createdAt) }}</span>
                  </td>
                  <td><StatusBadge :tone="statusMeta('prompt', row.status).tone" :label="statusMeta('prompt', row.status).label" /></td>
                  <td class="rc-table__num">{{ row.canaryPercent ? `${row.canaryPercent}%` : '—' }}</td>
                  <td v-for="(cell, index) in metricsRow(row.metrics)" :key="`${row.id}-${index}`" class="rc-table__num">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>

      <PlayCard v-if="selected" as="aside" class="rc-detail rc-detail--wide" aria-label="Detail versi prompt">
        <h2>{{ selected.label }}</h2>
        <dl>
          <div><dt>Status</dt><dd>{{ statusMeta('prompt', selected.status).label }}</dd></div>
          <div v-if="selected.origin === 'AI_PROPOSED'"><dt>Asal</dt><dd><StatusBadge tone="info" label="Usulan AI" /> Ditulis AI, masih perlu keputusan manusia.</dd></div>
          <div v-if="selected.rationale"><dt>Alasan usulan</dt><dd>{{ selected.rationale }}</dd></div>
          <div v-if="selected.changes.length">
            <dt>Perubahan</dt>
            <dd>
              <ul class="rc-reasons">
                <li v-for="change in selected.changes" :key="change">{{ change }}</li>
              </ul>
            </dd>
          </div>
          <div><dt>Model</dt><dd>{{ selected.modelName }}</dd></div>
          <div><dt>Dibuat</dt><dd>{{ formatDateTime(selected.createdAt) }}</dd></div>
          <div><dt>Templat</dt><dd><pre>{{ plainText(selected.body, 700) }}</pre></dd></div>
        </dl>

        <section v-if="selectedDiff" class="rc-diff" aria-labelledby="diff-h">
          <h3 id="diff-h" class="rc-h2">Perubahan dari {{ selected.parentVersionId ? 'versi induk' : 'prompt bawaan' }}</h3>
          <p class="rc-hint">{{ selectedDiff.summary.added }} baris ditambah, {{ selectedDiff.summary.removed }} baris dihapus.</p>
          <ol class="rc-diff__lines" aria-label="Perbedaan baris">
            <li v-for="(line, index) in selectedDiff.lines" :key="index" class="rc-diff__line" :class="`rc-diff__line--${line.kind}`">
              <span class="rc-diff__mark" aria-hidden="true">{{ diffMarker(line.kind) }}</span>
              <span class="sr-only">{{ diffLabel(line.kind) }}:</span>
              <span class="rc-diff__text">{{ line.text }}</span>
            </li>
          </ol>
        </section>

        <div v-if="promptActions(selected.status).length" class="rc-actions">
          <PlayButton
            v-for="action in promptActions(selected.status)"
            :key="action"
            :variant="action === 'reject' || action === 'rollback' ? 'danger' : 'primary'"
            size="sm"
            :loading="actions.busy.value && action === 'evaluate'"
            @click="onAction(action)"
          >
            {{ ACTION_LABEL[action] }}
          </PlayButton>
        </div>
        <p v-if="actions.error.value && !dialog" class="rc-alert rc-alert--error" role="alert">{{ actions.error.value }}</p>

        <div v-if="evaluation" class="rc-table-wrap">
          <table class="rc-table">
            <caption>Hasil gerbang terhadap {{ evaluation.baselineLabel }}</caption>
            <thead>
              <tr>
                <th scope="col">Kriteria</th>
                <th scope="col">Status</th>
                <th scope="col" class="rc-table__num">Dasar</th>
                <th scope="col" class="rc-table__num">Kandidat</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="criterion in evaluation.gate.criteria" :key="criterion.id">
                <td>{{ gateLabel(criterion.id) }}<span class="rc-table__sub">{{ criterion.rule }}</span></td>
                <td><StatusBadge :tone="statusMeta('gate', criterion.status).tone" :label="statusMeta('gate', criterion.status).label" /></td>
                <td class="rc-table__num">{{ criterion.baseline ?? '—' }}</td>
                <td class="rc-table__num">{{ criterion.candidate ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PlayCard>

          <PlayCard as="section" aria-labelledby="ai-propose-h">
            <h2 id="ai-propose-h" class="rc-h2">Minta usulan perbaikan dari AI</h2>
            <p class="rc-hint">
              AI membaca angka hasil belajar dan balasan yang tidak membantu (tanpa pertanyaan dan tanpa nama pelajar), lalu mengusulkan satu perubahan kecil.
              Hasilnya hanya draf: kamu yang memulai uji coba dan menyetujuinya. Perlu minimal 30 jawaban terukur dan paling banyak 3 usulan AI menunggu.
            </p>
            <p v-if="aiError" class="rc-alert rc-alert--error" role="alert">{{ aiError }}</p>
            <p v-if="aiNotice" class="rc-alert rc-alert--success" role="status">{{ aiNotice }}</p>
            <div class="rc-actions rc-ai-propose">
              <PlayButton :loading="aiBusy" @click="proposeWithAi">{{ aiBusy ? 'AI sedang menulis usulan…' : 'Usulkan perbaikan dengan AI' }}</PlayButton>
            </div>
          </PlayCard>

          <PlayCard as="section" aria-labelledby="propose-h">
            <h2 id="propose-h" class="rc-h2">Usulkan versi baru</h2>
            <form class="rc-studio-form" novalidate @submit.prevent="propose">
              <label class="rc-label">
                Templat prompt
                <textarea v-model="draft.body" rows="10" :maxlength="TEMPLATE_MAX" class="rc-field rc-field--mono" />
              </label>
              <label class="rc-label">
                Alasan usulan
                <input v-model="draft.rationale" class="rc-field" maxlength="1000" placeholder="Apa yang ingin diperbaiki?" />
              </label>
              <p v-if="draftTouched && draftProblem" class="rc-error-text" role="alert">{{ draftProblem }}</p>
              <p v-if="draftError" class="rc-alert rc-alert--error" role="alert">{{ draftError }}</p>
              <p v-if="draftNotice" class="rc-alert rc-alert--success" role="status">{{ draftNotice }}</p>
              <div class="rc-actions">
                <PlayButton variant="outline" @click="loadBuiltin">Mulai dari prompt bawaan</PlayButton>
                <PlayButton type="submit" :loading="draftBusy">Usulkan</PlayButton>
              </div>
            </form>
          </PlayCard>

          <AdminBenchmarkPanel :versions="versions" @changed="refresh()" />

          <div class="rc-table-wrap">
            <table class="rc-table">
              <caption>Riwayat evaluasi</caption>
              <thead>
                <tr>
                  <th scope="col">Versi</th>
                  <th scope="col">Keputusan</th>
                  <th scope="col">Catatan</th>
                  <th scope="col">Tanggal</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="runs.length === 0">
                  <td colspan="4">Belum ada evaluasi.</td>
                </tr>
                <tr v-for="run in runs" :key="run.id">
                  <td>{{ runLabel(run) }}</td>
                  <td><StatusBadge :tone="statusMeta('optimizationRun', run.decision).tone" :label="statusMeta('optimizationRun', run.decision).label" /></td>
                  <td>{{ plainText(run.rationale ?? '', 90) }}</td>
                  <td>{{ formatDateTime(run.decidedAt ?? run.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </AdminState>

    <AdminCanaryDialog :open="dialog === 'canary'" :busy="actions.busy.value" :error="actions.error.value" @confirm="startCanary" @cancel="dialog = null" />
    <AdminApprovePromptDialog
      :open="dialog === 'approve'"
      :unmeasured="evaluation?.gate.notMeasured ?? ['correctness', 'pedagogy', 'hallucination_rate']"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="approve"
      @cancel="dialog = null"
    />
    <AdminReasonDialog
      :open="dialog === 'reject'"
      title="Tolak versi prompt"
      message="Versi yang ditolak tidak bisa dipakai lagi. Alasan tercatat di audit."
      confirm-label="Tolak"
      destructive
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="reject"
      @cancel="dialog = null"
    />
    <AdminReasonDialog
      :open="dialog === 'rollback'"
      title="Tarik versi aktif"
      message="Versi ini berhenti dipakai sekarang juga. Versi arsip terbaru menggantikannya, atau prompt bawaan bila tidak ada."
      confirm-label="Tarik versi"
      destructive
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="rollback"
      @cancel="dialog = null"
    />
  </div>
</template>
