import type { ApiResponse } from '~/interfaces/api';
import { request } from '~/lib/api';
import { unwrap } from '~/lib/api-error';
import { parseUserThemeView, type UserThemeView } from '~/lib/user-theme';

export interface ThemeChoice {
  mood: ReadonlyArray<string>;
  intensity: number;
}

const body = (choice: ThemeChoice) => ({ mood: [...choice.mood], intensity: choice.intensity });

const view = (promise: Promise<ApiResponse<unknown>>): Promise<UserThemeView> => promise.then((res) => parseUserThemeView(unwrap(res)));

export const themeService = {
  mine: () => view(request<unknown>('/gamify/me/theme')),
  preview: (choice: ThemeChoice) => view(request<unknown>('/gamify/me/theme/preview', 'POST', body(choice))),
  save: (choice: ThemeChoice) => view(request<unknown>('/gamify/me/theme', 'PUT', body(choice))),
  reset: () => view(request<unknown>('/gamify/me/theme', 'DELETE')),
};
