<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ChatCitation } from '~/interfaces/chats/chatExtras'
import { renderChatMarkdown } from '~/lib/chat-markdown'
import { citationIndexFromHref, previewContent, previewPosition } from '~/lib/citation-preview'

const props = defineProps<{
  text: string
  citations: ChatCitation[]
  prefix: string
}>()

const CLOSE_DELAY_MS = 140
const TOUCH_ECHO_MS = 700

interface OpenPreview {
  index: number
  left: number
  top: number
  side: 'below' | 'above'
  placed: boolean
}

const html = computed(() =>
  renderChatMarkdown(
    props.text,
    props.citations.map((citation) => citation.index),
    props.prefix,
  ),
)

const root = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const open = ref<OpenPreview | null>(null)
const cardId = `cite-preview-${useId()}`

const byIndex = computed(() => new Map(props.citations.map((citation) => [citation.index, citation])))
const content = computed(() => {
  const citation = open.value ? byIndex.value.get(open.value.index) : undefined
  return citation ? previewContent(citation) : null
})

let anchor: HTMLElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | undefined
let lastPointer = 'mouse'
let lastPointerAt = 0

const touchEcho = (): boolean => lastPointer === 'touch' && Date.now() - lastPointerAt < TOUCH_ECHO_MS

function markerOf(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const link = target.closest<HTMLAnchorElement>('.rc-cite a')
  return link && root.value?.contains(link) ? link : null
}

function cancelClose() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = undefined
}

function close() {
  cancelClose()
  anchor?.removeAttribute('aria-describedby')
  anchor = null
  open.value = null
}

function scheduleClose() {
  cancelClose()
  closeTimer = setTimeout(close, CLOSE_DELAY_MS)
}

function place() {
  if (!open.value || !anchor || !root.value || !card.value) return
  const marker = anchor.getBoundingClientRect()
  const bounds = root.value.getBoundingClientRect()
  const box = card.value.getBoundingClientRect()
  const placement = previewPosition({
    anchor: { left: marker.left, top: marker.top, bottom: marker.bottom },
    box: { width: box.width, height: box.height },
    bounds: { left: bounds.left, top: bounds.top, width: bounds.width },
    viewportHeight: window.innerHeight,
  })
  open.value = { ...open.value, ...placement, placed: true }
  anchor.setAttribute('aria-describedby', cardId)
}

async function show(link: HTMLAnchorElement) {
  const index = citationIndexFromHref(link.getAttribute('href'), props.prefix)
  if (index === null || !byIndex.value.has(index)) return
  cancelClose()
  if (anchor === link && open.value?.index === index) return
  anchor?.removeAttribute('aria-describedby')
  anchor = link
  open.value = { index, left: 0, top: 0, side: 'below', placed: false }
  await nextTick()
  place()
}

function onOver(event: MouseEvent) {
  if (touchEcho()) return
  const link = markerOf(event.target)
  if (link) void show(link)
}

function onOut(event: MouseEvent) {
  if (!markerOf(event.target)) return
  const next = event.relatedTarget
  if (next instanceof Node && card.value?.contains(next)) return
  scheduleClose()
}

function onFocusIn(event: FocusEvent) {
  if (touchEcho()) return
  const link = markerOf(event.target)
  if (link) void show(link)
}

function onFocusOut(event: FocusEvent) {
  if (markerOf(event.target)) scheduleClose()
}

function onPointerDown(event: PointerEvent) {
  lastPointer = event.pointerType
  lastPointerAt = Date.now()
}

function onClick(event: MouseEvent) {
  const link = markerOf(event.target)
  if (!link || !touchEcho()) return
  const index = citationIndexFromHref(link.getAttribute('href'), props.prefix)
  if (index === null || open.value?.index === index) return
  event.preventDefault()
  void show(link)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) close()
}

function onScroll(event: Event) {
  const target = event.target
  if (target instanceof Node && (card.value?.contains(target) ?? false)) return
  close()
}

function onOutside(event: Event) {
  if (!open.value) return
  const target = event.target
  if (target instanceof Node && (root.value?.contains(target) ?? false)) return
  close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  window.addEventListener('scroll', onScroll, { passive: true, capture: true })
  window.addEventListener('resize', close)
})

onBeforeUnmount(() => {
  cancelClose()
  document.removeEventListener('pointerdown', onOutside)
  window.removeEventListener('scroll', onScroll, { capture: true })
  window.removeEventListener('resize', close)
})
</script>

<template>
  <div
    ref="root"
    class="rc-cited"
    @mouseover="onOver"
    @mouseout="onOut"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @pointerdown="onPointerDown"
    @click="onClick"
    @keydown="onKeydown"
  >
    <div class="rc-prose" v-html="html" />
    <div
      v-if="open && content"
      :id="cardId"
      ref="card"
      class="rc-cite-card"
      role="tooltip"
      :data-side="open.side"
      :style="{ left: `${open.left}px`, top: `${open.top}px`, visibility: open.placed ? 'visible' : 'hidden' }"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <p class="rc-cite-card__title">
        <span class="rc-cite-card__index" aria-hidden="true">{{ content.index }}</span>
        <span>{{ content.title }}</span>
      </p>
      <p class="rc-cite-card__meta">{{ content.meta }}</p>
      <blockquote v-if="content.snippet" class="rc-cite-card__quote">{{ content.snippet }}</blockquote>
      <p v-else class="rc-cite-card__meta">Sumber ini tidak punya cuplikan teks.</p>
    </div>
  </div>
</template>

<style>
.rc-cited {
  position: relative;
  min-width: 0;
}
.rc-cite-card {
  position: absolute;
  z-index: 20;
  display: grid;
  gap: 0.375rem;
  width: min(22rem, 100%);
  padding: 0.75rem 0.875rem;
  border: 2px solid var(--rc-border-strong);
  border-radius: calc(var(--rc-radius, 16px) - 2px);
  background-color: var(--rc-surface);
  box-shadow: 0 4px 0 var(--rc-border), 0 12px 28px color-mix(in srgb, var(--rc-fg) 18%, transparent);
  color: var(--rc-fg);
  font-size: 0.85rem;
  line-height: 1.45;
  text-align: left;
}
.rc-cite-card__title {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  margin: 0;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.rc-cite-card__index {
  flex: none;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  background-color: var(--rc-primary);
  color: var(--rc-primary-fg);
  font-size: 0.7rem;
  line-height: 1.2rem;
  text-align: center;
}
.rc-cite-card__meta {
  margin: 0;
  color: var(--rc-muted);
  font-size: 0.78rem;
}
.rc-cite-card__quote {
  max-height: 11rem;
  margin: 0;
  padding: 0.25rem 0 0.25rem 0.625rem;
  overflow-y: auto;
  border-left: 3px solid var(--rc-secondary);
  overflow-wrap: anywhere;
}
</style>
