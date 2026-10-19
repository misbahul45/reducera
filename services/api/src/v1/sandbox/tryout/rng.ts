export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  sample<T>(items: readonly T[], count: number): T[];
  chance(probability: number): boolean;
}

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const createRng = (seed: number): Rng => {
  const next = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    shuffle,
    sample: (items, count) => shuffle(items).slice(0, count),
    chance: (probability) => next() < probability,
  };
};

export const deriveSeed = (seed: number, salt: string): number => {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < salt.length; i += 1) {
    hash = Math.imul(hash ^ salt.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
};
