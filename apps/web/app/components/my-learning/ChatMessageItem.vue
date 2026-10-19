<script setup lang="ts">
import { computed } from 'vue'
import type { BaseChatMessage } from '~/interfaces/chats/chatMessage'
import type { ChatAction } from '~/interfaces/chats/chatExtras'
import { actionLabel, canSave, isBusy, isRunnable, normalizeActions, normalizeCitations } from '~/lib/chat'
import { attachmentAlt, attachmentPath, formatSize } from '~/lib/chat-attachments'
import { renderChatMarkdown } from '~/lib/chat-markdown'
import { normalizeApiPath } from '~/lib/api'
import CoreAvatar from './CoreAvatar.vue'
import SourceList from './SourceList.vue'

const props = defineProps<{
  message: BaseChatMessage
  learnerName: string
  disabled: boolean
}>()

const emit = defineEmits<{
  save: []
  act: [action: ChatAction]
  note: [action: ChatAction]
  material: []
  retry: []
}>()

const isBot = computed(() => props.message.role === 'ASSISTANT')
const busy = computed(() => isBusy(props.message.status))
const failed = computed(() => props.message.status === 'FAILED')
const citations = computed(() => normalizeCitations(props.message.citations))
const actions = computed(() => normalizeActions(props.message.actions))
const html = computed(() =>
  isBot.value && props.message.status === 'COMPLETED'
    ? renderChatMarkdown(props.message.text, citations.value.map((citation) => citation.index), props.message.id)
    : '',
)
const savable = computed(() => canSave(props.message))
const publicApi = useRuntimeConfig().public.API_URL as string
const images = computed(() =>
  (props.message.attachments ?? []).map((attachment) => ({
    ...attachment,
    href: `${publicApi}${normalizeApiPath(attachmentPath(attachment.id))}`,
    alt: attachmentAlt(attachment),
    size: formatSize(attachment.size),
  })),
)

const iconOf = (action: ChatAction): string => {
  if (action.type === 'QUIZ' || action.type === 'OPEN_QUIZ') return 'i-lucide-list-checks'
  if (action.type === 'NOTE') return 'i-lucide-notebook-pen'
  return 'i-lucide-wand-sparkles'
}

function press(action: ChatAction) {
  if (isRunnable(action)) emit('act', action)
  else if (action.type === 'NOTE') emit('note', action)
  else if (action.type === 'OPEN_MATERIAL') emit('material')
}
</script>

<template>
  <li class="rc-chat__msg" :class="isBot ? 'rc-chat__msg--bot' : 'rc-chat__msg--me'" :data-status="message.status">
    <p class="rc-chat__who">
      <CoreAvatar v-if="isBot" size="sm" :thinking="busy" />
      <span v-else class="rc-chat__me" aria-hidden="true">{{ learnerName.charAt(0) }}</span>
      {{ isBot ? 'CORE' : learnerName }}
    </p>

    <ul v-if="images.length" class="rc-chat__images" :aria-label="`${images.length} gambar terlampir`">
      <li v-for="image in images" :key="image.id">
        <a :href="image.href" target="_blank" rel="noopener noreferrer" class="rc-chat__image" :title="`${image.name} (${image.size}), buka di tab baru`">
          <img :src="image.href" :alt="image.alt" loading="lazy" decoding="async" width="160" height="120" />
        </a>
      </li>
    </ul>

    <p v-if="busy" class="rc-chat__typing" role="status">
      <span class="rc-chat__dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{{ message.text }}</span>
    </p>
    <div v-else-if="html" class="rc-prose rc-chat__prose" v-html="html" />
    <p v-else-if="message.text" class="rc-chat__text" :class="{ 'rc-error-text': failed }">{{ message.text }}</p>

    <SourceList v-if="citations.length" :citations="citations" :prefix="message.id" />

    <div v-if="actions.length || savable || failed" class="rc-chat__actions">
      <template v-for="action in actions" :key="action.type">
        <PlayButton
          v-if="action.type === 'OPEN_QUIZ'"
          size="sm"
          :to="`/my-learning/quizzes/${action.quizId}`"
        >
          <UIcon :name="iconOf(action)" aria-hidden="true" />
          {{ actionLabel(action) }}
        </PlayButton>
        <PlayButton v-else variant="outline" size="sm" :disabled="disabled && isRunnable(action)" @click="press(action)">
          <UIcon :name="iconOf(action)" aria-hidden="true" />
          {{ actionLabel(action) }}
        </PlayButton>
      </template>
      <PlayButton v-if="savable && !actions.some((action) => action.type === 'NOTE')" variant="ghost" size="sm" @click="emit('save')">
        <UIcon name="i-lucide-notebook-pen" aria-hidden="true" />
        Simpan ke catatan
      </PlayButton>
      <PlayButton v-if="failed" variant="outline" size="sm" :disabled="disabled" @click="emit('retry')">
        <UIcon name="i-lucide-rotate-ccw" aria-hidden="true" />
        Coba lagi
      </PlayButton>
    </div>
  </li>
</template>
