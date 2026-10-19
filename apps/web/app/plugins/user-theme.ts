import { watch } from 'vue';
import type { User } from '~/interfaces/auth';

export default defineNuxtPlugin(async () => {
  const user = useState<User | null>('user', () => null);
  const { state, load, clear } = useUserTheme();

  if (user.value && state.value === null) await load();

  if (import.meta.client) {
    watch(
      () => user.value?.id ?? null,
      (id, previous) => {
        if (id === previous) return;
        clear();
        if (id) void load();
      },
    );
  }
});
