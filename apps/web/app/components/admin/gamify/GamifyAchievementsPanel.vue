<script setup lang="ts">
import AdminReasonDialog from '~/components/admin/AdminReasonDialog.vue';
import AdminState from '~/components/admin/AdminState.vue';
import GameIcon from '~/components/play/GameIcon.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { useGamifyAchievements } from '~/composables/useGamifyAdmin';
import { useQueueActions } from '~/composables/useQueueActions';
import type { GamifyAchievementView } from '~/interfaces/admin';
import { achievementPatch, achievementProblems, parseNumber, targetLabel, type AchievementDraft } from '~/lib/gamify-admin';
import { adminService } from '~/services/admin';
import type { ThemeIconName } from '~/theme/icons';

const { view, state, error, refresh } = useGamifyAchievements();

const actions = useQueueActions(async () => {
  await refresh();
});

const metrics = computed(() => view.value?.metrics ?? []);
const icons = computed(() => view.value?.icons ?? []);
const rows = computed(() => view.value?.achievements ?? []);

const emptyDraft = (): AchievementDraft => ({
  code: '',
  title: '',
  description: '',
  iconName: '',
  metric: '',
  target: '',
  sortOrder: String((rows.value.reduce((top, row) => Math.max(top, row.sortOrder), 0) || 0) + 10),
});

const mode = ref<'closed' | 'create' | 'edit'>('closed');
const editingCode = ref<string | null>(null);
const draft = reactive<AchievementDraft>(emptyDraft());
const touched = ref(false);
const dialog = ref<'save' | 'toggle' | null>(null);
const toggleTarget = ref<GamifyAchievementView | null>(null);

const editing = computed(() => mode.value === 'edit');
const current = computed(() => rows.value.find((row) => row.code === editingCode.value) ?? null);
const problems = computed(() => achievementProblems(draft, metrics.value, icons.value, { editing: editing.value }));
const patch = computed(() => (current.value ? achievementPatch(current.value, draft) : {}));
const targetSpec = computed(() => metrics.value.find((item) => item.metric === draft.metric) ?? null);
const nothingChanged = computed(() => editing.value && Object.keys(patch.value).length === 0);

function assign(next: AchievementDraft) {
  Object.assign(draft, next);
  touched.value = false;
  actions.clear();
}

function startCreate() {
  mode.value = 'create';
  editingCode.value = null;
  assign({ ...emptyDraft(), iconName: icons.value[0] ?? '', metric: metrics.value[0]?.metric ?? '' });
}

function startEdit(row: GamifyAchievementView) {
  mode.value = 'edit';
  editingCode.value = row.code;
  assign({
    code: row.code ?? '',
    title: row.title,
    description: row.description ?? '',
    iconName: row.iconName ?? '',
    metric: row.rule?.metric ?? '',
    target: row.rule ? String(row.rule.value) : '',
    sortOrder: String(row.sortOrder),
  });
}

function close() {
  mode.value = 'closed';
  editingCode.value = null;
  dialog.value = null;
}

function askSave() {
  touched.value = true;
  if (Object.keys(problems.value).length > 0 || nothingChanged.value) return;
  actions.clear();
  dialog.value = 'save';
}

function askToggle(row: GamifyAchievementView) {
  actions.clear();
  toggleTarget.value = row;
  dialog.value = 'toggle';
}

async function save(reason: string) {
  const code = editingCode.value;
  const ok = editing.value && code
    ? await actions.run('update', code, () => adminService.gamify.updateAchievement(code, { ...patch.value, reason }), 'Pencapaian diperbarui.')
    : await actions.run(
        'create',
        draft.code,
        () =>
          adminService.gamify.createAchievement({
            code: draft.code,
            title: draft.title.trim(),
            description: draft.description.trim(),
            iconName: draft.iconName,
            rule: { metric: draft.metric, value: parseNumber(draft.target) as number },
            sortOrder: parseNumber(draft.sortOrder) as number,
            reason,
          }),
        'Pencapaian dibuat.',
      );
  if (ok) close();
}

async function toggle(reason: string) {
  const row = toggleTarget.value;
  if (!row?.code) return;
  const code = row.code;
  const ok = await actions.run(
    row.active ? 'deactivate' : 'activate',
    code,
    () => (row.active ? adminService.gamify.deactivateAchievement(code, reason) : adminService.gamify.activateAchievement(code, reason)),
    row.active ? `${row.title} dinonaktifkan.` : `${row.title} diaktifkan.`,
  );
  if (ok) dialog.value = null;
}

const idFor = (name: string) => `gamify-ach-${name}`;
</script>

<template>
  <div class="rc-stack">
    <p v-if="actions.notice.value" class="rc-alert rc-alert--success" role="status">{{ actions.notice.value }}</p>
    <p class="rc-hint">
      Pencapaian terbuka otomatis saat pelajar mencapai syaratnya. Syarat dan kode tidak bisa diubah setelah dibuat, supaya pencapaian yang sudah terbuka tetap berarti sama. Pencapaian yang dinonaktifkan hilang dari daftar pelajar, tetapi catatan yang sudah terbuka tidak dihapus.
    </p>

    <AdminState :status="state" :error="error" error-title="Gagal memuat pencapaian" @retry="refresh()">
      <div class="rc-actions">
        <PlayButton :disabled="mode === 'create'" @click="startCreate">Pencapaian baru</PlayButton>
      </div>

      <PlayCard v-if="mode !== 'closed'" as="section" class="rc-detail rc-detail--wide" aria-labelledby="ach-form-h">
        <h2 id="ach-form-h">{{ editing ? `Ubah ${current?.title ?? 'pencapaian'}` : 'Pencapaian baru' }}</h2>
        <form class="rc-studio-form" novalidate @submit.prevent="askSave">
          <label v-if="!editing" class="rc-label" :for="idFor('code')">
            Kode
            <input :id="idFor('code')" v-model="draft.code" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.code }" autocomplete="off" maxlength="40" />
            <span class="rc-hint">Huruf kecil, angka, dan tanda hubung. Contoh: streak-14.</span>
            <span v-if="touched && problems.code" class="rc-error-text" role="alert">{{ problems.code }}</span>
          </label>

          <label class="rc-label" :for="idFor('title')">
            Judul
            <input :id="idFor('title')" v-model="draft.title" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.title }" maxlength="60" />
            <span v-if="touched && problems.title" class="rc-error-text" role="alert">{{ problems.title }}</span>
          </label>

          <label class="rc-label" :for="idFor('description')">
            Deskripsi
            <textarea :id="idFor('description')" v-model="draft.description" rows="3" maxlength="240" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.description }" />
            <span v-if="touched && problems.description" class="rc-error-text" role="alert">{{ problems.description }}</span>
          </label>

          <div class="rc-studio-form__row">
            <label class="rc-label" :for="idFor('icon')">
              Ikon
              <span class="rc-gamify-pick">
                <GameIcon v-if="draft.iconName" :name="draft.iconName as ThemeIconName" :size="32" decorative />
                <select :id="idFor('icon')" v-model="draft.iconName" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.iconName }">
                  <option v-for="icon in icons" :key="icon" :value="icon">{{ icon }}</option>
                </select>
              </span>
              <span v-if="touched && problems.iconName" class="rc-error-text" role="alert">{{ problems.iconName }}</span>
            </label>

            <label class="rc-label" :for="idFor('order')">
              Urutan tampil
              <input :id="idFor('order')" v-model="draft.sortOrder" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.sortOrder }" inputmode="numeric" autocomplete="off" />
              <span class="rc-hint">Angka kecil tampil lebih dulu.</span>
              <span v-if="touched && problems.sortOrder" class="rc-error-text" role="alert">{{ problems.sortOrder }}</span>
            </label>
          </div>

          <div v-if="!editing" class="rc-studio-form__row">
            <label class="rc-label" :for="idFor('metric')">
              Terbuka saat pelajar mencapai
              <select :id="idFor('metric')" v-model="draft.metric" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.metric }">
                <option v-for="item in metrics" :key="item.metric" :value="item.metric">{{ item.label }}</option>
              </select>
              <span v-if="touched && problems.metric" class="rc-error-text" role="alert">{{ problems.metric }}</span>
            </label>

            <label class="rc-label" :for="idFor('target')">
              Jumlah{{ targetSpec ? ` (${targetSpec.unit})` : '' }}
              <input :id="idFor('target')" v-model="draft.target" class="rc-field" :class="{ 'rc-field--invalid': touched && problems.target }" inputmode="numeric" autocomplete="off" />
              <span v-if="targetSpec" class="rc-hint">Paling banyak {{ targetSpec.max }}.</span>
              <span v-if="touched && problems.target" class="rc-error-text" role="alert">{{ problems.target }}</span>
            </label>
          </div>
          <p v-else class="rc-hint">Syarat: {{ targetLabel(current?.rule ?? null, metrics) }}. Tidak bisa diubah.</p>

          <p v-if="touched && nothingChanged" class="rc-hint">Belum ada perubahan.</p>

          <div class="rc-actions">
            <PlayButton type="submit">{{ editing ? 'Simpan perubahan' : 'Buat pencapaian' }}</PlayButton>
            <PlayButton variant="outline" @click="close">Batal</PlayButton>
          </div>
        </form>
      </PlayCard>

      <div class="rc-table-wrap">
        <table class="rc-table">
          <caption>Pencapaian</caption>
          <thead>
            <tr>
              <th scope="col">Pencapaian</th>
              <th scope="col">Syarat</th>
              <th scope="col">Status</th>
              <th scope="col" class="rc-table__num">Terbuka</th>
              <th scope="col"><span class="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="rows.length === 0">
              <td colspan="5">Belum ada pencapaian.</td>
            </tr>
            <tr v-for="row in rows" :key="row.code ?? row.title" :class="{ 'is-selected': row.code === editingCode }">
              <td>
                <span class="rc-gamify-pick">
                  <GameIcon v-if="row.iconName" :name="row.iconName as ThemeIconName" :size="28" decorative />
                  <span>
                    {{ row.title }}
                    <span class="rc-table__sub">{{ row.code ?? 'tanpa kode' }}</span>
                  </span>
                </span>
              </td>
              <td>{{ targetLabel(row.rule, metrics) }}</td>
              <td><StatusBadge :tone="row.active ? 'success' : 'neutral'" :label="row.active ? 'Aktif' : 'Nonaktif'" /></td>
              <td class="rc-table__num">{{ row.unlockedCount }}</td>
              <td class="rc-table__num">
                <div class="rc-actions">
                  <PlayButton v-if="row.code" size="sm" variant="outline" @click="startEdit(row)">Ubah</PlayButton>
                  <PlayButton v-if="row.code" size="sm" :variant="row.active ? 'danger' : 'outline'" @click="askToggle(row)">
                    {{ row.active ? 'Nonaktifkan' : 'Aktifkan' }}
                  </PlayButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AdminState>

    <AdminReasonDialog
      :open="dialog === 'save'"
      :title="editing ? 'Simpan perubahan pencapaian' : 'Buat pencapaian'"
      :message="
        editing
          ? 'Alasan tercatat di audit.'
          : 'Pelajar yang sudah memenuhi syaratnya langsung terlihat terbuka, dan tercatat saat mereka mendapat hadiah berikutnya. Alasan tercatat di audit.'
      "
      :confirm-label="editing ? 'Simpan' : 'Buat'"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="save"
      @cancel="dialog = null"
    />
    <AdminReasonDialog
      :open="dialog === 'toggle'"
      :title="toggleTarget?.active ? `Nonaktifkan ${toggleTarget?.title}` : `Aktifkan ${toggleTarget?.title ?? ''}`"
      :message="
        toggleTarget?.active
          ? 'Pencapaian ini hilang dari daftar pelajar dan tidak terbuka lagi. Catatan pelajar yang sudah membukanya tidak dihapus.'
          : 'Pencapaian ini muncul lagi di daftar pelajar. Pelajar yang sudah memenuhi syaratnya terlihat terbuka, dan tercatat saat mereka mendapat hadiah berikutnya.'
      "
      :confirm-label="toggleTarget?.active ? 'Nonaktifkan' : 'Aktifkan'"
      :destructive="Boolean(toggleTarget?.active)"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="toggle"
      @cancel="dialog = null"
    />
  </div>
</template>
