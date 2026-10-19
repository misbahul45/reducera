import { ThemeAtmosphere, ThemeTokens } from './theme.schema';
import { MOOD_HUE_BASE, Mood, ThemeProposal, ThemeProposerService } from './theme-proposer.service';
import { ContrastIssue, contrastRatio, validateThemeTokens } from './theme-validator';

export const USER_THEME_MOODS = ['calm', 'energetic', 'analytical', 'welcoming', 'playful', 'serious', 'mysterious', 'natural'] as const satisfies ReadonlyArray<Mood>;

export type UserThemeMood = (typeof USER_THEME_MOODS)[number];

export const USER_THEME_MAX_MOODS = 3;
export const USER_THEME_MAX_INTENSITY = 100;
export const GENERATOR_VERSION = 1;

export interface UserThemeInput {
  mood: ReadonlyArray<UserThemeMood>;
  intensity: number;
}

export interface GeneratedUserTheme {
  slug: string;
  title: string;
  primary: string;
  secondary: string;
  tertiary: string;
  quaternary: string;
  mood: UserThemeMood[];
  tokens: { light: ThemeTokens; dark: ThemeTokens };
  atmosphere: ThemeAtmosphere;
  variants: ThemeProposal['variants'];
  isDefault: false;
  version: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

type Palette = Record<string, Hsl>;

const SLUG = 'user-theme';
const TITLE = 'Tema saya';
const SAND_HUE = 40;
const ACCENT_TURN = 30;
const NUDGE_STEP = 0.02;
const NUDGE_LIMIT = 80;
const DEPTH_DROP = 0.12;

const proposer = new ThemeProposerService();

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function normalizeMoods(mood: ReadonlyArray<UserThemeMood>): UserThemeMood[] {
  const unique = USER_THEME_MOODS.filter((entry) => mood.includes(entry));
  if (unique.length === 0 || unique.length > USER_THEME_MAX_MOODS) {
    throw new RangeError(`Choose between 1 and ${USER_THEME_MAX_MOODS} different moods`);
  }
  return unique;
}

const blendHue = (mood: ReadonlyArray<UserThemeMood>): number => {
  const radians = mood.map((entry) => (MOOD_HUE_BASE[entry] * Math.PI) / 180);
  const x = radians.reduce((sum, angle) => sum + Math.cos(angle), 0);
  const y = radians.reduce((sum, angle) => sum + Math.sin(angle), 0);
  if (Math.hypot(x, y) < 1e-6) return MOOD_HUE_BASE[mood[0]];
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
};

const hslToHex = ({ h, s, l }: Hsl): string => {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * clamp(l, 0, 1) - 1)) * clamp(s, 0, 1);
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = clamp(l, 0, 1) - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

const hsl = (h: number, s: number, l: number): Hsl => ({ h, s, l });

const lightPalette = (hue: number, accent: number, strength: number): Palette => {
  const lightness = 0.26 + 0.04 * strength;
  return {
    bg: hsl(hue, 0.3, 0.97),
    surface: hsl(hue, 0.2, 1),
    fg: hsl(hue, 0.4, 0.1),
    muted: hsl(hue, 0.2, 0.3),
    border: hsl(hue, 0.3, 0.75),
    borderStrong: hsl(hue, 0.3, 0.45),
    primary: hsl(hue, 0.5 + 0.35 * strength, lightness),
    primaryFg: hsl(hue, 0.2, 0.98),
    secondary: hsl(accent, 0.45 + 0.3 * strength, lightness),
    secondaryFg: hsl(accent, 0.2, 0.98),
    accent: hsl(accent, 0.3 + 0.25 * strength, 0.3),
    focus: hsl(hue, 0.7, 0.25),
    foam: hsl(hue, 0.3, 0.92),
    sand: hsl(SAND_HUE, 0.5, 0.85),
  };
};

const darkPalette = (hue: number, accent: number, strength: number): Palette => ({
  bg: hsl(hue, 0.5, 0.1),
  surface: hsl(hue, 0.45, 0.14),
  fg: hsl(hue, 0.3, 0.95),
  muted: hsl(hue, 0.25, 0.7),
  border: hsl(hue, 0.4, 0.3),
  borderStrong: hsl(hue, 0.4, 0.55),
  primary: hsl(hue, 0.45 + 0.35 * strength, 0.65),
  primaryFg: hsl(hue, 0.4, 0.08),
  secondary: hsl(accent, 0.45 + 0.3 * strength, 0.65),
  secondaryFg: hsl(accent, 0.4, 0.05),
  accent: hsl(accent, 0.45 + 0.2 * strength, 0.75),
  focus: hsl(hue, 0.7, 0.65),
  foam: hsl(hue, 0.4, 0.25),
  sand: hsl(SAND_HUE, 0.4, 0.3),
});

const tokensOf = (palette: Palette): ThemeTokens =>
  Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, hslToHex(color)])) as unknown as ThemeTokens;

const luminanceOf = (color: Hsl): number => contrastRatio(hslToHex(color), '#000000');

const shift = (color: Hsl, delta: number): boolean => {
  const next = clamp(color.l + delta, 0, 1);
  if (next === color.l) return false;
  color.l = next;
  return true;
};

const nudge = (palette: Palette, issues: ReadonlyArray<ContrastIssue>): void => {
  for (const { pair } of issues) {
    const [front, back] = [palette[pair[0]], palette[pair[1]]];
    const lighten = luminanceOf(front) > luminanceOf(back);
    if (!shift(front, lighten ? NUDGE_STEP : -NUDGE_STEP)) shift(back, lighten ? -NUDGE_STEP : NUDGE_STEP);
  }
};

const readable = (palette: Palette): ThemeTokens => {
  for (let attempt = 0; attempt < NUDGE_LIMIT; attempt += 1) {
    const issues = validateThemeTokens(tokensOf(palette));
    if (issues.length === 0) return tokensOf(palette);
    nudge(palette, issues);
  }
  throw new Error('Could not reach the contrast rules for this palette');
};

const withDepth = (palette: Palette): ThemeTokens => {
  const tokens = readable(palette);
  const depthOf = (color: Hsl) => hslToHex({ ...color, l: Math.max(0, color.l - DEPTH_DROP) });
  return { ...tokens, primaryDepth: depthOf(palette.primary), secondaryDepth: depthOf(palette.secondary) };
};

export interface UserThemeParts {
  mood: UserThemeMood[];
  tokens: { light: ThemeTokens; dark: ThemeTokens };
  atmosphere: ThemeAtmosphere;
  variants: ThemeProposal['variants'];
  version: number;
}

export const assembleUserTheme = (parts: UserThemeParts): GeneratedUserTheme => ({
  slug: SLUG,
  title: TITLE,
  primary: parts.tokens.light.primary,
  secondary: parts.tokens.light.secondary,
  tertiary: parts.tokens.light.accent,
  quaternary: parts.tokens.light.foam,
  mood: parts.mood,
  tokens: parts.tokens,
  atmosphere: parts.atmosphere,
  variants: parts.variants,
  isDefault: false,
  version: parts.version,
});

export function generateUserTheme(input: UserThemeInput): GeneratedUserTheme {
  if (!Number.isInteger(input.intensity) || input.intensity < 0 || input.intensity > USER_THEME_MAX_INTENSITY) {
    throw new RangeError(`Intensity is a whole number from 0 to ${USER_THEME_MAX_INTENSITY}`);
  }
  const mood = normalizeMoods(input.mood);
  const strength = input.intensity / USER_THEME_MAX_INTENSITY;
  const hue = blendHue(mood);
  const accent = (hue + ACCENT_TURN) % 360;

  const light = withDepth(lightPalette(hue, accent, strength));
  const dark = withDepth(darkPalette(hue, accent, strength));
  const atmosphere = proposer.propose({ name: SLUG, mood, intensity: strength });

  return assembleUserTheme({
    mood,
    tokens: { light, dark },
    atmosphere: atmosphere.atmosphere,
    variants: atmosphere.variants,
    version: GENERATOR_VERSION,
  });
}
