import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(8000);

export const CreateNoteDto = z
  .object({
    title,
    body,
    userStepId: z.string().uuid().optional(),
    chatMessageId: z.string().uuid().optional(),
    source: z.enum(['MANUAL', 'CHAT']).default('MANUAL'),
  })
  .strict();
export type CreateNoteDtoType = z.infer<typeof CreateNoteDto>;

export const UpdateNoteDto = z
  .object({ title, body })
  .partial()
  .strict()
  .refine((value) => value.title !== undefined || value.body !== undefined, { message: 'Nothing to update' });
export type UpdateNoteDtoType = z.infer<typeof UpdateNoteDto>;

export const NoteListQueryDto = z
  .object({
    userStepId: z.string().uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type NoteListQueryDtoType = z.infer<typeof NoteListQueryDto>;
