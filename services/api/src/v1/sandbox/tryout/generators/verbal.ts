import { Rng } from '../rng';
import { BAKU_CONCEPT, BankPassage, PPU_CONCEPT, TryoutBank, passageCapacity } from '../tryout-bank';
import { ItemDraft, SubtestKey } from '../tryout-types';

interface Mcq {
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
}

const shuffled = (rng: Rng, item: Mcq): Pick<ItemDraft, 'options' | 'answer'> => {
  const correct = item.options[item.answer];
  const options = rng.shuffle(item.options);
  return { options, answer: options.indexOf(correct) };
};

export const ppuCapacity = (bank: TryoutBank): number => bank.ppu.length;

export const pbmCapacity = (bank: TryoutBank): number => bank.pbm.authored.length + bank.pbm.bakuPairs.length * 2;

export const literacyCapacity = (bank: TryoutBank, key: 'literasi-indonesia' | 'literasi-inggris'): number => passageCapacity(bank.passages[key]);

export const generatePpu = (rng: Rng, bank: TryoutBank, count: number): ItemDraft[] =>
  rng.sample(bank.ppu, count).map((item) => ({
    subtest: 'ppu',
    section: item.section,
    conceptId: PPU_CONCEPT,
    stem: item.stem,
    explanation: item.explanation,
    ...shuffled(rng, item),
  }));

const bakuItem = (rng: Rng, bank: TryoutBank, pairIndex: number, askBaku: boolean): ItemDraft => {
  const pairs = bank.pbm.bakuPairs;
  const pair = pairs[pairIndex];
  const others = rng.sample(
    pairs.filter((_, index) => index !== pairIndex),
    4,
  );
  const correct = askBaku ? pair.baku : pair.tidakBaku;
  const options = rng.shuffle([correct, ...others.map((other) => (askBaku ? other.tidakBaku : other.baku))]);
  return {
    subtest: 'pbm',
    section: 'Ejaan dan kata baku',
    conceptId: BAKU_CONCEPT,
    stem: askBaku ? 'Kata yang penulisannya baku adalah ...' : 'Kata yang penulisannya tidak baku adalah ...',
    options,
    answer: options.indexOf(correct),
    explanation: `Bentuk baku adalah “${pair.baku}”, bukan “${pair.tidakBaku}”.`,
  };
};

export const generatePbm = (rng: Rng, bank: TryoutBank, count: number): ItemDraft[] => {
  const authoredCount = Math.min(bank.pbm.authored.length, Math.ceil(count / 2));
  const authored: ItemDraft[] = rng.sample(bank.pbm.authored, authoredCount).map((item) => ({
    subtest: 'pbm',
    section: item.section,
    conceptId: item.conceptId,
    stem: item.stem,
    explanation: item.explanation,
    ...shuffled(rng, item),
  }));

  const bakuNeeded = count - authored.length;
  const pairOrder = rng.shuffle(bank.pbm.bakuPairs.map((_, index) => index));
  const baku: ItemDraft[] = [];
  for (let i = 0; i < bakuNeeded; i += 1) {
    const round = Math.floor(i / pairOrder.length);
    baku.push(bakuItem(rng, bank, pairOrder[i % pairOrder.length], (i + round) % 2 === 0));
  }
  return rng.shuffle([...authored, ...baku]);
};

export const generateLiteracy = (rng: Rng, bank: TryoutBank, key: Extract<SubtestKey, 'literasi-indonesia' | 'literasi-inggris'>, count: number): ItemDraft[] => {
  const items: ItemDraft[] = [];
  for (const passage of rng.shuffle<BankPassage>(bank.passages[key])) {
    for (const question of passage.questions) {
      if (items.length >= count) return items;
      items.push({
        subtest: key,
        section: passage.title,
        conceptId: question.conceptId,
        stem: question.stem,
        passage: { id: passage.id, title: passage.title, text: passage.text },
        explanation: question.explanation,
        ...shuffled(rng, question),
      });
    }
  }
  return items;
};
