import type { Query, Tokens } from "~/interfaces/api"
import type { ChatMessageDetailResponse } from "~/interfaces/chats/chat"
import type { ChatMessagesListResponse } from "~/interfaces/chats/chatMessage"
import type { RunnableAction } from "~/interfaces/chats/chatExtras"
import { requestAi } from "~/lib/ai"
import { actionRequestText, MESSAGE_MAX } from "~/lib/chat"
import { queryFor } from "~/lib/chat-attachments"
import { apiUrl, request, toQueryString } from "~/lib/api"

export const chatMessageService = {
  async findAll<IncludeRelations extends boolean = false>(
    q: Query = {},
    tokens?: Tokens
  ) {
    const queryString = toQueryString(q)
    const url = queryString
      ? `/chat/chats/${q.chatId}/messages?${queryString}`
      : `/chat/chats/${q.chatId}/messages`

    return request<ChatMessagesListResponse<IncludeRelations>>(
      url,
      "GET",
      undefined,
      {},
      true,
      tokens
    )
  },

  async findOne<IncludeRelations extends boolean = false>(
    id: string,
    q: Query = {},
    tokens?: Tokens
  ) {
    const queryString = toQueryString(q)
    const url = queryString
      ? `/chat/chat-messages/${id}?${queryString}`
      : `/chat/chat-messages/${id}`

    return request<ChatMessageDetailResponse<IncludeRelations>>(
      url,
      "GET",
      undefined,
      {},
      true,
      tokens
    )
  },

  async create(
    data: {
      chatId: string
      text?: string | null
      status?: string
      role: string
      userStepId:string
      userId:string
      attachmentIds?: string[]
    },
    tokens?: Tokens
  ) {
    const attachmentIds = data.attachmentIds ?? []

    const userMessage = await request(
      "/chat/chat-messages",
      "POST",
      {
        chatId: data.chatId,
        ...(data.text ? { text: data.text } : {}),
        status: data.status || "COMPLETED",
        role: data.role,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      },
      {},
      true,
      tokens
    )
    if (!userMessage.success) return userMessage

    const placeholder = await request<{ id: string }>(
      "/chat/chat-messages",
      "POST",
      {
        chatId: data.chatId,
        text: "CORE sedang menyiapkan jawaban…",
        status: "PENDING",
        role: "ASSISTANT",
      },
      {},
      true,
      tokens
    )
    if (!placeholder.success || !placeholder.data) return placeholder

    const messageId = placeholder.data.id
    const dispatched = await requestAi(
      "/learning/chat",
      "POST",
      {
        chatId: data.chatId,
        query: queryFor(data.text ?? "", attachmentIds.length),
        userStepId: data.userStepId,
        userId: data.userId,
        messageId,
      },
      { "Idempotency-Key": crypto.randomUUID() },
      true,
      tokens
    )
    if (!dispatched.success) {
      await request(
        `/chat/chat-messages/${messageId}`,
        "PATCH",
        { status: "FAILED", text: "AI tidak dapat dihubungi. Silakan coba lagi." },
        {},
        true,
        tokens
      )
      return dispatched
    }

    return userMessage
  },

  async runAction(
    data: { chatId: string; userStepId: string; userId: string; action: RunnableAction },
    tokens?: Tokens
  ) {
    const request_ = await request(
      "/chat/chat-messages",
      "POST",
      { chatId: data.chatId, text: actionRequestText(data.action).slice(0, MESSAGE_MAX), status: "COMPLETED", role: "USER" },
      {},
      true,
      tokens
    )
    if (!request_.success) return request_

    const placeholder = await request<{ id: string }>(
      "/chat/chat-messages",
      "POST",
      { chatId: data.chatId, text: "CORE sedang mengerjakannya…", status: "PENDING", role: "ASSISTANT" },
      {},
      true,
      tokens
    )
    if (!placeholder.success || !placeholder.data) return placeholder

    const messageId = placeholder.data.id
    const dispatched = await requestAi(
      "/learning/chat/action",
      "POST",
      {
        chatId: data.chatId,
        userStepId: data.userStepId,
        userId: data.userId,
        messageId,
        action: data.action,
      },
      { "Idempotency-Key": crypto.randomUUID() },
      true,
      tokens
    )
    if (!dispatched.success) {
      await request(`/chat/chat-messages/${messageId}`, "DELETE", undefined, {}, true, tokens)
      return dispatched
    }
    return placeholder
  },

  async update(
    id: string,
    data: Partial<{
      text: string | null
      role: string
      status: string
    }>,
    tokens?: Tokens
  ) {
    return request(
      `/chat/chat-messages/${id}`,
      "PATCH",
      data,
      {},
      true,
      tokens
    )
  },

  listenChatMessages(tokens?: Tokens) {
    return new EventSource(apiUrl("/chat-message-sse"), {
      withCredentials: true
    })
  },

  async delete(id: string, tokens?: Tokens) {
    return request(
      `/chat/chat-messages/${id}`,
      "DELETE",
      undefined,
      {},
      true,
      tokens
    )
  }
}
