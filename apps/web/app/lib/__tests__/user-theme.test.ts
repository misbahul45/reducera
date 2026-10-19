import { describe, expect, it } from 'vitest';
import {
  MAX_MOODS,
  THEME_MOODS,
  draftProblem,
  intensityLabel,
  parseUserThemeView,
  previewStyle,
  sameChoice,
  toggleMood,
} from '~/lib/user-theme';
import { DEFAULT_THEME } from '~/theme/default-theme';
import { shellRender } from '~/theme/shell';

const tokens = (primary: string, bg: string) => ({
  bg,
  surface: '#ffffff',
  fg: '#101010',
  muted: '#444444',
  border: '#cccccc',
  borderStrong: '#666666',
  primary,
  primaryFg: '#ffffff',
  secondary: '#223388',
  secondaryFg: '#ffffff',
  accent: '#553322',
  focus: '#112244',
  foam: '#eeeeee',
  sand: '#ddddaa',
  primaryDepth: '#111166',
  secondaryDepth: '#111155',
});

const payload = {
  custom: true,
  mood: ['calm', 'playful'],
  intensity: 60,
  theme: {
    slug: 'user-theme',
    title: 'Tema saya',
    primary: '#2244aa',
    secondary: '#223388',
    tertiary: '#553322',
    quaternary: '#eeeeee',
    mood: ['calm', 'playful'],
    tokens: { light: tokens('#2244aa', '#f5f5fa'), dark: tokens('#88aaff', '#101020') },
    atmosphere: { particles: { enabled: true, density: 0.3 }, motion: { intensity: 0.5 } },
    variants: {},
    isDefault: false,
    version: 1,
  },
};

describe('THEME_MOODS', () => {
  it('lists the eight moods of the server in its order, each with an Indonesian label', () => {
    expect(THEME_MOODS.map((mood) => mood.id)).toEqual(['calm', 'energetic', 'analytical', 'welcoming', 'playful', 'serious', 'mysterious', 'natural']);
    expect(new Set(THEME_MOODS.map((mood) => mood.label)).size).toBe(8);
    for (const mood of THEME_MOODS) expect(mood.label.length).toBeGreaterThan(3);
    expect(MAX_MOODS).toBe(3);
  });
});

describe('toggleMood', () => {
  it('adds a mood and keeps the list in the order of the vocabulary', () => {
    expect(toggleMood(['playful'], 'calm')).toEqual(['calm', 'playful']);
  });

  it('removes a mood that is already chosen', () => {
    expect(toggleMood(['calm', 'playful'], 'calm')).toEqual(['playful']);
  });

  it('does not add a fourth mood', () => {
    expect(toggleMood(['calm', 'playful', 'serious'], 'natural')).toEqual(['calm', 'playful', 'serious']);
  });

  it('ignores a mood the server does not know', () => {
    expect(toggleMood(['calm'], 'sleepy')).toEqual(['calm']);
  });
});

describe('draftProblem', () => {
  it('asks for at least one mood', () => {
    expect(draftProblem({ mood: [], intensity: 50 })).toBe('Pilih minimal satu suasana.');
  });

  it('accepts a choice the server accepts', () => {
    expect(draftProblem({ mood: ['calm'], intensity: 0 })).toBeNull();
    expect(draftProblem({ mood: ['calm', 'playful', 'serious'], intensity: 100 })).toBeNull();
  });

  it('refuses an intensity the server refuses', () => {
    for (const intensity of [-1, 101, 50.5, Number.NaN]) {
      expect(draftProblem({ mood: ['calm'], intensity })).toBe('Intensitas harus bilangan bulat 0 sampai 100.');
    }
  });
});

describe('sameChoice', () => {
  it('compares moods without regard to order, and the intensity', () => {
    const saved = { mood: ['calm', 'playful'], intensity: 60 };

    expect(sameChoice({ mood: ['playful', 'calm'], intensity: 60 }, saved)).toBe(true);
    expect(sameChoice({ mood: ['calm'], intensity: 60 }, saved)).toBe(false);
    expect(sameChoice({ mood: ['calm', 'playful'], intensity: 65 }, saved)).toBe(false);
  });

  it('is never the same as nothing saved', () => {
    expect(sameChoice({ mood: ['calm'], intensity: 50 }, null)).toBe(false);
  });
});

describe('intensityLabel', () => {
  it('names three bands', () => {
    expect([0, 33, 34, 66, 67, 100].map(intensityLabel)).toEqual(['Lembut', 'Lembut', 'Sedang', 'Sedang', 'Pekat', 'Pekat']);
  });
});

describe('parseUserThemeView', () => {
  it('reads a stored theme into the shape the resolver uses', () => {
    const view = parseUserThemeView({ success: true, data: payload });

    expect(view.custom).toBe(true);
    expect(view.mood).toEqual(['calm', 'playful']);
    expect(view.intensity).toBe(60);
    expect(view.theme?.slug).toBe('user-theme');
    expect(view.theme?.tokens.light.primary).toBe('#2244aa');
    expect(view.theme?.tokens.light.primaryDepth).toBe('#111166');
  });

  it('reads the answer for a learner without a custom theme', () => {
    expect(parseUserThemeView({ custom: false, mood: [], intensity: null, theme: null })).toEqual({ custom: false, mood: [], intensity: null, theme: null });
  });

  it('never throws on something else and says there is no custom theme', () => {
    for (const input of [null, undefined, 'x', 3, {}, { custom: true, theme: { slug: '' } }]) {
      expect(parseUserThemeView(input)).toEqual({ custom: false, mood: [], intensity: null, theme: null });
    }
  });

  it('drops moods the app does not know', () => {
    expect(parseUserThemeView({ ...payload, mood: ['calm', 'sleepy'] }).mood).toEqual(['calm']);
  });
});

describe('previewStyle', () => {
  const view = parseUserThemeView(payload);

  it('writes the variables of the chosen scheme only', () => {
    expect(previewStyle(view.theme, 'light')).toContain('--rc-primary: #2244aa');
    expect(previewStyle(view.theme, 'dark')).toContain('--rc-primary: #88aaff');
    expect(previewStyle(view.theme, 'dark')).not.toContain('#2244aa');
  });

  it('carries the depth edge of the buttons', () => {
    expect(previewStyle(view.theme, 'light')).toContain('--rc-primary-depth: #111166');
  });

  it('is empty without a theme, so the page keeps its own look', () => {
    expect(previewStyle(null, 'light')).toBe('');
  });
});

describe('the shell with a user theme first', () => {
  const view = parseUserThemeView(payload);
  const base = { variant: 'LEARN' as const, reducedMotion: false };

  it('wins over the default theme and names itself in the first HTML', () => {
    const render = shellRender({ ...base, chain: [view.theme, DEFAULT_THEME] });

    expect(render.attrs['data-rc-theme']).toBe('user-theme');
    expect(render.style).toContain('--rc-primary: #2244aa');
    expect(render.darkCss).toContain('.dark [data-rc-theme="user-theme"]');
    expect(render.darkCss).toContain('--rc-primary: #88aaff');
  });

  it('leaves the default theme in charge when the learner has no theme', () => {
    const render = shellRender({ ...base, chain: [null, DEFAULT_THEME] });

    expect(render.attrs['data-rc-theme']).toBe(DEFAULT_THEME.slug);
  });

  it('still turns the atmosphere off for reduced motion', () => {
    const render = shellRender({ ...base, reducedMotion: true, chain: [view.theme, DEFAULT_THEME] });

    expect(render.attrs['data-rc-motion']).toBe('off');
  });
});
