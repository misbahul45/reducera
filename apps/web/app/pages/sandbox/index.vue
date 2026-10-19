<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue'
import PlayButton from '~/components/play/PlayButton.vue'
import PlayCard from '~/components/play/PlayCard.vue'
import InfiniteFooter from '~/components/ui/InfiniteFooter.vue'
import StatusBadge from '~/components/ui/StatusBadge.vue'
import type { User } from '~/interfaces/auth'
import { sandboxApi, sqlSandboxApi, tryoutApi } from '~/lib/api'
import {
  COURSE_MODE_LABEL,
  COURSE_MODE_ORDER,
  COURSE_PAGE_STEP,
  PLAYGROUNDS,
  filterCourses,
  modeCounts,
  playgroundForCourse,
  type CourseModeFilter,
  type PlaygroundDefinition,
} from '~/lib/playground'
import { progressPercent } from '~/lib/sandbox'
import { formatDuration } from '~/lib/tryout'
import { userTopicService } from '~/services/learning/userTopic'

definePageMeta({
  title: 'Sandbox — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
})

useHead({ title: 'Sandbox — ReduCera' })

const user = useState<User | null>('user')

const { data: courses } = useAsyncData(
  'sandbox:hub:courses',
  async () => {
    if (!user.value?.id) return []
    const res = await userTopicService.findAll<true>({ page: 1, limit: 100, userId: user.value.id, include: 'topic' })
    return (res.data?.data ?? []).flatMap((row) => (row.topic ? [{ id: row.id, title: row.topic.title, slug: row.topic.slug }] : []))
  },
  { lazy: true, server: false, default: () => [] },
)

const { data: accounting } = useAsyncData('sandbox:hub:accounting', () => sandboxApi.catalog().catch(() => null), { lazy: true, server: false })
const { data: sql } = useAsyncData('sandbox:hub:sql', () => sqlSandboxApi.catalog().catch(() => null), { lazy: true, server: false })
const { data: tryout } = useAsyncData('sandbox:hub:tryout', () => tryoutApi.catalog().catch(() => null), { lazy: true, server: false })

const courseFilter = reactive({ mode: 'ALL' as CourseModeFilter, q: '' })
const filteredCourses = computed(() => filterCourses(courses.value ?? [], courseFilter))
const counts = computed(() => modeCounts(courses.value ?? []))
const modeChoices = computed(() => COURSE_MODE_ORDER.filter((mode) => mode === 'ALL' || counts.value[mode] > 0))
const courseWindow = useIncremental(filteredCourses, { step: COURSE_PAGE_STEP, resetOn: () => [courseFilter.mode, courseFilter.q] })
const courseLinks = computed(() => courseWindow.visible.value.map((course) => ({ ...course, playground: playgroundForCourse(course) })))
const courseFiltering = computed(() => courseFilter.mode !== 'ALL' || courseFilter.q.trim() !== '')

function clearCourseFilter() {
  courseFilter.mode = 'ALL'
  courseFilter.q = ''
}

function progressLine(playground: PlaygroundDefinition): string | null {
  if (playground.mode === 'ACCOUNTING' && accounting.value) {
    const { solved, total } = accounting.value.summary
    return `${solved} dari ${total} skenario selesai`
  }
  if (playground.mode === 'SQL' && sql.value) {
    const { solved, total } = sql.value.summary
    return `${solved} dari ${total} latihan selesai`
  }
  if (playground.mode === 'TRYOUT' && tryout.value) {
    if (tryout.value.active) return `Ada tryout berjalan, sisa ${formatDuration(tryout.value.active.remainingSeconds)}`
    const last = tryout.value.recent[0]
    return last ? `Tryout terakhir: ${last.correct} dari ${last.total} benar` : 'Belum ada tryout'
  }
  return null
}

function progressValue(playground: PlaygroundDefinition): number | null {
  if (playground.mode === 'ACCOUNTING' && accounting.value) return progressPercent(accounting.value.summary.solved, accounting.value.summary.total)
  if (playground.mode === 'SQL' && sql.value) return progressPercent(sql.value.summary.solved, sql.value.summary.total)
  return null
}
</script>

<template>
  <div class="rc-stack">
    <PageHeader title="Sandbox" subtitle="Tempat berlatih langsung. Pilih jenis latihan, atau mulai dari course yang sedang kamu pelajari." />

    <section v-if="(courses ?? []).length" aria-labelledby="hub-courses-h">
      <h2 id="hub-courses-h" class="rc-h2">Sesuai course-mu</h2>
      <form class="rc-sbx-hub__filters" role="search" aria-label="Saring course" @submit.prevent>
        <div class="rc-sbx-hub__modes" role="group" aria-label="Jenis latihan">
          <PlayButton
            v-for="mode in modeChoices"
            :key="mode"
            :variant="courseFilter.mode === mode ? 'secondary' : 'outline'"
            size="sm"
            :aria-pressed="courseFilter.mode === mode"
            @click="courseFilter.mode = mode"
          >
            {{ COURSE_MODE_LABEL[mode] }} ({{ counts[mode] }})
          </PlayButton>
        </div>
        <label>
          Cari course
          <input v-model="courseFilter.q" type="search" class="rc-field" maxlength="60" placeholder="Contoh: SQL" autocomplete="off" />
        </label>
        <PlayButton v-if="courseFiltering" variant="ghost" size="sm" @click="clearCourseFilter">Hapus filter</PlayButton>
      </form>
      <p v-if="filteredCourses.length === 0" class="rc-hint" role="status">Tidak ada course yang cocok. Ubah atau hapus filter.</p>
      <ul v-else class="rc-sbx-hub" aria-label="Latihan untuk course-mu">
        <li v-for="course in courseLinks" :key="course.id">
          <PlayCard as="article" class="rc-sbx-hub__card">
            <StatusBadge :tone="course.playground.mode === 'TUTOR' ? 'neutral' : 'info'" :label="course.playground.title" />
            <h3 class="rc-sbx-hub__title">{{ course.title }}</h3>
            <div class="rc-actions">
              <PlayButton :to="course.playground.to" variant="secondary" size="sm">{{ course.playground.action }}</PlayButton>
            </div>
          </PlayCard>
        </li>
      </ul>
      <InfiniteFooter :shown="courseLinks.length" :total="filteredCourses.length" noun="course" :has-more="courseWindow.hasMore.value" @more="courseWindow.more()" />
    </section>

    <section aria-labelledby="hub-all-h">
      <h2 id="hub-all-h" class="rc-h2">Semua latihan</h2>
      <ul class="rc-sbx-hub" aria-label="Daftar sandbox">
        <li v-for="playground in PLAYGROUNDS" :key="playground.mode">
          <PlayCard as="article" class="rc-sbx-hub__card">
            <UIcon :name="playground.icon" class="rc-sbx-hub__icon" aria-hidden="true" />
            <h3 class="rc-sbx-hub__title">{{ playground.title }}</h3>
            <p class="rc-sbx-hub__summary">{{ playground.summary }}</p>
            <p v-if="progressLine(playground)" class="rc-hint" role="status">{{ progressLine(playground) }}</p>
            <div
              v-if="progressValue(playground) !== null"
              class="rc-sbx-meter"
              role="img"
              :aria-label="`${progressValue(playground)} persen selesai`"
            >
              <span class="rc-sbx-meter__fill" :style="{ width: `${progressValue(playground)}%` }"></span>
            </div>
            <div class="rc-actions">
              <PlayButton :to="playground.to" size="sm">{{ playground.action }}</PlayButton>
            </div>
          </PlayCard>
        </li>
      </ul>
    </section>
  </div>
</template>
