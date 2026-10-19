<script setup lang="ts">
import MarketplaceCard from '~/components/marketplace/MarketplaceCard.vue';
import PlayScroller from '~/components/play/PlayScroller.vue';
import type { User } from '~/interfaces/auth';
import { marketplaceApi } from '~/lib/api';
import { recommendationCard } from '~/lib/marketplace';

const user = useState<User | null>('user');
const signedIn = computed(() => Boolean(user.value?.id));

const { data } = useAsyncData(
  () => `marketplace-recommendations:${user.value?.id ?? 'guest'}`,
  async () => {
    if (!user.value?.id) return { personalized: false, cards: [] };
    const result = await marketplaceApi.recommendations(8);
    return { personalized: result.recommendations.some((item) => item.personalized), cards: result.recommendations.map(recommendationCard) };
  },
  { lazy: true, server: false, watch: [signedIn] },
);

const cards = computed(() => data.value?.cards ?? []);
const heading = computed(() => (data.value?.personalized ? 'Disarankan untukmu' : 'Terbaru di marketplace'));
</script>

<template>
  <section v-if="signedIn && cards.length > 0" class="rc-stack" aria-labelledby="recommended-h">
    <h2 id="recommended-h" class="rc-h2">{{ heading }}</h2>
    <PlayScroller label="Produk yang disarankan">
      <ul class="rc-mrail">
        <li v-for="card in cards" :key="`${card.kind}-${card.id}`">
          <MarketplaceCard :card="card" />
        </li>
      </ul>
    </PlayScroller>
  </section>
</template>
