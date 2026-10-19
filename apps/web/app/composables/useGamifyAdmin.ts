import { computed } from 'vue';
import type { GamifyAchievementsView, GamifyLadderView, GamifyRuleView } from '~/interfaces/admin';
import { adminService } from '~/services/admin';

const stateOf = (loaded: unknown, status: string): string => (loaded ? 'success' : status);

export function useGamifyRules() {
  const { data, status, error, refresh } = useAsyncData<GamifyRuleView[]>('admin:gamify:rules', () => adminService.gamify.rules(), { lazy: true });
  return { rules: computed(() => data.value ?? []), state: computed(() => stateOf(data.value, status.value)), error, refresh };
}

export function useGamifyLadder() {
  const { data, status, error, refresh } = useAsyncData<GamifyLadderView>('admin:gamify:levels', () => adminService.gamify.levels(), { lazy: true });
  return { ladder: computed(() => data.value ?? null), state: computed(() => stateOf(data.value, status.value)), error, refresh };
}

export function useGamifyAchievements() {
  const { data, status, error, refresh } = useAsyncData<GamifyAchievementsView>('admin:gamify:achievements', () => adminService.gamify.achievements(), {
    lazy: true,
  });
  return { view: computed(() => data.value ?? null), state: computed(() => stateOf(data.value, status.value)), error, refresh };
}
