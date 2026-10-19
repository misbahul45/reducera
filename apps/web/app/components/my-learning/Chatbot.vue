<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { User } from '~/interfaces/auth'
import type { BaseChatMessage } from '~/interfaces/chats/chatMessage'
import type { PendingImage } from '~/interfaces/chats/chatAttachment'
import type { ChatAction, RunnableAction } from '~/interfaces/chats/chatExtras'
import { QUICK_ACTIONS, STARTERS, MESSAGE_MAX, actionLabel, canSend, greeting, isBusy, isRunnable, normalizeActions } from '~/lib/chat'
import { ATTACHMENT_ACCEPT, ATTACHMENTS_PER_MESSAGE, checkImage, imageFiles, isUploading, issueText, pastedImages, readyIds } from '~/lib/chat-attachments'
import { draftFromReply } from '~/lib/notes'
import { chatAttachmentService } from '~/services/chat/chatAttachments'
import { chatMessageService } from '~/services/chat/chatMessages'
import { noteService } from '~/services/notes'
import ChatMessageItem from './ChatMessageItem.vue'
import CoreAvatar from './CoreAvatar.vue'
import NoteComposerDialog from './NoteComposerDialog.vue'

const props = defineProps<{
  chatId: string
  userStepId: string
  autoAction?: RunnableAction | null
}>()

const emit = defineEmits<{ 'auto-started': [] }>()

const POLL_MS = 3000
const INPUT_MAX_HEIGHT = 200

const toast = useToast()
const user = useState<User | null>('user')
const { dock, toggle, show, close, toggleWide, restore, setAvailable } = useChatDock()

const draft = ref('')
const sending = ref(false)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const triggerEl = ref<{ $el?: HTMLElement } | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const pending = ref<PendingImage[]>([])
const dragging = ref(false)

const { data: resChatMessages, refresh: refreshChatMessages } = useAsyncData(
  `chat-messages-${props.chatId}`,
  () => chatMessageService.findAll({ chatId: props.chatId, page: 1, limit: 500 }),
  { lazy: true },
)

const messages = computed<BaseChatMessage[]>(() => (resChatMessages.value?.data?.data as BaseChatMessage[] | undefined) ?? [])
const waitingForReply = computed(() => messages.value.some((message) => message.role === 'ASSISTANT' && isBusy(message.status)))
const uploading = computed(() => isUploading(pending.value))
const imageCount = computed(() => readyIds(pending.value).length)
const locked = computed(() => waitingForReply.value || sending.value)
const sendable = computed(() => canSend(draft.value, locked.value || uploading.value, imageCount.value))
const learnerName = computed(() => (user.value?.name ?? '').trim().split(/\s+/)[0] || 'Kamu')

let source: EventSource | null = null
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  restore()
  setAvailable(true)
  source = chatMessageService.listenChatMessages()
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data?.chatId === props.chatId) refreshChatMessages()
    } catch {
      return
    }
  }
  timer = setInterval(() => {
    if (waitingForReply.value) refreshChatMessages()
  }, POLL_MS)
  mounted.value = true
})

onBeforeUnmount(() => {
  setAvailable(false)
  source?.close()
  if (timer) clearInterval(timer)
  pending.value.forEach((image) => URL.revokeObjectURL(image.previewUrl))
})

async function toBottom() {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

watch(
  () => [messages.value.length, messages.value.at(-1)?.status, messages.value.at(-1)?.text],
  toBottom,
)

watch(
  () => dock.value.open,
  async (isOpen) => {
    if (!isOpen) return
    await nextTick()
    inputEl.value?.focus()
    await toBottom()
  },
)

function fitInput() {
  const element = inputEl.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, INPUT_MAX_HEIGHT)}px`
}

watch(draft, () => nextTick(fitInput))

function forget(image: PendingImage) {
  URL.revokeObjectURL(image.previewUrl)
  pending.value = pending.value.filter((item) => item.key !== image.key)
}

async function attach(files: File[]) {
  for (const file of files) {
    const issue = checkImage(file, pending.value.length)
    if (issue) {
      toast.add({ title: 'Gambar tidak bisa dilampirkan', description: issueText(issue), color: 'error', icon: 'i-lucide-image-off' })
      if (issue === 'limit') break
      continue
    }
    const image: PendingImage = { key: crypto.randomUUID(), name: file.name || 'gambar', previewUrl: URL.createObjectURL(file), status: 'uploading' }
    pending.value = [...pending.value, image]
    try {
      const uploaded = await chatAttachmentService.upload(props.chatId, file)
      pending.value = pending.value.map((item) => (item.key === image.key ? { ...item, status: 'ready', id: uploaded.id } : item))
    } catch {
      pending.value = pending.value.map((item) => (item.key === image.key ? { ...item, status: 'failed' } : item))
      toast.add({ title: 'Gambar belum terunggah', description: 'Coba lampirkan lagi atau pilih gambar lain.', color: 'error', icon: 'i-lucide-image-off' })
    }
  }
}

async function discard(image: PendingImage) {
  forget(image)
  if (image.id) await chatAttachmentService.remove(image.id).catch(() => undefined)
}

function acceptImages(source: FileList | null | undefined) {
  const images = imageFiles(source)
  if (source && source.length > images.length) {
    toast.add({ title: 'Gambar tidak bisa dilampirkan', description: issueText('type'), color: 'error', icon: 'i-lucide-image-off' })
  }
  if (images.length > 0) attach(images)
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  acceptImages(files)
  input.value = ''
}

function onPaste(event: ClipboardEvent) {
  const files = pastedImages(event.clipboardData?.items)
  if (files.length === 0) return
  event.preventDefault()
  attach(files)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  acceptImages(event.dataTransfer?.files)
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) dragging.value = true
}

async function send(text: string = draft.value) {
  const attachmentIds = text === draft.value ? readyIds(pending.value) : []
  if (!canSend(text, locked.value || uploading.value, attachmentIds.length)) return
  sending.value = true
  const result = await chatMessageService.create({
    chatId: props.chatId,
    text: text.trim(),
    role: 'USER',
    status: 'COMPLETED',
    userStepId: props.userStepId,
    userId: user.value?.id ?? '',
    attachmentIds,
  })
  sending.value = false
  if (result.success) {
    draft.value = ''
    pending.value.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    pending.value = []
  } else toast.add({ title: 'Pesan belum terkirim', description: 'Coba kirim lagi sebentar lagi.', color: 'error' })
  await refreshChatMessages()
}

async function runAction(action: RunnableAction) {
  if (locked.value) return
  sending.value = true
  const result = await chatMessageService.runAction({
    chatId: props.chatId,
    userStepId: props.userStepId,
    userId: user.value?.id ?? '',
    action,
  })
  sending.value = false
  if (!result.success) toast.add({ title: `${actionLabel(action)} belum bisa dijalankan`, description: 'Coba lagi sebentar lagi.', color: 'error' })
  await refreshChatMessages()
}

let autoStarted = false
const mounted = ref(false)

async function startAutoAction() {
  if (autoStarted || !mounted.value || !props.autoAction || resChatMessages.value === undefined) return
  autoStarted = true
  show()
  emit('auto-started')
  if (!locked.value) await runAction(props.autoAction)
}

watch([() => props.autoAction, resChatMessages, mounted], () => void startAutoAction())

async function retry(message: BaseChatMessage) {
  if (locked.value) return
  const action = normalizeActions(message.actions).find(isRunnable)
  const earlier = messages.value.slice(0, messages.value.findIndex((item) => item.id === message.id))
  const previous = [...earlier].reverse().find((item) => item.role === 'USER')
  await chatMessageService.delete(message.id)
  if (action) await runAction(action)
  else if (previous?.text) await send(previous.text)
  else await refreshChatMessages()
}

const noteOpen = ref(false)
const noteSaving = ref(false)
const noteFailure = ref<string | null>(null)
const noteDraft = ref({ title: '', body: '', chatMessageId: '' })

function openNoteFromMessage(message: BaseChatMessage) {
  const draftOfReply = draftFromReply(message.text ?? '')
  noteDraft.value = { ...draftOfReply, chatMessageId: message.id }
  noteFailure.value = null
  noteOpen.value = true
}

function openNoteFromAction(message: BaseChatMessage, action: ChatAction) {
  if (action.type !== 'NOTE') return
  noteDraft.value = { title: action.title, body: action.body, chatMessageId: message.id }
  noteFailure.value = null
  noteOpen.value = true
}

async function saveNote(value: { title: string; body: string }) {
  noteSaving.value = true
  noteFailure.value = null
  const result = await noteService.create({
    title: value.title,
    body: value.body,
    userStepId: props.userStepId,
    chatMessageId: noteDraft.value.chatMessageId,
    source: 'CHAT',
  })
  noteSaving.value = false
  if (!result.success) {
    noteFailure.value = 'Catatan belum tersimpan. Coba lagi sebentar lagi.'
    return
  }
  noteOpen.value = false
  toast.add({
    title: result.data?.duplicate ? 'Catatan ini sudah tersimpan' : 'Tersimpan di catatan',
    color: 'success',
    icon: 'i-lucide-notebook-pen',
  })
}

async function openMaterial() {
  if (window.matchMedia('(max-width: 1023px)').matches) close()
  await nextTick()
  const target = document.getElementById('step-material')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  send()
}

async function closeAndReturn() {
  close()
  await nextTick()
  triggerEl.value?.$el?.focus()
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !noteOpen.value) closeAndReturn()
}
</script>

<template>
  <PlayButton
    ref="triggerEl"
    variant="secondary"
    :aria-expanded="dock.open"
    aria-controls="rc-chat-dock"
    @click="toggle"
  >
    <UIcon name="i-lucide-bot" aria-hidden="true" />
    {{ dock.open ? 'Tutup CORE' : 'Tanya CORE' }}
  </PlayButton>

  <aside
    v-if="dock.open"
    id="rc-chat-dock"
    class="rc-chatdock"
    :class="{ 'rc-chatdock--wide': dock.wide, 'rc-chatdock--drop': dragging }"
    aria-label="Chat dengan CORE"
    @keydown="onPanelKeydown"
    @dragover.prevent="onDragOver"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <header class="rc-chat__header">
      <div class="rc-chat__identity">
        <CoreAvatar size="lg" :thinking="locked" />
        <div>
          <h2 class="rc-chat__title">CORE</h2>
          <p class="rc-hint">Teman belajarmu untuk langkah ini.</p>
        </div>
      </div>
      <div class="rc-chat__tools">
        <PlayButton
          class="rc-chat__widen"
          variant="ghost"
          size="sm"
          :aria-label="dock.wide ? 'Perkecil panel chat' : 'Perlebar panel chat'"
          :aria-pressed="dock.wide"
          @click="toggleWide"
        >
          <UIcon :name="dock.wide ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" aria-hidden="true" />
        </PlayButton>
        <PlayButton variant="ghost" size="sm" aria-label="Tutup chat" @click="closeAndReturn">
          <UIcon name="i-lucide-x" aria-hidden="true" />
        </PlayButton>
      </div>
    </header>

    <ul ref="listEl" class="rc-chat__list" role="log" aria-live="polite" aria-label="Percakapan dengan CORE">
      <li v-if="messages.length === 0" class="rc-chat__msg rc-chat__msg--bot">
        <p class="rc-chat__who"><CoreAvatar size="sm" /> CORE</p>
        <p class="rc-chat__text">{{ greeting(user?.name?.trim().split(/\s+/)[0]) }}</p>
        <div class="rc-chat__starters">
          <PlayButton v-for="starter in STARTERS" :key="starter" variant="outline" size="sm" :disabled="locked" @click="send(starter)">
            {{ starter }}
          </PlayButton>
        </div>
      </li>

      <ChatMessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :learner-name="learnerName"
        :disabled="locked"
        @save="openNoteFromMessage(message)"
        @act="runAction($event as RunnableAction)"
        @note="openNoteFromAction(message, $event)"
        @material="openMaterial"
        @retry="retry(message)"
      />
    </ul>

    <div class="rc-chat__chips" role="group" aria-label="Minta CORE membantu">
      <PlayButton v-for="action in QUICK_ACTIONS" :key="actionLabel(action)" variant="outline" size="sm" :disabled="locked" @click="runAction(action)">
        {{ actionLabel(action) }}
      </PlayButton>
    </div>

    <form class="rc-chat__form" @submit.prevent="send()">
      <label class="rc-chat__label" for="chat-input">Pesan untuk CORE</label>

      <ul v-if="pending.length" class="rc-chat__pending" aria-label="Gambar yang akan dikirim">
        <li v-for="image in pending" :key="image.key" class="rc-chat__pendingitem" :data-status="image.status">
          <UIcon v-if="image.status === 'failed'" name="i-lucide-image-off" class="rc-chat__pendingicon" aria-hidden="true" />
          <img v-else :src="image.previewUrl" :alt="`Pratinjau ${image.name}`" width="56" height="56" />
          <span v-if="image.status === 'uploading'" class="rc-chat__pendingstate" role="status">Mengunggah…</span>
          <span v-else-if="image.status === 'failed'" class="rc-chat__pendingstate rc-error-text">Gagal</span>
          <button type="button" class="rc-chat__remove" :aria-label="`Hapus gambar ${image.name}`" @click="discard(image)">
            <UIcon name="i-lucide-x" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <div class="rc-chat__composer">
        <input ref="fileEl" type="file" class="rc-chat__file" :accept="ATTACHMENT_ACCEPT" multiple tabindex="-1" aria-hidden="true" @change="onPick" />
        <textarea
          id="chat-input"
          ref="inputEl"
          v-model="draft"
          class="rc-field rc-chat__input"
          rows="2"
          :maxlength="MESSAGE_MAX"
          placeholder="Tanya CORE atau tempel gambar. Enter untuk kirim."
          @keydown="onKeydown"
          @paste="onPaste"
        />
        <div class="rc-chat__toolbar">
          <PlayButton
            variant="outline"
            size="sm"
            :disabled="locked || pending.length >= ATTACHMENTS_PER_MESSAGE"
            aria-label="Lampirkan gambar"
            @click="fileEl?.click()"
          >
            <UIcon name="i-lucide-image-plus" aria-hidden="true" />
            Gambar
          </PlayButton>
          <p class="rc-hint rc-chat__count" aria-live="off">{{ draft.length }} / {{ MESSAGE_MAX }}</p>
          <PlayButton type="submit" size="sm" :loading="sending" :disabled="!sendable">
            <UIcon name="i-lucide-send-horizontal" aria-hidden="true" />
            Kirim
          </PlayButton>
        </div>
      </div>
    </form>
  </aside>

  <NoteComposerDialog
    v-model:open="noteOpen"
    heading="Simpan ke catatan"
    :initial-title="noteDraft.title"
    :initial-body="noteDraft.body"
    :saving="noteSaving"
    :failure="noteFailure"
    @save="saveNote"
  />
</template>

<style>
.rc-chatdock {
  position: fixed;
  z-index: 35;
  top: var(--rc-bar-h, 3.75rem);
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: var(--rc-chat-w, 30rem);
  padding: 1rem;
  border-left: 2px solid var(--rc-border);
  background-color: var(--rc-surface);
  color: var(--rc-fg);
}
@media (max-width: 1023px) {
  html:has(.rc-chatdock) {
    overflow: hidden;
  }
  .rc-chatdock {
    left: 0;
    width: 100%;
    border-left: 0;
  }
  .rc-chat__widen {
    display: none;
  }
}
.rc-chatdock--drop {
  outline: 3px dashed var(--rc-secondary);
  outline-offset: -6px;
}
.rc-chat__file {
  display: none;
}
.rc-chat__pending {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rc-chat__pendingitem {
  position: relative;
  width: 3.5rem;
  height: 3.5rem;
  border: 2px solid var(--rc-border);
  border-radius: 0.625rem;
  overflow: hidden;
  background-color: var(--rc-foam);
}
.rc-chat__pendingitem img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rc-chat__pendingicon {
  position: absolute;
  top: 0.5rem;
  left: 50%;
  width: 1.5rem;
  height: 1.5rem;
  transform: translateX(-50%);
  color: var(--rc-danger);
}
.rc-chat__pendingitem[data-status='uploading'] img {
  opacity: 0.45;
}
.rc-chat__pendingitem[data-status='failed'] {
  border-color: var(--rc-danger);
}
.rc-chat__pendingstate {
  position: absolute;
  inset: auto 0 0 0;
  padding: 0.0625rem 0.125rem;
  background-color: color-mix(in srgb, var(--rc-surface) 88%, transparent);
  font-size: 0.625rem;
  font-weight: 800;
  text-align: center;
}
.rc-chat__remove {
  position: absolute;
  top: 0.125rem;
  right: 0.125rem;
  display: grid;
  place-items: center;
  width: 1.375rem;
  height: 1.375rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--rc-surface) 90%, transparent);
  color: var(--rc-fg);
  cursor: pointer;
}
.rc-chat__remove:hover {
  background-color: var(--rc-danger);
  color: var(--rc-surface);
}
.rc-chat__remove:focus-visible {
  outline: 3px solid var(--rc-focus);
  outline-offset: 1px;
}
.rc-chat__images {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  padding: 0;
  list-style: none;
}
.rc-chat__image {
  display: block;
  border: 2px solid var(--rc-border);
  border-radius: 0.75rem;
  overflow: hidden;
  background-color: var(--rc-foam);
}
.rc-chat__image img {
  display: block;
  max-width: 10rem;
  max-height: 7.5rem;
  width: auto;
  height: auto;
  object-fit: cover;
}
.rc-chat__image:focus-visible {
  outline: 3px solid var(--rc-focus);
  outline-offset: 2px;
}
.rc-chat__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--rc-border);
}
.rc-chat__identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.rc-chat__tools {
  display: flex;
  gap: 0.25rem;
}
.rc-chat__title {
  margin: 0;
  font-size: 1.125rem;
}
.rc-chat__list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.875rem;
  min-height: 0;
  margin: 0;
  padding: 0 0.25rem 0 0;
  overflow-y: auto;
  list-style: none;
}
.rc-chat__msg {
  max-width: 94%;
  padding: 0.75rem 1rem;
  border: 2px solid var(--rc-border);
  border-radius: var(--rc-radius, 16px);
  font-size: 1rem;
}
.rc-chatdock--wide .rc-chat__msg {
  max-width: 82%;
}
.rc-chat__msg--bot {
  align-self: flex-start;
  background-color: color-mix(in srgb, var(--rc-secondary) 10%, var(--rc-surface));
}
.rc-chat__msg--me {
  align-self: flex-end;
  background-color: color-mix(in srgb, var(--rc-primary) 12%, var(--rc-surface));
}
.rc-chat__who {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.375rem;
  color: var(--rc-muted);
  font-size: 0.75rem;
  font-weight: 800;
}
.rc-chat__me {
  display: grid;
  place-items: center;
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid var(--rc-primary-depth);
  border-radius: 50%;
  background-color: var(--rc-primary);
  color: var(--rc-primary-fg);
  font-size: 0.8125rem;
  font-weight: 800;
  line-height: 1;
  text-transform: uppercase;
}
.rc-chat__text {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.rc-chat__prose {
  font-size: 1rem;
  line-height: 1.6;
}
.rc-chat__prose > :last-child {
  margin-bottom: 0;
}
.rc-chat__typing {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--rc-muted);
}
.rc-chat__dots {
  display: inline-flex;
  gap: 0.25rem;
}
.rc-chat__dots i {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background-color: var(--rc-secondary);
  animation: rc-chat-dot 1200ms ease-in-out infinite;
}
.rc-chat__dots i:nth-child(2) {
  animation-delay: 150ms;
}
.rc-chat__dots i:nth-child(3) {
  animation-delay: 300ms;
}
@keyframes rc-chat-dot {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rc-chat__dots i {
    animation: none;
    opacity: 0.7;
  }
}
.rc-chat__actions,
.rc-chat__starters,
.rc-chat__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.rc-chat__actions,
.rc-chat__starters {
  margin-top: 0.625rem;
}
@media (max-width: 639px) {
  .rc-chat__chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 0.25rem;
    scrollbar-width: thin;
  }
  .rc-chat__chips > * {
    flex: none;
  }
}
.rc-chat__form {
  display: grid;
  gap: 0.375rem;
}
.rc-chat__label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.rc-chat__composer {
  display: grid;
  gap: 0.5rem;
}
.rc-chat__input {
  width: 100%;
  min-height: 3.5rem;
  max-height: 12.5rem;
  resize: none;
  overflow-y: auto;
}
.rc-chat__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.rc-chat__count {
  margin: 0;
  flex: 1;
  text-align: center;
}
</style>
