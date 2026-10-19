<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import InfiniteFooter from '~/components/ui/InfiniteFooter.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import StatusBadge from '~/components/ui/StatusBadge.vue'
import type { HistorySort, ScoreBand, SubtestKey, TryoutPlan, TryoutSubtestInfo } from '~/interfaces/sandbox/tryout'
import { tryoutApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import { formatDateTime } from '~/lib/format'
import {
  BAND_LABEL,
  HISTORY_PAGE_SIZE,
  SORT_LABEL,
  clampCount,
  formatDuration,
  formatPercent,
  initialSelection,
  planFromSelection,
  planTotals,
  scoreBand,
  selectionFromPreset,
  type BuilderSelection,
} from '~/lib/tryout'

definePageMeta({
  title: 'Tryout UTBK-SNBT — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

useHead({ title: 'Tryout UTBK-SNBT — ReduCera' })

const { data: catalog, error, refresh } = await useAsyncData('sandbox:tryout:catalog', () => tryoutApi.catalog())

const subtests = computed(() => catalog.value?.subtests ?? [])

const history = reactive({ band: '' as ScoreBand | '', subtest: '' as SubtestKey | '', sort: 'NEWEST' as HistorySort })
const historyQuery = computed(() => ({
  ...(history.band ? { band: history.band } : {}),
  ...(history.subtest ? { subtest: history.subtest } : {}),
  sort: history.sort,
}))
const historyFiltering = computed(() => history.band !== '' || history.subtest !== '' || history.sort !== 'NEWEST')

const feed = await useInfiniteFeed({
  key: 'sandbox:tryout:history',
  watch: [historyQuery],
  fetchPage: (cursor) => tryoutApi.history({ ...historyQuery.value, limit: HISTORY_PAGE_SIZE, cursor }),
  itemsOf: (response) => response.items,
  keyOf: (item) => item.id,
})
const hasHistory = computed(() => (catalog.value?.recent.length ?? 0) > 0 || historyFiltering.value || feed.total.value > 0)

function clearHistoryFilter() {
  history.band = ''
  history.subtest = ''
  history.sort = 'NEWEST'
}
const selection = ref<BuilderSelection>(initialSelection(subtests.value))
const starting = ref<string | null>(null)
const problem = ref<string | null>(null)

const plan = computed(() => planFromSelection(subtests.value, selection.value))
const totals = computed(() => planTotals(subtests.value, plan.value))
const components = computed(() => {
  const tps = subtests.value.filter((subtest) => subtest.component === 'TPS')
  const literasi = subtests.value.filter((subtest) => subtest.component === 'LITERASI')
  return [
    { id: 'tps', title: 'Tes Potensi Skolastik', subtests: tps },
    { id: 'literasi', title: 'Tes Literasi', subtests: literasi },
  ].filter((group) => group.subtests.length > 0)
})

function applyPreset(entries: TryoutPlan['subtests']) {
  selection.value = selectionFromPreset(subtests.value, entries)
}

function setCount(subtest: TryoutSubtestInfo, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  selection.value = { ...selection.value, [subtest.key]: { selected: true, count: clampCount(value, subtest.maxCount) } }
}

function toggle(subtest: TryoutSubtestInfo, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const state = selection.value[subtest.key]
  selection.value = { ...selection.value, [subtest.key]: { selected: checked, count: state?.count ?? Math.min(10, subtest.maxCount) } }
}

async function start(chosen: TryoutPlan, key: string) {
  if (starting.value) return
  starting.value = key
  problem.value = null
  try {
    const session = await tryoutApi.start(chosen)
    await navigateTo(`/sandbox/tryout/${session.id}`)
  } catch (failure) {
    problem.value = describeApiError(failure)
    await refresh()
  } finally {
    starting.value = null
  }
}
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Tryout UTBK-SNBT" subtitle="Buat paket soal dengan waktu yang mengikuti kerangka resmi. Soal dibuat baru setiap kali, jadi kamu bisa mengulang tanpa bertemu soal yang sama.">
      <template #actions>
        <PlayButton to="/sandbox" variant="ghost" size="sm">Semua sandbox</PlayButton>
      </template>
    </PageHeader>

    <LoadingSkeleton v-if="!catalog && !error" variant="card" :count="3" />
    <ErrorState v-else-if="error && !catalog" title="Tryout gagal dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else-if="catalog">
      <PlayCard v-if="catalog.active" as="section" tone="gold" aria-labelledby="try-active-h">
        <h2 id="try-active-h" class="rc-h2">Tryout sedang berjalan</h2>
        <p>
          {{ catalog.active.answered }} dari {{ catalog.active.total }} soal sudah dijawab. Sisa waktu sekitar
          {{ formatDuration(catalog.active.remainingSeconds) }}.
        </p>
        <div class="rc-actions">
          <PlayButton :to="`/sandbox/tryout/${catalog.active.id}`">Lanjutkan tryout</PlayButton>
        </div>
      </PlayCard>

      <p v-if="problem" class="rc-alert rc-alert--error" role="alert">{{ problem }}</p>

      <section aria-labelledby="try-presets-h">
        <h2 id="try-presets-h" class="rc-h2">Pilih paket</h2>
        <ul class="rc-sbx-hub" aria-label="Paket tryout">
          <li v-for="preset in catalog.presets" :key="preset.id">
            <PlayCard as="article" class="rc-sbx-hub__card">
              <h3 class="rc-sbx-hub__title">{{ preset.title }}</h3>
              <p class="rc-sbx-hub__summary">{{ preset.description }}</p>
              <p class="rc-hint">{{ preset.itemCount }} soal · {{ formatDuration(preset.durationSeconds) }}</p>
              <div class="rc-actions">
                <PlayButton size="sm" :loading="starting === preset.id" :disabled="Boolean(catalog.active) || starting !== null" @click="start({ examKey: 'utbk-snbt', subtests: preset.subtests }, preset.id)">
                  Mulai paket ini
                </PlayButton>
                <PlayButton variant="ghost" size="sm" @click="applyPreset(preset.subtests)">Ubah dulu</PlayButton>
              </div>
            </PlayCard>
          </li>
        </ul>
      </section>

      <section aria-labelledby="try-custom-h">
        <h2 id="try-custom-h" class="rc-h2">Susun sendiri</h2>
        <form class="rc-try-builder" @submit.prevent="start(plan, 'custom')">
          <fieldset v-for="group in components" :key="group.id" class="rc-try-group">
            <legend>{{ group.title }}</legend>
            <ul class="rc-try-subtests">
              <li v-for="subtest in group.subtests" :key="subtest.key" class="rc-try-subtest" :class="{ 'is-on': selection[subtest.key]?.selected }">
                <label class="rc-try-subtest__check">
                  <input type="checkbox" :checked="selection[subtest.key]?.selected" @change="toggle(subtest, $event)" />
                  <span>
                    <strong>{{ subtest.title }}</strong>
                    <span class="rc-hint">{{ subtest.description }}</span>
                  </span>
                </label>
                <label class="rc-try-subtest__count">
                  <span>Jumlah soal</span>
                  <input
                    type="number"
                    class="rc-field"
                    inputmode="numeric"
                    min="1"
                    :max="subtest.maxCount"
                    :value="selection[subtest.key]?.count"
                    :disabled="!selection[subtest.key]?.selected"
                    @change="setCount(subtest, $event)"
                  />
                  <span class="rc-hint">
                    maks. {{ subtest.maxCount }}
                    <template v-if="subtest.maxCount < subtest.officialCount">(tes resmi {{ subtest.officialCount }})</template>
                  </span>
                </label>
              </li>
            </ul>
          </fieldset>
          <p class="rc-try-summary" role="status">
            <template v-if="totals.items > 0">{{ totals.items }} soal · {{ formatDuration(totals.seconds) }}</template>
            <template v-else>Pilih setidaknya satu subtes.</template>
          </p>
          <div class="rc-actions">
            <PlayButton type="submit" :loading="starting === 'custom'" :disabled="totals.items === 0 || Boolean(catalog.active) || starting !== null">Buat tryout</PlayButton>
          </div>
          <p v-if="catalog.active" class="rc-hint">Selesaikan tryout yang sedang berjalan sebelum membuat yang baru.</p>
        </form>
        <p class="rc-hint">{{ catalog.exam.scoring }} Jumlah soal bacaan mengikuti bank soal yang tersedia dan dapat lebih sedikit daripada tes resmi.</p>
      </section>

      <section v-if="hasHistory" aria-labelledby="try-recent-h">
        <h2 id="try-recent-h" class="rc-h2">Riwayat tryout</h2>
        <form class="rc-try-history__filters" role="search" aria-label="Saring riwayat tryout" @submit.prevent>
          <label>
            Skor
            <select v-model="history.band" class="rc-field">
              <option value="">Semua skor</option>
              <option v-for="(label, key) in BAND_LABEL" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label>
            Subtes
            <select v-model="history.subtest" class="rc-field">
              <option value="">Semua subtes</option>
              <option v-for="subtest in subtests" :key="subtest.key" :value="subtest.key">{{ subtest.title }}</option>
            </select>
          </label>
          <label>
            Urutkan
            <select v-model="history.sort" class="rc-field">
              <option v-for="(label, key) in SORT_LABEL" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <PlayButton v-if="historyFiltering" variant="ghost" size="sm" @click="clearHistoryFilter">Hapus filter</PlayButton>
        </form>
        <EmptyState
          v-if="feed.items.value.length === 0"
          title="Tidak ada tryout yang cocok"
          message="Ubah atau hapus filter untuk melihat tryout lain."
        />
        <ul v-else class="rc-try-recent" aria-label="Riwayat tryout">
          <li v-for="item in feed.items.value" :key="item.id">
            <PlayCard as="article">
              <div class="rc-sbx-meta">
                <StatusBadge :tone="scoreBand(item.percent).tone" :label="scoreBand(item.percent).label" />
                <span class="rc-hint">{{ formatDateTime(item.submittedAt ?? item.startedAt) }}</span>
              </div>
              <p class="rc-try-recent__score">{{ formatPercent(item.percent) }} <span class="rc-hint">({{ item.correct }} dari {{ item.total }} benar · {{ formatDuration(item.usedSeconds) }})</span></p>
              <p class="rc-hint">{{ item.subtests.map((subtest) => subtest.title).join(', ') }}</p>
              <div class="rc-actions">
                <PlayButton :to="`/sandbox/tryout/${item.id}/hasil`" variant="outline" size="sm">Lihat hasil</PlayButton>
              </div>
            </PlayCard>
          </li>
        </ul>
        <InfiniteFooter
          :shown="feed.items.value.length"
          :total="feed.total.value"
          noun="tryout"
          :has-more="feed.hasMore.value"
          :loading="feed.loadingMore.value"
          :error="feed.moreError.value"
          @more="feed.loadMore()"
        />
      </section>
    </template>
  </div>
</template>
