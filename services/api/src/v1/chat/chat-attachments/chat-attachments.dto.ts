import { z } from 'zod';

export const UploadAttachmentQueryDto = z.object({ chatId: z.string().uuid() }).strict();
export type UploadAttachmentQueryDtoType = z.infer<typeof UploadAttachmentQueryDto>;
