import type { ChatAttachment } from "~/interfaces/chats/chatAttachment"
import type { ApiResponse } from "~/interfaces/api"
import { ApiError, isApiError, toApiError, unwrap } from "~/lib/api-error"
import { apiUrl, failureEnvelope, request } from "~/lib/api"
import { authService } from "~/services/auth"

const UPLOAD_FAILED = "Gambar belum terunggah. Pastikan gambarnya PNG, JPEG, WebP, atau GIF di bawah 4 MB, lalu coba lagi."

async function send(chatId: string, form: FormData) {
  return await $fetch<ApiResponse<ChatAttachment>>(apiUrl(`/chat/chat-attachments?chatId=${encodeURIComponent(chatId)}`), {
    method: "POST",
    body: form,
    credentials: "include",
  })
}

export const chatAttachmentService = {
  async upload(chatId: string, file: File): Promise<ChatAttachment> {
    const form = new FormData()
    form.append("file", file, file.name)
    try {
      let response: ApiResponse<ChatAttachment>
      try {
        response = await send(chatId, form)
      } catch (error: any) {
        const status = error?.statusCode ?? error?.status ?? error?.response?.status
        if (status !== 401) throw error
        const refreshed = await authService.refreshToken()
        if (!refreshed.success) throw error
        response = await send(chatId, form)
      }
      const uploaded = unwrap(response)
      if (!uploaded) throw toApiError(failureEnvelope({ data: { message: "Upload gagal" } }))
      return uploaded
    } catch (error) {
      const failure = isApiError(error) ? error : toApiError(failureEnvelope(error))
      throw new ApiError({ message: UPLOAD_FAILED, status: failure.status, code: failure.code, requestId: failure.requestId })
    }
  },

  async remove(id: string) {
    return request(`/chat/chat-attachments/${encodeURIComponent(id)}`, "DELETE")
  },
}
