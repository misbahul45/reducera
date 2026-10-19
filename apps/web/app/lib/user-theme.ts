import { normalizeTheme } from '~/theme/normalize';
import { shellBindings } from '~/theme/shell';
import type { ColorScheme, NormalizedTheme } from '~/theme/types';

export const MAX_MOODS = 3;
export const MAX_INTENSITY = 100;

export const THEME_MOODS = [
  { id: 'calm', label: 'Tenang' },
  { id: 'energetic', label: 'Berenergi' },
  { id: 'analytical', label: 'Analitis' },
  { id: 'welcoming', label: 'Ramah' },
  { id: 'playful', label: 'Ceria' },
  { id: 'serious', label: 'Serius' },
  { id: 'mysterious', label: 'Misterius' },
  { id: 'natural', label: 'Alami' },
] as const;

export type ThemeMoodId = (typeof THEME_MOODS)[number]['id'];

export interface ThemeDraft {
  mood: ReadonlyArray<string>;
  intensity: number;
}

export interface UserThemeView {
  custom: boolean;
  mood: ThemeMoodId[];
  intensity: number | null;
  theme: NormalizedTheme | null;
}

const NONE: UserThemeView = { custom: false, mood: [], intensity: null, theme: null };

const KNOWN: ReadonlyArray<string> = THEME_MOODS.map((mood) => mood.id);

const inOrder = (mood: ReadonlyArray<string>): ThemeMoodId[] => THEME_MOODS.filter((entry) => mood.includes(entry.id)).map((entry) => entry.id);

export function toggleMood(selected: ReadonlyArray<string>, mood: string): ThemeMoodId[] {
  const current = inOrder(selected);
  if (!KNOWN.includes(mood)) return current;
  if (current.includes(mood as ThemeMoodId)) return current.filter((entry) => entry !== mood);
  if (current.length >= MAX_MOODS) return current;
  return inOrder([...current, mood]);
}

export function draftProblem(draft: ThemeDraft): string | null {
  if (draft.mood.length === 0) return 'Pilih minimal satu suasana.';
  if (!Number.isInteger(draft.intensity) || draft.intensity < 0 || draft.intensity > MAX_INTENSITY) {
    return `Intensitas harus bilangan bulat 0 sampai ${MAX_INTENSITY}.`;
  }
  return null;
}

export function sameChoice(draft: ThemeDraft, saved: ThemeDraft | null): boolean {
  if (!saved || draft.intensity !== saved.intensity) return false;
  const [left, right] = [inOrder(draft.mood), inOrder(saved.mood)];
  return left.length === right.length && left.every((mood, index) => mood === right[index]);
}

export function intensityLabel(intensity: number): string {
  if (intensity < 34) return 'Lembut';
  if (intensity < 67) return 'Sedang';
  return 'Pekat';
}

export function parseUserThemeView(input: unknown): UserThemeView {
  if (!input || typeof input !== 'object') return NONE;
  const envelope = input as Record<string, unknown>;
  const root = envelope.data && typeof envelope.data === 'object' ? (envelope.data as Record<string, unknown>) : envelope;
  if (root.custom !== true) return NONE;

  const theme = normalizeTheme(root.theme);
  const mood = Array.isArray(root.mood) ? inOrder(root.mood.filter((entry): entry is string => typeof entry === 'string')) : [];
  if (!theme || mood.length === 0) return NONE;

  return { custom: true, mood, intensity: typeof root.intensity === 'number' ? root.intensity : null, theme };
}

export function previewStyle(theme: NormalizedTheme | null, scheme: ColorScheme): string {
  if (!theme) return '';
  return shellBindings({ chain: [theme], variant: 'LEARN', scheme, reducedMotion: false }).style;
}
