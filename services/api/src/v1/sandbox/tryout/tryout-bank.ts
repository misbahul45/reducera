import { z } from 'zod';

const McqSchema = z
  .object({
    stem: z.string().min(1),
    options: z.array(z.string().min(1)).min(4).max(5),
    answer: z.number().int().min(0),
    explanation: z.string().min(1),
  })
  .refine((item) => item.answer < item.options.length, { message: 'answer is outside the options' })
  .refine((item) => new Set(item.options).size === item.options.length, { message: 'options must be distinct' });

const AuthoredSchema = McqSchema.and(z.object({ section: z.string().min(1), conceptId: z.string().min(1) }));

const PpuSchema = McqSchema.and(z.object({ section: z.string().min(1) }));

const PassageQuestionSchema = McqSchema.and(z.object({ conceptId: z.string().min(1) }));

const PassageSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,60}$/),
  title: z.string().min(1),
  text: z.string().min(80),
  questions: z.array(PassageQuestionSchema).min(2),
});

const BankSchema = z.object({
  version: z.literal(1),
  ppu: z.array(PpuSchema).min(1),
  pbm: z.object({
    authored: z.array(AuthoredSchema).min(1),
    bakuPairs: z.array(z.object({ baku: z.string().min(1), tidakBaku: z.string().min(1) })).min(6),
  }),
  passages: z.object({
    'literasi-indonesia': z.array(PassageSchema).min(1),
    'literasi-inggris': z.array(PassageSchema).min(1),
  }),
});

export type TryoutBank = z.infer<typeof BankSchema>;
export type AuthoredItem = z.infer<typeof AuthoredSchema>;
export type BankPassage = z.infer<typeof PassageSchema>;

export const PPU_CONCEPT = 'utbk-leksikal';
export const BAKU_CONCEPT = 'utbk-pbm-perbaikan-gagasan';

export const buildTryoutBank = (raw: unknown): TryoutBank => {
  const bank = BankSchema.parse(raw);
  const ids = Object.values(bank.passages).flatMap((passages) => passages.map((passage) => passage.id));
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate passage ids in the tryout bank');
  const pairWords = bank.pbm.bakuPairs.flatMap((pair) => [pair.baku, pair.tidakBaku]);
  if (new Set(pairWords).size !== pairWords.length) throw new Error('A word appears twice in the baku pairs');
  return bank;
};

export const passageCapacity = (passages: readonly BankPassage[]): number => passages.reduce((sum, passage) => sum + passage.questions.length, 0);
