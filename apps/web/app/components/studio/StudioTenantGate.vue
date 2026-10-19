<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue';
import EmptyState from '~/components/ui/EmptyState.vue';
import ErrorState from '~/components/ui/ErrorState.vue';
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { statusMeta } from '~/lib/admin';
import { describeApiError } from '~/lib/api-error';
import { tenantStatusNotice } from '~/lib/studio-tenant';

const ROLES: Record<string, string> = { OWNER: 'Pemilik', MANAGER: 'Manajer', TEACHER: 'Pengajar', EDITOR: 'Editor' };

const { options, state, status, error, refresh, select, isAdmin } = useStudioTenant();

const activeId = computed(() => (state.value.kind === 'ready' ? state.value.active.id : ''));

function onSwitch(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) select(id);
}
</script>

<template>
  <EmptyState
    v-if="isAdmin"
    icon-name="i-lucide-store"
    title="Studio adalah ruang kerja kreator"
    message="Admin tidak menulis artikel atau kelas lewat studio. Tinjau karya kreator dari halaman moderasi."
    cta-label="Buka moderasi"
    cta-to="/admin/moderation"
  />
  <LoadingSkeleton v-else-if="status === 'pending' && options.length === 0" variant="row" :count="3" />
  <ErrorState v-else-if="error" title="Gagal memuat studio" :message="describeApiError(error)" @retry="refresh()" />
  <EmptyState
    v-else-if="state.kind === 'none'"
    icon-name="i-lucide-store"
    title="Kamu belum punya studio"
    message="Ajukan diri sebagai kreator untuk membuka studio dan menjual artikel atau kelas."
    cta-label="Jadi kreator"
    cta-to="/become-creator"
  />
  <section v-else-if="state.kind === 'inactive'" class="rc-card rc-stack" aria-labelledby="studio-inactive">
    <h2 id="studio-inactive" class="rc-h2">{{ state.blocked.name }}</h2>
    <StatusBadge :tone="statusMeta('tenant', state.blocked.status).tone" :label="statusMeta('tenant', state.blocked.status).label" />
    <p class="rc-hint">{{ tenantStatusNotice(state.blocked.status) }}</p>
    <div class="rc-actions">
      <PlayButton to="/learn/profile/dashboard" variant="secondary" size="sm">Kembali belajar</PlayButton>
    </div>
  </section>
  <section v-else-if="state.kind === 'choose'" class="rc-card rc-stack" aria-labelledby="studio-choose">
    <h2 id="studio-choose" class="rc-h2">Pilih studio</h2>
    <p class="rc-hint">Kamu punya lebih dari satu studio. Pilih yang ingin kamu kelola sekarang.</p>
    <ul class="rc-studio-list" aria-label="Daftar studio">
      <li v-for="option in state.options" :key="option.id" class="rc-card">
        <div class="rc-studio-list__main">
          <p class="rc-studio-list__title">{{ option.name }}</p>
          <p class="rc-hint">Peran: {{ ROLES[option.role ?? ''] ?? option.role }}</p>
        </div>
        <StatusBadge :tone="statusMeta('tenant', option.status).tone" :label="statusMeta('tenant', option.status).label" />
        <div class="rc-actions">
          <PlayButton size="sm" :disabled="option.status !== 'ACTIVE'" @click="select(option.id)">Buka studio</PlayButton>
        </div>
      </li>
    </ul>
  </section>
  <div v-else class="rc-stack">
    <label v-if="state.options.length > 1" class="rc-label rc-studio-tenant">
      Studio aktif
      <select class="rc-field" :value="activeId" @change="onSwitch">
        <option v-for="option in state.options" :key="option.id" :value="option.id" :disabled="option.status !== 'ACTIVE'">
          {{ option.name }}{{ option.status === 'ACTIVE' ? '' : ` (${statusMeta('tenant', option.status).label})` }}
        </option>
      </select>
    </label>
    <div :key="activeId">
      <slot />
    </div>
  </div>
</template>
