import { z } from 'zod';

export const CITATION_KINDS = ['MATERIAL', 'WEB', 'TOPIC'] as const;
export const CITATION_REF_TYPES = ['RESOURCE', 'CONCEPT', 'TOPIC', 'SUBTOPIC'] as const;
export const CITATION_VIA = ['LEXICAL', 'SEMANTIC', 'WEB', 'SCOPE'] as const;
export const IMPROVE_INSTRUCTIONS = ['SIMPLIFY', 'EXAMPLE', 'DEEPEN', 'SHORTEN'] as const;

const httpUrl = z
  .string()
  .max(500)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), { message: 'Only http and https links are allowed' });

export const ChatCitationSchema = z
  .object({
    index: z.number().int().min(1).max(50),
    kind: z.enum(CITATION_KINDS),
    title: z.string().trim().min(1).max(200),
    url: httpUrl.optional(),
    snippet: z.string().trim().max(300).optional(),
    lessonId: z.string().max(64).optional(),
    refType: z.enum(CITATION_REF_TYPES).optional(),
    refId: z.string().max(64).optional(),
    via: z.array(z.enum(CITATION_VIA)).max(4).optional(),
  })
  .strict()
  .refine((value) => value.kind === 'WEB' || value.url === undefined, { message: 'Only a web source has a link' });
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const ChatActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUIZ'), count: z.number().int().min(3).max(10), focus: z.string().trim().max(200).optional() }).strict(),
  z
    .object({ type: z.literal('IMPROVE_MATERIAL'), instruction: z.enum(IMPROVE_INSTRUCTIONS), focus: z.string().trim().max(200).optional() })
    .strict(),
  z.object({ type: z.literal('NOTE'), title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('OPEN_QUIZ'), quizId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('OPEN_MATERIAL') }).strict(),
]);
export type ChatAction = z.infer<typeof ChatActionSchema>;

export const ChatCitationsSchema = z.array(ChatCitationSchema).max(20);
export const ChatActionsSchema = z.array(ChatActionSchema).max(4);
