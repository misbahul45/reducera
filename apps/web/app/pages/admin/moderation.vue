<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import RenderMarkdown from '~/components/ui/RenderMarkdown.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { useQueueActions } from '~/composables/useQueueActions';
import type { AdminContentRow, ContentKind } from '~/interfaces/admin';
import { canDecideTags, contentActions, pendingTagsLabel, statusMeta, type ContentAction, type TagDecision } from '~/lib/admin';
import { statusLabel } from '~/lib/concept-picker';
import { describeApiError } from '~/lib/api-error';
import { formatDateTime, formatMoney } from '~/lib/format';
import type { FilterDefs } from '~/lib/query-filters';
import { adminService } from '~/services/admin';

definePageMeta({
  title: 'Antrean moderasi — ReduCera Admin',
  protection: { kind: 'role', role: 'ADMIN' },
  layout: 'admin',
});

useHead({ title: 'Antrean moderasi — ReduCera Admin' });

const STATUSES = [
  { value: 'PENDING_REVIEW', label: 'Menunggu' },
  { value: 'PUBLISHED', label: 'Terbit' },
  { value: 'SUSPENDED', label: 'Ditangguhkan' },
  { value: 'REJECTED', label: 'Ditolak' },
  { value: 'ARCHIVED', label: 'Diarsipkan' },
] as const;

const defs = {
  page: { kind: 'page' },
  type: { kind: 'enum', values: ['article', 'class'] },
  status: { kind: 'enum', values: STATUSES.map((item) => item.value) },
  tags: { kind: 'enum', values: ['pending'] },
} satisfies FilterDefs;

const { filters, set } = useQueryFilters(defs);
const kind = computed<ContentKind>(() => (filters.value.type === 'class' ? 'class' : 'article'));
const tagsOnly = computed(() => filters.value.tags === 'pending');
const status = computed(() => (tagsOnly.value ? 'PUBLISHED' : String(filters.value.status || 'PENDING_REVIEW')));

const { rows, pagination, state, error, refresh } = useAdminList(
  'admin:moderation',
  (current) =>
    adminService.content.list(current.type === 'class' ? 'class' : 'article', {
      status: current.tags === 'pending' ? 'PUBLISHED' : current.status || 'PENDING_REVIEW',
      ...(current.tags === 'pending' ? { pendingTags: 'true' } : {}),
      page: current.page,
      limit: 20,
    }),
  filters,
);

const actions = useQueueActions(async () => {
  await Promise.all([refresh(), refreshDetail()]);
});

const selectedId = ref<string | null>(null);
const dialog = ref<{ action: ContentAction | TagDecision; id: string } | null>(null);

watch(kind, () => {
  selectedId.value = null;
});

const selected = computed<AdminContentRow | null>(() => rows.value.find((row) => row.id === selectedId.value) ?? null);

const { data: detail, status: detailStatus, error: detailError, refresh: refreshDetail } = useAsyncData(
  'admin:moderation:detail',
  async () => (selectedId.value ? adminService.content.get(kind.value, selectedId.value) : null),
  { lazy: true, watch: [selectedId, kind] },
);

const body = computed(() => {
  const versions = detail.value?.versions ?? [];
  return (versions.find((version) => version.publishedAt === null) ?? versions[0])?.content ?? '';
});

function select(id: string) {
  selectedId.value = id;
  actions.clear();
}

function open(action: ContentAction | TagDecision, id: string) {
  actions.clear();
  dialog.value = { action, id };
}

const SUCCESS: Record<ContentAction | TagDecision, string> = {
  'approve-tags': 'Tag konsep disetujui.',
  'reject-tags': 'Tag konsep ditolak.',
  approve: 'Konten disetujui dan terbit.',
  reject: 'Konten ditolak.',
  suspend: 'Konten ditangguhkan.',
  reinstate: 'Konten dipulihkan.',
  archive: 'Konten diarsipkan.',
};

async function confirm(text: string) {
  const target = dialog.value;
  if (!target) return;
  const call = (): Promise<unknown> => {
    const { action, id } = target;
    if (action === 'approve-tags') return adminService.content.approveTags(kind.value, id, text || undefined);
    if (action === 'reject-tags') return adminService.content.rejectTags(kind.value, id, text);
    if (action === 'approve') return adminService.content.approve(kind.value, id, text || undefined);
    if (action === 'reject') return adminService.content.reject(kind.value, id, text);
    if (action === 'suspend') return adminService.content.suspend(kind.value, id, text);
    if (action === 'reinstate') return adminService.content.reinstate(kind.value, id, text || undefined);
    return adminService.content.archive(kind.value, id, text || undefined);
  };
  const ok = await actions.run(target.action, target.id, () => call(), SUCCESS[target.action]);
  if (ok) dialog.value = null;
}

const DIALOG = {
  'approve-tags': { title: 'Setujui tag konsep', confirm: 'Setujui tag', destructive: false, required: false, label: 'Catatan (opsional)' },
  'reject-tags': { title: 'Tolak tag konsep', confirm: 'Tolak tag', destructive: true, required: true, label: 'Alasan' },
  approve: { title: 'Setujui dan terbitkan', confirm: 'Setujui', destructive: false, required: false, label: 'Catatan (opsional)' },
  reject: { title: 'Tolak konten', confirm: 'Tolak', destructive: true, required: true, label: 'Alasan' },
  suspend: { title: 'Tangguhkan konten', confirm: 'Tangguhkan', destructive: true, required: true, label: 'Alasan' },
  reinstate: { title: 'Pulihkan konten', confirm: 'Pulihkan', destructive: false, required: false, label: 'Catatan (opsional)' },
  archive: { title: 'Arsipkan konten', confirm: 'Arsipkan', destructive: true, required: false, label: 'Catatan (opsional)' },
} as const;

const ACTION_LABEL: Record<ContentAction, string> = {
  approve: 'Setujui',
  reject: 'Tolak',
  suspend: 'Tangguhkan',
  reinstate: 'Pulihkan',
  archive: 'Arsipkan',
};

const dialogMeta = computed(() => (dialog.value ? DIALOG[dialog.value.action] : DIALOG.approve));
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Antrean moderasi" subtitle="Tinjau artikel dan kelas dari kreator sebelum terbit." />
    <p v-if="actions.notice.value" class="rc-alert rc-alert--success" role="status">{{ actions.notice.value }}</p>

    <div class="rc-toolbar">
      <div class="rc-segment" role="group" aria-label="Jenis konten">
        <button type="button" class="rc-segment__item" :aria-pressed="kind === 'article'" @click="set({ type: 'article' })">Artikel</button>
        <button type="button" class="rc-segment__item" :aria-pressed="kind === 'class'" @click="set({ type: 'class' })">Kelas</button>
      </div>
      <label>
        Status
        <select class="rc-field" :value="status" :disabled="tagsOnly" @change="set({ status: ($event.target as HTMLSelectElement).value })">
          <option v-for="item in STATUSES" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label class="rc-check">
        <input type="checkbox" :checked="tagsOnly" @change="set({ tags: ($event.target as HTMLInputElement).checked ? 'pending' : '' })" />
        Hanya yang punya tag menunggu
      </label>
    </div>

    <AdminState
      :status="state"
      :error="error"
      :empty="rows.length === 0"
      error-title="Gagal memuat antrean"
      empty-title="Antrean kosong"
      empty-message="Tidak ada konten pada status ini."
      @retry="refresh()"
    >
      <div class="rc-split rc-split--detail">
        <div>
          <div class="rc-table-wrap">
            <table class="rc-table">
              <caption>Konten untuk dimoderasi</caption>
              <thead>
                <tr>
                  <th scope="col">Judul</th>
                  <th scope="col">Tenant</th>
                  <th scope="col" class="rc-table__num">Harga</th>
                  <th scope="col">Status</th>
                  <th scope="col">Diajukan</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.id" :class="{ 'is-selected': row.id === selectedId }">
                  <td>
                    <button type="button" class="rc-table__link" :aria-pressed="row.id === selectedId" @click="select(row.id)">
                      {{ row.title }}
                    </button>
                    <span v-if="row.author" class="rc-table__sub">{{ row.author.name }}</span>
                    <span v-if="pendingTagsLabel(row.pendingConceptTags)" class="rc-table__sub">{{ pendingTagsLabel(row.pendingConceptTags) }}</span>
                  </td>
                  <td>{{ row.tenant?.name ?? '-' }}</td>
                  <td class="rc-table__num">{{ row.accessType === 'FREE' ? 'Gratis' : formatMoney(row.price, row.currency) }}</td>
                  <td><StatusBadge :tone="statusMeta('content', row.status).tone" :label="statusMeta('content', row.status).label" /></td>
                  <td>{{ formatDateTime(row.submittedAt ?? row.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AdminPager
            v-if="pagination"
            :page="pagination.page"
            :total-pages="pagination.totalPages"
            :total="pagination.total"
            @change="set({ page: $event })"
          />
        </div>

        <PlayCard v-if="selected" as="aside" class="rc-detail" aria-label="Detail konten">
          <h2>{{ selected.title }}</h2>
          <dl>
            <div><dt>Tenant</dt><dd>{{ selected.tenant?.name ?? '-' }}</dd></div>
            <div v-if="selected.author"><dt>Penulis</dt><dd>{{ selected.author.name }} ({{ selected.author.email }})</dd></div>
            <div><dt>Akses</dt><dd>{{ selected.accessType === 'FREE' ? 'Gratis' : formatMoney(selected.price, selected.currency) }}</dd></div>
            <div v-if="selected.format"><dt>Format</dt><dd>{{ selected.format }} · {{ selected.difficulty }}</dd></div>
            <div v-if="selected.reviewNote"><dt>Catatan tinjauan</dt><dd>{{ selected.reviewNote }}</dd></div>
          </dl>

          <LoadingSkeleton v-if="detailStatus === 'pending'" variant="panel" />
          <p v-else-if="detailError" class="rc-alert rc-alert--error" role="alert">{{ describeApiError(detailError, 'Isi konten gagal dimuat.') }}</p>
          <template v-else-if="detail">
            <RenderMarkdown v-if="body" :text="body" class="rc-admin-body" />
            <ul v-if="detail.sessions?.length" class="rc-list">
              <li v-for="session in detail.sessions" :key="session.id">
                {{ formatDateTime(session.startsAt) }} – {{ formatDateTime(session.endsAt) }}
              </li>
            </ul>
            <section v-if="detail.conceptLinks?.length" aria-labelledby="admin-tags-h">
              <h3 id="admin-tags-h">Konsep yang diklaim</h3>
              <ul class="rc-list">
                <li v-for="link in detail.conceptLinks" :key="link.conceptId">
                  {{ link.title }} · tingkat {{ link.level }} · {{ statusLabel(detail.conceptLinks, link.conceptId) }}
                </li>
              </ul>
            </section>
          </template>

          <div v-if="canDecideTags(selected.status, selected.pendingConceptTags)" class="rc-actions">
            <PlayButton size="sm" @click="open('approve-tags', selected.id)">Setujui tag</PlayButton>
            <PlayButton variant="danger" size="sm" @click="open('reject-tags', selected.id)">Tolak tag</PlayButton>
          </div>

          <div v-if="contentActions(selected.status).length" class="rc-actions">
            <PlayButton
              v-for="action in contentActions(selected.status)"
              :key="action"
              :variant="action === 'approve' || action === 'reinstate' ? 'primary' : 'danger'"
              size="sm"
              @click="open(action, selected.id)"
            >
              {{ ACTION_LABEL[action] }}
            </PlayButton>
          </div>
        </PlayCard>
      </div>
    </AdminState>

    <AdminReasonDialog
      :open="dialog !== null"
      :title="dialogMeta.title"
      :confirm-label="dialogMeta.confirm"
      :label="dialogMeta.label"
      :destructive="dialogMeta.destructive"
      :required="dialogMeta.required"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="confirm"
      @cancel="dialog = null"
    />
  </div>
</template>
