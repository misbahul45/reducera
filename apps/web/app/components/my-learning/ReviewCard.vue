<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import ReviewReminderToggle from '~/components/my-learning/ReviewReminderToggle.vue'
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue'
import type { User } from '~/interfaces/auth'
import { personalizationApi } from '~/lib/api'
import { dueSoonCopy, entryHint, firstReviewable, headline, reviewHref, sessionCopy } from '~/lib/review'

const SHOWN = 3

const user = useState<User | null>('user')
const userId = computed(() => user.value?.id ?? '')

const { data: view, status, error, refresh } = useAsyncData(() => `learner-review-${userId.value || 'guest'}`, () => personalizationApi.review(), {
  lazy: true,
  server: false,
  watch: [userId],
})

const primary = computed(() => (view.value ? firstReviewable(view.value) : null))
const shown = computed(() => (view.value ? view.value.due.slice(0, SHOWN) : []))
const next = computed(() => view.value?.upcoming[0] ?? null)
const hiddenCount = computed(() => (view.value ? Math.max(0, view.value.dueTotal - shown.value.length) : 0))
const asOf = computed(() => new Date(view.value?.generatedAt ?? 0))
</script>

<template>
  <ClientOnly>
    <LoadingSkeleton v-if="status === 'pending' && !view" variant="panel" :count="1" aria-label="Memuat ulasan" />

    <PlayCard v-else-if="view && view.dueTotal > 0" as="section" tone="gold" class="rc-relearn" aria-labelledby="review-h">
      <h2 id="review-h" class="rc-h2">{{ headline(view) }}</h2>
      <p class="rc-hint">Ulang konsep yang mulai terlupa supaya ingatanmu tetap kuat. {{ sessionCopy(view.session) }}</p>

      <ul class="rc-relearn__list" aria-label="Konsep yang perlu diulang">
        <li v-for="entry in shown" :key="entry.conceptId" class="rc-relearn__item">
          <div class="rc-relearn__text">
            <p class="rc-studio-list__title">{{ entry.title }}</p>
            <p class="rc-hint">{{ entryHint(entry) }}</p>
            <p v-if="!reviewHref(entry)" class="rc-hint">Kamu belum punya langkah belajar untuk konsep ini.</p>
          </div>
          <PlayButton v-if="reviewHref(entry)" :to="reviewHref(entry)!" variant="secondary" size="sm">Ulas</PlayButton>
        </li>
      </ul>
      <p v-if="hiddenCount > 0" class="rc-hint">Dan {{ hiddenCount }} konsep lain menunggu.</p>

      <div class="rc-actions">
        <PlayButton v-if="primary" :to="reviewHref(primary)!">Mulai ulasan singkat</PlayButton>
      </div>
      <ReviewReminderToggle :enabled="view.reminders" @changed="refresh()" />
    </PlayCard>

    <PlayCard v-else-if="view && view.dueTotal === 0 && next" as="section" class="rc-relearn" aria-labelledby="review-h">
      <h2 id="review-h" class="rc-h2">{{ headline(view) }}</h2>
      <p class="rc-hint">Ulasan berikutnya: {{ next.title }}, {{ dueSoonCopy(next, asOf) }}.</p>
      <ReviewReminderToggle :enabled="view.reminders" @changed="refresh()" />
    </PlayCard>

    <p v-else-if="error" class="rc-hint" role="status">Jadwal ulasan belum bisa dimuat.</p>
  </ClientOnly>
</template>

<style>
.rc-relearn {
  display: grid;
  gap: 0.75rem;
}
.rc-relearn__list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rc-relearn__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.rc-relearn__text {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}
</style>
