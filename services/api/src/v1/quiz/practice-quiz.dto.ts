import { z } from 'zod';
import { ChatCitationSchema } from '../chat/chat-message-extras';

const text = (max: number) => z.string().trim().min(1).max(max);

export const PracticeQuestionDto = z
  .object({
    question: text(600),
    options: z.array(text(240)).length(4),
    correctAnswer: text(240),
    distractors: z.record(z.string().max(240), z.string().max(60)).optional(),
    sources: z.array(ChatCitationSchema).max(4).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const lowered = value.options.map((option) => option.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must be different from each other' });
    }
    if (!value.options.includes(value.correctAnswer)) {
      ctx.addIssue({ code: 'custom', path: ['correctAnswer'], message: 'The correct answer must be one of the options' });
    }
  });

export const PracticeQuizDto = z
  .object({
    title: text(160),
    questions: z.array(PracticeQuestionDto).min(3).max(10),
  })
  .strict();
export type PracticeQuizDtoType = z.infer<typeof PracticeQuizDto>;
