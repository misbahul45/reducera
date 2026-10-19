<script setup lang="ts">
import type { ChatCitation } from '~/interfaces/chats/chatExtras'
import { groundingNote, safeHref, sourceLabel, viaLabels } from '~/lib/chat'
import { citationAnchor } from '~/lib/chat-markdown'

const props = withDefaults(
  defineProps<{
    citations: ChatCitation[]
    prefix: string
    title?: string
    note?: boolean
  }>(),
  { title: 'Sumber', note: false },
)
</script>

<template>
  <section class="rc-sources" :aria-label="title">
    <h3 v-if="title" class="rc-sources__title">{{ title }}</h3>
    <p v-if="note" class="rc-sources__note" role="status">{{ groundingNote(citations) }}</p>
    <ol v-if="citations.length" class="rc-sources__list">
      <li v-for="citation in citations" :id="citationAnchor(prefix, citation.index)" :key="citation.index" class="rc-sources__item">
        <span class="rc-sources__index">{{ citation.index }}</span>
        <span class="rc-sources__body">
          <a v-if="safeHref(citation.url)" :href="safeHref(citation.url)!" target="_blank" rel="noopener noreferrer">{{ citation.title }}</a>
          <span v-else class="rc-sources__name">{{ citation.title }}</span>
          <span class="rc-hint">
            {{ sourceLabel(citation) }}
            <template v-if="viaLabels(citation).length"> · {{ viaLabels(citation).join(', ') }}</template>
          </span>
          <span v-if="citation.snippet" class="rc-hint rc-sources__snippet">{{ citation.snippet }}</span>
        </span>
      </li>
    </ol>
  </section>
</template>

<style>
.rc-sources {
  display: grid;
  gap: 0.375rem;
  margin-top: 0.75rem;
  padding-top: 0.625rem;
  border-top: 2px solid var(--rc-border);
  font-size: 0.85rem;
}
.rc-sources__title {
  margin: 0;
  color: var(--rc-muted);
  font-size: 0.8rem;
  font-weight: 800;
}
.rc-sources__note {
  margin: 0;
  color: var(--rc-muted);
}
.rc-sources__list {
  display: grid;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rc-sources__item {
  display: flex;
  gap: 0.5rem;
  scroll-margin-top: 4rem;
}
.rc-sources__item:target .rc-sources__index {
  background-color: var(--rc-primary);
  color: var(--rc-primary-fg);
}
.rc-sources__index {
  flex: none;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--rc-secondary) 20%, var(--rc-surface));
  font-size: 0.7rem;
  font-weight: 800;
  line-height: 1.2rem;
  text-align: center;
}
.rc-sources__body {
  display: grid;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rc-sources__body a {
  color: var(--rc-secondary);
  font-weight: 700;
  text-decoration: underline;
}
.rc-sources__name {
  font-weight: 700;
}
.rc-sources__snippet {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
