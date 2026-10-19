<script setup lang="ts">
import ReviewCard from '~/components/my-learning/ReviewCard.vue';
import PageHeader from '~/components/play/PageHeader.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import PlayProgress from '~/components/play/PlayProgress.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import EmptyState from '~/components/ui/EmptyState.vue';
import ErrorState from '~/components/ui/ErrorState.vue';
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue';
import { personalizationApi } from '~/lib/api';
import { describeApiError } from '~/lib/api-error';
import { nextConceptCopy, strategyEvidenceCopy, strategyLabel, strategyReasons } from '~/lib/learner';
import { summarizeMastery, toPercent } from '~/lib/mastery';

definePageMeta({
  title: 'Penguasaan — ReduCera',
  protection: { kind: 'authenticated' },
});

useHead({ title: 'Penguasaan — ReduCera' });

const { data: mastery, status, error, refresh } = useAsyncData('learner:mastery', () => personalizationApi.listMastery(), { lazy: true });

const { data: next } = useAsyncData('learner-next-concept', () => personalizationApi.nextConcept(), { lazy: true });
const { data: strategy } = useAsyncData('learner-strategy-next', () => personalizationApi.strategy(), { lazy: true });
const { data: evidence } = useAsyncData('learner-strategy-evidence', () => personalizationApi.strategies(), { lazy: true });

const summary = computed(() => summarizeMastery(mastery.value ?? []));
const nextCopy = computed(() => (next.value ? nextConceptCopy(next.value) : null));
const reasons = computed(() => (strategy.value ? strategyReasons(strategy.value.reasonCodes) : []));
const evidenceCopy = computed(() => (evidence.value ? strategyEvidenceCopy(evidence.value) : null));
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Penguasaan" subtitle="Seberapa jauh kamu menguasai tiap konsep, dihitung dari hasil kuis dan latihan." />

    <LoadingSkeleton v-if="status === 'pending'" variant="panel" :count="2" />
    <ErrorState v-else-if="error" title="Penguasaan gagal dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else>
      <ul class="rc-studio-stats" aria-label="Ringkasan penguasaan">
        <li class="rc-card"><span class="rc-hint">Konsep dikerjakan</span><strong>{{ summary.conceptsStarted }}</strong></li>
        <li class="rc-card"><span class="rc-hint">Rata-rata penguasaan</span><strong>{{ summary.averagePercent }}%</strong></li>
        <li class="rc-card"><span class="rc-hint">Konsep dikuasai</span><strong>{{ summary.masteredCount }}</strong></li>
      </ul>

      <ReviewCard />

      <PlayCard v-if="nextCopy" as="section" :tone="nextCopy.done ? 'gold' : 'success'" aria-labelledby="next-concept-h">
        <h2 id="next-concept-h" class="rc-h2">{{ nextCopy.done ? nextCopy.title : `Berikutnya: ${nextCopy.title}` }}</h2>
        <p class="rc-hint">{{ nextCopy.reason }}</p>
        <template v-if="strategy && !nextCopy.done">
          <p>CORE akan mengajarkannya dengan <strong>{{ strategyLabel(strategy.strategy) }}</strong>.</p>
          <ul v-if="reasons.length" class="rc-reasons" aria-label="Alasan pemilihan cara belajar">
            <li v-for="line in reasons" :key="line">{{ line }}</li>
          </ul>
        </template>
        <div class="rc-actions">
          <PlayButton to="/learn/profile/my-learning">{{ nextCopy.done ? 'Lihat course-ku' : 'Lanjut belajar' }}</PlayButton>
        </div>
      </PlayCard>

      <PlayCard v-if="evidenceCopy" as="section" aria-labelledby="works-h">
        <h2 id="works-h" class="rc-h2">{{ evidenceCopy.title }}</h2>
        <p class="rc-hint">{{ evidenceCopy.hint }}</p>
        <ul v-if="evidenceCopy.rows.length" class="rc-studio-list" aria-label="Hasil tiap cara belajar">
          <li v-for="row in evidenceCopy.rows" :key="row.strategy" class="rc-card rc-mastery__row">
            <p class="rc-studio-list__title">
              {{ row.label }}
              <StatusBadge v-if="row.preferred" tone="success" label="Paling cocok" />
            </p>
            <PlayProgress :value="row.percent ?? 0" :label="`Keberhasilan ${row.label}`" :tone="row.preferred ? 'success' : 'info'" show-value />
            <p class="rc-hint">{{ row.successes }} dari {{ row.attempts }} percobaan menaikkan penguasaanmu</p>
          </li>
        </ul>
      </PlayCard>

      <section class="rc-stack" aria-labelledby="mastery-detail">
        <h2 id="mastery-detail" class="rc-h2">Detail penguasaan</h2>
        <EmptyState
          v-if="!mastery || mastery.length === 0"
          title="Belum ada data penguasaan"
          message="Kerjakan kuis pertamamu untuk melihat kemajuan di sini."
          cta-label="Pilih course"
          cta-to="/learn/topics"
        />
        <ul v-else class="rc-studio-list" aria-label="Penguasaan per konsep">
          <li v-for="entry in mastery.slice(0, 30)" :key="entry.conceptId" class="rc-card rc-mastery__row">
            <p class="rc-studio-list__title">{{ entry.title }}</p>
            <PlayProgress :value="toPercent(entry.score)" :label="entry.title" :tone="entry.mastered ? 'success' : 'info'" show-value />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
