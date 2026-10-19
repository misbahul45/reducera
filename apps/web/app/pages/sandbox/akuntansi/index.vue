<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import InfiniteFooter from '~/components/ui/InfiniteFooter.vue'
import StatusBadge from '~/components/ui/StatusBadge.vue'
import type { Difficulty, PracticeStatus } from '~/interfaces/sandbox/practice'
import { sandboxApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import type { FilterDefs } from '~/lib/query-filters'
import {
  DIFFICULTY_LABEL,
  REASON_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  levelLabel,
  progressPercent,
  recommendationLink,
} from '~/lib/sandbox'

const PAGE_SIZE = 12

definePageMeta({
  title: 'Latihan Jurnal — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

useHead({ title: 'Latihan Jurnal — ReduCera' })

const defs = {
  level: { kind: 'enum', values: ['1', '2', '3', '4'] },
  difficulty: { kind: 'enum', values: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] },
  status: { kind: 'enum', values: ['NEW', 'IN_PROGRESS', 'SOLVED'] },
  q: { kind: 'text', max: 60 },
} satisfies FilterDefs

const { filters, set } = useQueryFilters(defs)
const draft = ref(String(filters.value.q ?? ''))
watch(
  () => filters.value.q,
  (value) => {
    draft.value = String(value ?? '')
  },
)

const query = computed(() => ({
  ...(filters.value.level ? { level: Number(filters.value.level) } : {}),
  ...(filters.value.difficulty ? { difficulty: filters.value.difficulty as Difficulty } : {}),
  ...(filters.value.status ? { status: filters.value.status as PracticeStatus } : {}),
  ...(filters.value.q ? { q: String(filters.value.q) } : {}),
}))

const feed = await useInfiniteFeed({
  key: 'sandbox:catalog',
  watch: [query],
  fetchPage: (cursor) => sandboxApi.catalog({ ...query.value, limit: PAGE_SIZE, cursor }),
  itemsOf: (response) => response.scenarios,
  keyOf: (scenario) => scenario.id,
})
const { data: catalog, status, error, refresh } = feed

const { data: signals } = useAsyncData('sandbox:signals', () => sandboxApi.signals().catch(() => null), { lazy: true, server: false })

const hasFilter = computed(() => Object.keys(query.value).length > 0)
const summary = computed(() => catalog.value?.summary ?? null)
const habits = computed(() => signals.value?.openMisconceptions ?? [])
const percent = computed(() => (summary.value ? progressPercent(summary.value.solved, summary.value.total) : 0))

function applySearch() {
  set({ q: draft.value.trim() })
}

function clearFilters() {
  draft.value = ''
  set({ level: '', difficulty: '', status: '', q: '' })
}
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Latihan jurnal" subtitle="Catat transaksi dari skenario nyata. Setiap pemeriksaan menunjukkan baris mana yang sudah tepat dan mengapa.">
      <template #actions>
        <PlayButton to="/sandbox" variant="ghost" size="sm">Semua sandbox</PlayButton>
      </template>
    </PageHeader>

    <LoadingSkeleton v-if="status === 'pending' && !catalog" variant="card" :count="3" />
    <ErrorState v-else-if="error && !catalog" title="Skenario gagal dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else-if="catalog">
      <PlayCard v-if="catalog.recommended && !hasFilter" as="section" tone="soft" aria-labelledby="reco-h">
        <div class="rc-sbx-reco">
          <StatusBadge tone="info" :label="REASON_LABEL[catalog.recommended.reason]" />
          <h2 id="reco-h" class="rc-h2">Latihan untukmu: {{ catalog.recommended.title }}</h2>
          <p>{{ catalog.recommended.message }}</p>
          <div class="rc-actions">
            <PlayButton :to="recommendationLink(catalog.recommended)">Mulai latihan</PlayButton>
          </div>
        </div>
      </PlayCard>

      <PlayCard v-if="summary" as="section" aria-labelledby="progress-h">
        <div class="rc-sbx-summary">
          <h2 id="progress-h" class="rc-h2">Kemajuanmu</h2>
          <p class="rc-sbx-summary__figure">{{ summary.solved }} dari {{ summary.total }} skenario selesai</p>
          <div class="rc-sbx-meter" role="img" :aria-label="`${percent} persen skenario selesai`">
            <span class="rc-sbx-meter__fill" :style="{ width: `${percent}%` }"></span>
          </div>
          <p class="rc-hint">
            {{ summary.solvedUnaided }} diselesaikan tanpa melihat jawaban · {{ summary.inProgress }} sedang dikerjakan
          </p>
          <ul class="rc-sbx-levels" aria-label="Kemajuan per level">
            <li v-for="level in summary.levels" :key="level.level">
              <div class="rc-sbx-levels__label">
                <span>{{ levelLabel(level.level) }}</span>
                <span>{{ level.solved }}/{{ level.total }}</span>
              </div>
              <div class="rc-sbx-meter" role="img" :aria-label="`${levelLabel(level.level)}: ${level.solved} dari ${level.total} selesai`">
                <span class="rc-sbx-meter__fill" :style="{ width: `${progressPercent(level.solved, level.total)}%` }"></span>
              </div>
            </li>
          </ul>
        </div>
      </PlayCard>

      <PlayCard v-if="habits.length && !hasFilter" as="section" aria-labelledby="habits-h">
        <h2 id="habits-h" class="rc-h2">Kebiasaan yang perlu dilatih</h2>
        <ul class="rc-sbx-habits">
          <li v-for="habit in habits" :key="habit.code">Kamu {{ habit.label }} ({{ habit.count }} kali).</li>
        </ul>
        <p class="rc-hint">Latihan yang disarankan di atas menargetkan kebiasaan ini lebih dulu.</p>
      </PlayCard>

      <form class="rc-sbx-filters" aria-label="Saring skenario" @submit.prevent="applySearch">
        <label>
          Level
          <select class="rc-field" :value="filters.level" @change="set({ level: ($event.target as HTMLSelectElement).value })">
            <option value="">Semua level</option>
            <option v-for="level in [1, 2, 3, 4]" :key="level" :value="String(level)">{{ levelLabel(level) }}</option>
          </select>
        </label>
        <label>
          Tingkat kesulitan
          <select class="rc-field" :value="filters.difficulty" @change="set({ difficulty: ($event.target as HTMLSelectElement).value })">
            <option value="">Semua</option>
            <option v-for="(label, key) in DIFFICULTY_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label>
          Status
          <select class="rc-field" :value="filters.status" @change="set({ status: ($event.target as HTMLSelectElement).value })">
            <option value="">Semua</option>
            <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <div class="rc-sbx-search">
          <label>
            Cari
            <input v-model="draft" type="search" class="rc-field" maxlength="60" placeholder="Contoh: gaji" autocomplete="off" />
          </label>
          <PlayButton type="submit" variant="secondary" size="sm">Cari</PlayButton>
          <PlayButton v-if="hasFilter" variant="ghost" size="sm" @click="clearFilters">Hapus filter</PlayButton>
        </div>
      </form>

      <EmptyState
        v-if="feed.items.value.length === 0"
        title="Tidak ada skenario yang cocok"
        message="Ubah atau hapus filter untuk melihat skenario lain."
        cta-label="Lihat semua skenario"
        cta-to="/sandbox/akuntansi"
      />
      <ul v-else class="rc-mgrid" aria-label="Daftar skenario latihan">
        <li v-for="scenario in feed.items.value" :key="scenario.id">
          <article class="rc-card rc-sbx-card">
            <div class="rc-sbx-meta">
              <StatusBadge :tone="STATUS_TONE[scenario.practice.status]" :label="STATUS_LABEL[scenario.practice.status]" />
              <span class="rc-hint">{{ levelLabel(scenario.level) }} · {{ DIFFICULTY_LABEL[scenario.difficulty] }}</span>
            </div>
            <h3>
              <NuxtLink :to="`/sandbox/${scenario.id}`" class="rc-sbx-card__link">{{ scenario.title }}</NuxtLink>
            </h3>
            <p class="rc-hint">
              {{ scenario.lineCount }} baris jurnal
              <template v-if="scenario.practice.attempts > 0"> · {{ scenario.practice.attempts }} percobaan · skor terbaik {{ Math.round(scenario.practice.bestScore * 100) }}%</template>
            </p>
          </article>
        </li>
      </ul>
      <InfiniteFooter
        :shown="feed.items.value.length"
        :total="feed.total.value"
        noun="skenario"
        :has-more="feed.hasMore.value"
        :loading="feed.loadingMore.value"
        :error="feed.moreError.value"
        @more="feed.loadMore()"
      />
    </template>
  </div>
</template>
