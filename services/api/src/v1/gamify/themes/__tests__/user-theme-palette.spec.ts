import { HEX_REGEX, themeSchemePairSchema } from '../theme.schema';
import { contrastRatio, validateForPublish } from '../theme-validator';
import {
  GENERATOR_VERSION,
  USER_THEME_MAX_MOODS,
  USER_THEME_MOODS,
  UserThemeMood,
  generateUserTheme,
  normalizeMoods,
} from '../user-theme-palette';

const hueOf = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
};

const hueGap = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

const luminanceOf = (hex: string): number => contrastRatio(hex, '#000000');

const combinations = (): UserThemeMood[][] => {
  const out: UserThemeMood[][] = [];
  const pick = (start: number, chosen: UserThemeMood[]) => {
    if (chosen.length > 0) out.push([...chosen]);
    if (chosen.length === USER_THEME_MAX_MOODS) return;
    for (let i = start; i < USER_THEME_MOODS.length; i += 1) pick(i + 1, [...chosen, USER_THEME_MOODS[i]]);
  };
  pick(0, []);
  return out;
};

const INTENSITIES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('normalizeMoods', () => {
  it('sorts by the fixed vocabulary order and drops repeats', () => {
    expect(normalizeMoods(['playful', 'calm', 'playful'])).toEqual(['calm', 'playful']);
  });

  it('refuses an empty list and more than the limit', () => {
    expect(() => normalizeMoods([])).toThrow(RangeError);
    expect(() => normalizeMoods(['calm', 'playful', 'serious', 'natural'])).toThrow(RangeError);
  });
});

describe('generateUserTheme', () => {
  it('passes every contrast pair for every mood combination and intensity the API accepts', () => {
    const failures: string[] = [];
    const sets = combinations();

    for (const mood of sets) {
      for (const intensity of INTENSITIES) {
        const theme = generateUserTheme({ mood, intensity });
        const issues = validateForPublish({ tokens: theme.tokens, atmosphere: theme.atmosphere });
        if (issues.length > 0) {
          failures.push(`${mood.join('+')}@${intensity}: ${issues.map((issue) => `${issue.pair.join('/')}=${issue.ratio.toFixed(2)}`).join(' ')}`);
        }
      }
    }

    expect(sets).toHaveLength(8 + 28 + 56);
    expect(failures).toEqual([]);
  });

  it('writes valid hex for every token and satisfies the stored schema', () => {
    for (const mood of combinations()) {
      const theme = generateUserTheme({ mood, intensity: 50 });
      expect(() => themeSchemePairSchema.parse(theme.tokens)).not.toThrow();
      for (const scheme of ['light', 'dark'] as const) {
        for (const value of Object.values(theme.tokens[scheme])) expect(value).toMatch(HEX_REGEX);
      }
    }
  });

  it('gives the primary and secondary colors a darker depth edge in both schemes', () => {
    const theme = generateUserTheme({ mood: ['calm'], intensity: 50 });

    for (const scheme of ['light', 'dark'] as const) {
      const tokens = theme.tokens[scheme];
      expect(tokens.primaryDepth).toBeDefined();
      expect(tokens.secondaryDepth).toBeDefined();
      expect(luminanceOf(tokens.primaryDepth as string)).toBeLessThan(luminanceOf(tokens.primary));
      expect(luminanceOf(tokens.secondaryDepth as string)).toBeLessThan(luminanceOf(tokens.secondary));
    }
  });

  it('leaves the semantic colors to the default theme', () => {
    const theme = generateUserTheme({ mood: ['playful'], intensity: 50 });

    for (const scheme of ['light', 'dark'] as const) {
      for (const key of ['success', 'danger', 'warning', 'info', 'gold', 'flame', 'dangerDepth', 'goldDepth'] as const) {
        expect(theme.tokens[scheme][key]).toBeUndefined();
      }
    }
  });

  it('is deterministic and does not depend on the order of the moods', () => {
    const a = generateUserTheme({ mood: ['calm', 'playful'], intensity: 40 });
    const b = generateUserTheme({ mood: ['playful', 'calm'], intensity: 40 });
    const again = generateUserTheme({ mood: ['calm', 'playful'], intensity: 40 });

    expect(b).toEqual(a);
    expect(again).toEqual(a);
    expect(a.mood).toEqual(['calm', 'playful']);
  });

  it('blends hues around the color wheel, not by arithmetic mean', () => {
    const theme = generateUserTheme({ mood: ['energetic', 'playful'], intensity: 50 });

    expect(hueGap(hueOf(theme.tokens.light.primary), 355)).toBeLessThanOrEqual(4);
  });

  it('follows the mood of a single entry', () => {
    expect(hueGap(hueOf(generateUserTheme({ mood: ['calm'], intensity: 50 }).tokens.light.primary), 200)).toBeLessThanOrEqual(4);
    expect(hueGap(hueOf(generateUserTheme({ mood: ['natural'], intensity: 50 }).tokens.light.primary), 130)).toBeLessThanOrEqual(4);
  });

  it('changes color strength and atmosphere with the intensity', () => {
    const quiet = generateUserTheme({ mood: ['calm'], intensity: 0 });
    const loud = generateUserTheme({ mood: ['calm'], intensity: 100 });

    expect(quiet.tokens.light.primary).not.toBe(loud.tokens.light.primary);
    expect(quiet.atmosphere.motion?.intensity).toBeLessThan(loud.atmosphere.motion?.intensity as number);
    expect(loud.atmosphere.particles?.density).toBeLessThanOrEqual(0.6);
  });

  it('keeps the exam variant calm', () => {
    const theme = generateUserTheme({ mood: ['energetic'], intensity: 100 });

    expect(theme.variants.EXAM?.atmosphere?.particles?.enabled).toBe(false);
    expect(theme.variants.EXAM?.atmosphere?.motion?.intensity).toBe(0);
  });

  it('names the theme with a safe slug and carries the generator version', () => {
    const theme = generateUserTheme({ mood: ['serious'], intensity: 50 });

    expect(theme.slug).toMatch(/^[a-z0-9-]+$/);
    expect(theme.isDefault).toBe(false);
    expect(theme.version).toBe(GENERATOR_VERSION);
    expect(theme.primary).toBe(theme.tokens.light.primary);
  });

  it('refuses an intensity outside 0 to 100 and one that is not whole', () => {
    expect(() => generateUserTheme({ mood: ['calm'], intensity: -1 })).toThrow(RangeError);
    expect(() => generateUserTheme({ mood: ['calm'], intensity: 101 })).toThrow(RangeError);
    expect(() => generateUserTheme({ mood: ['calm'], intensity: 50.5 })).toThrow(RangeError);
  });
});
