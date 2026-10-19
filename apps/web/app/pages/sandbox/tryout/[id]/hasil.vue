<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import EmptyState from '~/components/ui/EmptyState.vue'
import ErrorState from '~/components/ui/ErrorState.vue'
import InfiniteFooter from '~/components/ui/InfiniteFooter.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import StatusBadge from '~/components/ui/StatusBadge.vue'
import type { SubtestKey } from '~/interfaces/sandbox/tryout'
import { tryoutApi } from '~/lib/api'
import { describeApiError } from '~/lib/api-error'
import { formatDateTime } from '~/lib/format'
import {
  REVIEW_FILTER_LABEL,
  REVIEW_PAGE_STEP,
  UTBK_COURSE_SLUG,
  filterReview,
  formatDuration,
  formatPercent,
  optionLetter,
  reviewSubtests,
  scoreBand,
  secondsPerQuestionText,
  type ReviewFilter,
} from '~/lib/tryout'

definePageMeta({
  title: 'Hasil Tryout — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

useHead({ title: 'Hasil Tryout — ReduCera' })

const route = useRoute()
const id = computed(() => String(route.params.id || ''))

const { data: result, error, refresh } = await useAsyncData(() => `sandbox:tryout:result:${id.value}`, () => tryoutApi.result(id.value), {
  watch: [id],
})

const filter = ref<ReviewFilter>('all')
const subtestFilter = ref<SubtestKey | 'all'>('all')
const rows = computed(() => (result.value ? filterReview(result.value.review, filter.value, subtestFilter.value) : []))
const reviewWindow = useIncremental(rows, { step: REVIEW_PAGE_STEP, resetOn: () => [filter.value, subtestFilter.value] })
const reviewSubtestOptions = computed(() =>
  result.value ? reviewSubtests(result.value.review, Object.fromEntries(result.value.subtests.map((subtest) => [subtest.key, subtest.title]))) : [],
)
const band = computed(() => (result.value ? scoreBand(result.value.percent) : null))
const weakConcepts = computed(() => {
  if (!result.value) return []
  const weak = new Set(result.value.weakConceptIds)
  return result.value.concepts.filter((concept) => weak.has(concept.conceptId))
})
const blank = computed(() => (result.value ? result.value.total - result.value.answered : 0))
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Hasil tryout" subtitle="Skor latihan dihitung dari persentase jawaban benar, bukan skor IRT resmi UTBK.">
      <template #actions>
        <PlayButton to="/sandbox/tryout" size="sm">Buat tryout baru</PlayButton>
      </template>
    </PageHeader>

    <LoadingSkeleton v-if="!result && !error" variant="card" :count="3" />
    <ErrorState v-else-if="error && !result" title="Hasil tryout tidak bisa dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else-if="result && band">
      <PlayCard as="section" aria-labelledby="res-score-h">
        <h2 id="res-score-h" class="sr-only">Ringkasan skor</h2>
        <div class="rc-try-score">
          <p class="rc-try-score__figure" aria-label="Skor">{{ formatPercent(result.percent) }}</p>
          <div>
            <StatusBadge :tone="band.tone" :label="band.label" />
            <p>{{ result.correct }} dari {{ result.total }} soal benar · {{ result.answered }} dijawab<template v-if="blank > 0">, {{ blank }} dibiarkan kosong</template></p>
            <p class="rc-hint">
              Waktu terpakai {{ formatDuration(result.usedSeconds) }} dari {{ formatDuration(result.durationSeconds) }}
              <template v-if="result.timedOut"> (waktu habis)</template>
              · {{ secondsPerQuestionText(result.usedSeconds, result.answered) }}
            </p>
            <p v-if="result.submittedAt" class="rc-hint">Selesai {{ formatDateTime(result.submittedAt) }}</p>
          </div>
        </div>
      </PlayCard>

      <PlayCard as="section" aria-labelledby="res-sub-h">
        <h2 id="res-sub-h" class="rc-h2">Skor per subtes</h2>
        <ul class="rc-try-bars">
          <li v-for="subtest in result.subtests" :key="subtest.key">
            <div class="rc-sbx-levels__label">
              <span>{{ subtest.title }}</span>
              <span>{{ subtest.correct }}/{{ subtest.total }} · {{ formatPercent(subtest.percent) }}</span>
            </div>
            <div class="rc-sbx-meter" role="img" :aria-label="`${subtest.title}: ${subtest.correct} dari ${subtest.total} benar`">
              <span class="rc-sbx-meter__fill" :style="{ width: `${subtest.percent}%` }"></span>
            </div>
          </li>
        </ul>
      </PlayCard>

      <PlayCard as="section" aria-labelledby="res-weak-h" :tone="weakConcepts.length ? 'soft' : 'success'">
        <h2 id="res-weak-h" class="rc-h2">Bagian yang perlu dilatih</h2>
        <template v-if="weakConcepts.length">
          <p>Konsep berikut benar kurang dari 60% pada tryout ini. Pelajari ulang, lalu coba tryout baru untuk melihat perkembanganmu.</p>
          <ul class="rc-try-weak">
            <li v-for="concept in weakConcepts" :key="concept.conceptId">
              <strong>{{ concept.title }}</strong>
              <span class="rc-hint">{{ concept.correct }} dari {{ concept.total }} benar</span>
            </li>
          </ul>
          <div class="rc-actions">
            <PlayButton :to="`/learn/topics/${UTBK_COURSE_SLUG}`" variant="secondary" size="sm">Buka course Persiapan UTBK-SNBT</PlayButton>
          </div>
        </template>
        <p v-else>Tidak ada konsep dengan hasil di bawah 60%. Pertahankan, dan coba paket yang lebih panjang.</p>
        <p class="rc-hint">Hasil tryout dicatat sebagai bukti belajar untuk konsep yang punya cukup soal dan sudah kamu jawab.</p>
      </PlayCard>

      <section aria-labelledby="res-review-h">
        <h2 id="res-review-h" class="rc-h2">Pembahasan</h2>
        <div class="rc-try-filter" role="group" aria-label="Saring pembahasan">
          <PlayButton
            v-for="(label, key) in REVIEW_FILTER_LABEL"
            :key="key"
            :variant="filter === key ? 'secondary' : 'outline'"
            size="sm"
            :aria-pressed="filter === key"
            @click="filter = key as ReviewFilter"
          >
            {{ label }}
          </PlayButton>
        </div>
        <label v-if="reviewSubtestOptions.length > 1" class="rc-try-review__subtest">
          Subtes
          <select v-model="subtestFilter" class="rc-field">
            <option value="all">Semua subtes</option>
            <option v-for="subtest in reviewSubtestOptions" :key="subtest.key" :value="subtest.key">{{ subtest.title }} ({{ subtest.count }})</option>
          </select>
        </label>
        <EmptyState v-if="rows.length === 0" title="Tidak ada soal yang cocok" message="Ubah filter pembahasan untuk melihat soal lain." />
        <ol v-else class="rc-try-review" aria-label="Pembahasan soal">
          <li v-for="entry in reviewWindow.visible.value" :key="entry.item.id" class="rc-try-review__item" :class="entry.item.correct ? 'is-correct' : 'is-wrong'" :value="entry.index + 1">
            <div class="rc-sbx-meta">
              <StatusBadge :tone="entry.item.correct ? 'success' : entry.item.chosen === null ? 'neutral' : 'error'" :label="entry.item.correct ? 'Benar' : entry.item.chosen === null ? 'Kosong' : 'Salah'" />
              <span class="rc-hint">{{ entry.item.section }}</span>
            </div>
            <article v-if="entry.item.passage" class="rc-try__passage" :aria-label="`Teks bacaan: ${entry.item.passage.title}`">
              <h3>{{ entry.item.passage.title }}</h3>
              <p>{{ entry.item.passage.text }}</p>
            </article>
            <p class="rc-try__stem">{{ entry.item.stem }}</p>
            <ul class="rc-try__options rc-try__options--review">
              <li
                v-for="(option, optionIndex) in entry.item.options"
                :key="optionIndex"
                class="rc-try__option"
                :class="{ 'is-key': optionIndex === entry.item.answer, 'is-picked': optionIndex === entry.item.chosen && optionIndex !== entry.item.answer }"
              >
                <span class="rc-try__letter" aria-hidden="true">{{ optionLetter(optionIndex) }}</span>
                <span class="rc-try__text">
                  {{ option }}
                  <span v-if="optionIndex === entry.item.answer" class="rc-try__tag">Kunci jawaban</span>
                  <span v-else-if="optionIndex === entry.item.chosen" class="rc-try__tag rc-try__tag--picked">Jawabanmu</span>
                </span>
              </li>
            </ul>
            <p class="rc-sbx-result__why">{{ entry.item.explanation }}</p>
          </li>
        </ol>
        <InfiniteFooter :shown="reviewWindow.visible.value.length" :total="rows.length" noun="soal" :has-more="reviewWindow.hasMore.value" @more="reviewWindow.more()" />
      </section>
    </template>
  </div>
</template>
