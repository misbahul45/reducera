import { useQueryClient } from '@tanstack/vue-query';
import type { GamifyMe } from '~/interfaces/gamify';
import { rewardSummary, type RewardLine, type RewardSource } from '~/lib/gamify';
import { QK } from '~/lib/query-keys';

export function useRewardAnnouncement() {
  const client = useQueryClient();
  const toast = useToast();

  const levelNow = (): number | null => client.getQueryData<GamifyMe>(QK.gamify.me())?.level.level ?? null;

  async function announce(title: string, outcome: RewardSource | null | undefined): Promise<RewardLine[]> {
    const before = levelNow();
    await Promise.all([client.invalidateQueries({ queryKey: QK.gamify.me() }), client.invalidateQueries({ queryKey: QK.gamify.achievements() })]);
    const lines = rewardSummary(outcome, before, levelNow());
    if (lines.length > 0) {
      toast.add({ title, description: lines.map((line) => line.text).join(' · '), color: 'success', icon: 'i-lucide-party-popper' });
    }
    return lines;
  }

  return { announce };
}
