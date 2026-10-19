import { computed } from 'vue';
import type { User } from '~/interfaces/auth';
import type { UserThemeView } from '~/lib/user-theme';
import { themeService } from '~/services/theme';

export function useUserTheme() {
  const state = useState<UserThemeView | null>('rc-user-theme', () => null);
  const user = useState<User | null>('user', () => null);

  const theme = computed(() => (user.value ? (state.value?.theme ?? null) : null));

  async function load() {
    try {
      state.value = await themeService.mine();
    } catch {
      state.value = null;
    }
  }

  function apply(view: UserThemeView) {
    state.value = view;
  }

  function clear() {
    state.value = null;
  }

  return { state, theme, load, apply, clear };
}
