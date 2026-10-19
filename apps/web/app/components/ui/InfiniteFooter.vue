<script setup lang="ts">
import PlayButton from '~/components/play/PlayButton.vue'
import { shownText } from '~/lib/paging'

const props = withDefaults(
  defineProps<{
    shown: number
    total: number
    noun: string
    hasMore: boolean
    loading?: boolean
    error?: string | null
  }>(),
  { loading: false, error: null },
)

const emit = defineEmits<{ more: [] }>()

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let scroller: HTMLElement | null = null

const MARGIN_PX = 320

function findScroller(start: HTMLElement | null): HTMLElement | null {
  let node = start?.parentElement ?? null
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

function nearEnd(): boolean {
  const element = sentinel.value
  if (!element || typeof window === 'undefined') return false
  const limit = scroller ? Math.min(window.innerHeight, scroller.getBoundingClientRect().bottom) : window.innerHeight
  return element.getBoundingClientRect().top <= limit + MARGIN_PX
}

function request() {
  if (props.hasMore && !props.loading && !props.error) emit('more')
}

function observe() {
  observer?.disconnect()
  observer = null
  if (typeof IntersectionObserver === 'undefined' || !sentinel.value) return
  scroller = findScroller(sentinel.value)
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) request()
    },
    { root: scroller, rootMargin: `0px 0px ${MARGIN_PX}px 0px` },
  )
  observer.observe(sentinel.value)
}

onMounted(observe)

watch(sentinel, observe)

watch(
  () => [props.shown, props.loading, props.hasMore],
  async () => {
    await nextTick()
    if (nearEnd()) request()
  },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="rc-feed-foot">
    <p class="rc-hint" role="status">{{ shownText(shown, total, noun) }}</p>
    <div v-if="hasMore" ref="sentinel" class="rc-feed-foot__sentinel" aria-hidden="true"></div>
    <p v-if="error" class="rc-alert rc-alert--error" role="alert">{{ error }}</p>
    <PlayButton v-if="hasMore" variant="outline" size="sm" :loading="loading" @click="emit('more')">
      {{ error ? 'Coba lagi' : 'Muat lebih banyak' }}
    </PlayButton>
  </div>
</template>

<style>
.rc-feed-foot {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  margin: 1rem 0 0;
  text-align: center;
}
.rc-feed-foot > p {
  margin: 0;
}
.rc-feed-foot__sentinel {
  width: 100%;
  height: 1px;
}
</style>
