<script setup lang="ts">
import AdminReasonDialog from '~/components/admin/AdminReasonDialog.vue';
import AdminState from '~/components/admin/AdminState.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { useGamifyRules } from '~/composables/useGamifyAdmin';
import { useQueueActions } from '~/composables/useQueueActions';
import type { GamifyRuleView } from '~/interfaces/admin';
import { formatDateTime } from '~/lib/format';
import { changedFields, formatFieldValue, rawFromValues, readValues, ruleSentence, ruleStatus } from '~/lib/gamify-admin';
import { adminService } from '~/services/admin';

const { rules, state, error, refresh } = useGamifyRules();

const actions = useQueueActions(async () => {
  await refresh();
});

const selectedCode = ref<string | null>(null);
const raw = ref<Record<string, string>>({});
const base = ref(0);
const touched = ref(false);
const dialog = ref<'publish' | 'activate' | 'deactivate' | null>(null);
const targetVersion = ref<number | null>(null);

const selected = computed<GamifyRuleView | null>(() => rules.value.find((rule) => rule.code === selectedCode.value) ?? null);
const reading = computed(() => (selected.value ? readValues(selected.value.fields, raw.value) : null));
const changed = computed(() => {
  const rule = selected.value;
  const read = reading.value;
  if (!rule || !read || !read.ok) return [];
  return rule.inForce ? changedFields(rule.fields, rule.inForce.values, read.values) : rule.fields.map((field) => field.key);
});
const changeLines = computed(() => {
  const rule = selected.value;
  const read = reading.value;
  if (!rule?.inForce || !read?.ok) return [];
  const current = rule.inForce.values;
  return rule.fields
    .filter((field) => changed.value.includes(field.key))
    .map((field) => `${field.label}: ${formatFieldValue(field, current[field.key] as number)} menjadi ${formatFieldValue(field, read.values[field.key] as number)}`);
});
const stale = computed(() => selected.value !== null && selected.value.latestVersion !== base.value);
const canPublish = computed(() => Boolean(reading.value?.ok) && changed.value.length > 0 && !stale.value);

function loadDraft(rule: GamifyRuleView) {
  const source = rule.inForce?.values ?? rule.versions[0]?.values ?? {};
  raw.value = rawFromValues(rule.fields, source);
  base.value = rule.latestVersion;
  touched.value = false;
}

function select(rule: GamifyRuleView) {
  selectedCode.value = rule.code;
  actions.clear();
  loadDraft(rule);
}

function reloadDraft() {
  if (selected.value) loadDraft(selected.value);
  actions.clear();
}

function ask(kind: 'publish' | 'activate' | 'deactivate', version: number | null = null) {
  touched.value = true;
  if (kind === 'publish' && !canPublish.value) return;
  actions.clear();
  targetVersion.value = version;
  dialog.value = kind;
}

async function settle(ok: boolean) {
  if (ok) {
    dialog.value = null;
    if (selected.value) loadDraft(selected.value);
  } else {
    await refresh();
  }
}

async function publish(reason: string) {
  const rule = selected.value;
  const read = reading.value;
  if (!rule || !read?.ok) return;
  const ok = await actions.run(
    'publish',
    rule.code,
    () => adminService.gamify.publishRule(rule.code, { baseVersion: base.value, values: read.values, reason }),
    `Versi baru ${rule.label} diterbitkan.`,
  );
  await settle(ok);
}

async function activate(reason: string) {
  const rule = selected.value;
  const version = targetVersion.value;
  if (!rule || version === null) return;
  const ok = await actions.run(`activate-${version}`, rule.code, () => adminService.gamify.activateRule(rule.code, version, reason), `Versi ${version} berlaku sekarang.`);
  await settle(ok);
}

async function deactivate(reason: string) {
  const rule = selected.value;
  if (!rule) return;
  const ok = await actions.run('deactivate', rule.code, () => adminService.gamify.deactivateRule(rule.code, reason), `${rule.label} dimatikan.`);
  await settle(ok);
}

const versionBadge = (version: GamifyRuleView['versions'][number]) => {
  if (version.inForce) return { label: version.builtin ? 'Bawaan · berlaku' : 'Berlaku', tone: 'success' as const };
  return { label: version.builtin ? 'Bawaan' : 'Tidak berlaku', tone: 'neutral' as const };
};

const fieldId = (key: string) => `gamify-rule-${selectedCode.value}-${key}`;
</script>

<template>
  <div class="rc-stack">
    <p v-if="actions.notice.value" class="rc-alert rc-alert--success" role="status">{{ actions.notice.value }}</p>
    <p class="rc-hint">
      Setiap perubahan menerbitkan versi baru. Versi lama tetap tersimpan dan bisa diaktifkan kembali. Hadiah yang sudah dibayar tidak berubah: hanya kejadian setelah versi baru berlaku yang memakai nilai baru.
    </p>

    <AdminState :status="state" :error="error" error-title="Gagal memuat aturan hadiah" @retry="refresh()">
      <div class="rc-table-wrap">
        <table class="rc-table">
          <caption>Aturan hadiah</caption>
          <thead>
            <tr>
              <th scope="col">Aturan</th>
              <th scope="col">Status</th>
              <th scope="col">Nilai yang berlaku</th>
              <th scope="col"><span class="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.code" :class="{ 'is-selected': rule.code === selectedCode }">
              <td class="rc-table__nowrap">
                <button type="button" class="rc-table__link" :aria-pressed="rule.code === selectedCode" @click="select(rule)">{{ rule.label }}</button>
                <span class="rc-table__sub">{{ rule.code }}</span>
              </td>
              <td class="rc-table__nowrap"><StatusBadge :tone="ruleStatus(rule).tone" :label="ruleStatus(rule).label" /></td>
              <td>{{ rule.inForce ? ruleSentence(rule.fields, rule.inForce.values) : 'Tidak ada hadiah dari aturan ini.' }}</td>
              <td class="rc-table__num"><PlayButton size="sm" variant="outline" @click="select(rule)">Atur</PlayButton></td>
            </tr>
          </tbody>
        </table>
      </div>

      <PlayCard v-if="selected" as="section" class="rc-detail rc-detail--wide" :aria-label="`Atur ${selected.label}`">
        <h2>{{ selected.label }}</h2>
        <p class="rc-hint">{{ selected.summary }}</p>

        <p v-if="stale" class="rc-alert rc-alert--info" role="status">
          Aturan ini sudah berubah ke versi {{ selected.latestVersion }} sejak formulir dibuka. Muat ulang nilai terbaru sebelum menerbitkan.
          <PlayButton size="sm" variant="outline" @click="reloadDraft">Muat ulang formulir</PlayButton>
        </p>

        <form class="rc-studio-form" novalidate @submit.prevent="ask('publish')">
          <div class="rc-studio-form__row">
            <label v-for="field in selected.fields" :key="field.key" class="rc-label" :for="fieldId(field.key)">
              {{ field.label }} ({{ field.unit }})
              <input
                :id="fieldId(field.key)"
                v-model="raw[field.key]"
                class="rc-field"
                :class="{ 'rc-field--invalid': touched && reading?.problems[field.key] }"
                inputmode="decimal"
                autocomplete="off"
                :aria-invalid="touched && reading?.problems[field.key] ? 'true' : undefined"
                :aria-describedby="`${fieldId(field.key)}-hint`"
              />
              <span :id="`${fieldId(field.key)}-hint`" class="rc-hint">{{ field.hint }}</span>
              <span v-if="touched && reading?.problems[field.key]" class="rc-error-text" role="alert">{{ reading.problems[field.key] }}</span>
            </label>
          </div>

          <p v-if="reading?.ok && changed.length === 0" class="rc-hint">Belum ada perubahan dari versi yang berlaku.</p>
          <ul v-else-if="changeLines.length > 0" class="rc-reasons" aria-label="Perubahan dari versi yang berlaku">
            <li v-for="line in changeLines" :key="line">{{ line }}</li>
          </ul>

          <div class="rc-actions">
            <PlayButton type="submit" :disabled="stale">Terbitkan versi baru</PlayButton>
            <PlayButton v-if="selected.inForce" variant="danger" @click="ask('deactivate')">Matikan aturan</PlayButton>
          </div>
        </form>

        <div class="rc-table-wrap">
          <table class="rc-table">
            <caption>Riwayat versi {{ selected.label }}</caption>
            <thead>
              <tr>
                <th scope="col">Versi</th>
                <th scope="col">Status</th>
                <th scope="col">Nilai</th>
                <th scope="col">Dibuat</th>
                <th scope="col"><span class="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="version in selected.versions" :key="version.version">
                <td class="rc-table__nowrap">Versi {{ version.version }}</td>
                <td class="rc-table__nowrap"><StatusBadge :tone="versionBadge(version).tone" :label="versionBadge(version).label" /></td>
                <td>{{ ruleSentence(selected.fields, version.values) }}</td>
                <td class="rc-table__nowrap">{{ version.createdAt ? formatDateTime(version.createdAt) : 'Bawaan kode' }}</td>
                <td class="rc-table__num">
                  <PlayButton v-if="!version.inForce" size="sm" variant="outline" @click="ask('activate', version.version)">Aktifkan</PlayButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PlayCard>
    </AdminState>

    <AdminReasonDialog
      :open="dialog === 'publish'"
      :title="`Terbitkan versi baru ${selected?.label ?? ''}`"
      message="Versi baru langsung berlaku untuk kejadian berikutnya. Alasan tercatat di audit."
      confirm-label="Terbitkan"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="publish"
      @cancel="dialog = null"
    />
    <AdminReasonDialog
      :open="dialog === 'activate'"
      :title="`Aktifkan versi ${targetVersion ?? ''}`"
      message="Versi ini menggantikan versi yang berlaku sekarang. Alasan tercatat di audit."
      confirm-label="Aktifkan"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="activate"
      @cancel="dialog = null"
    />
    <AdminReasonDialog
      :open="dialog === 'deactivate'"
      :title="`Matikan ${selected?.label ?? 'aturan'}`"
      message="Selama mati, kejadian ini tidak memberi hadiah apa pun. Hadiah yang sudah dibayar tetap. Aktifkan sebuah versi untuk menyalakannya lagi."
      confirm-label="Matikan"
      destructive
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="deactivate"
      @cancel="dialog = null"
    />
  </div>
</template>
