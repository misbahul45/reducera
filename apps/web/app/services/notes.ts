import type { Query, Tokens } from "~/interfaces/api"
import type { NoteView } from "~/lib/notes"
import { request, toQueryString } from "~/lib/api"

export interface NotesPage {
  data: NoteView[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export const noteService = {
  async list(q: Query = {}, tokens?: Tokens) {
    const queryString = toQueryString(q)
    return request<NotesPage>(queryString ? `/notes?${queryString}` : "/notes", "GET", undefined, {}, true, tokens)
  },

  async create(
    values: { title: string; body: string; userStepId?: string; chatMessageId?: string; source?: "MANUAL" | "CHAT" },
    tokens?: Tokens
  ) {
    return request<NoteView & { duplicate: boolean }>("/notes", "POST", values, {}, true, tokens)
  },

  async update(id: string, values: { title?: string; body?: string }, tokens?: Tokens) {
    return request<NoteView>(`/notes/${id}`, "PATCH", values, {}, true, tokens)
  },

  async remove(id: string, tokens?: Tokens) {
    return request<null>(`/notes/${id}`, "DELETE", undefined, {}, true, tokens)
  },
}
