<script setup lang="ts">
import PlayCard from '~/components/play/PlayCard.vue';
import type { RewardLine } from '~/lib/gamify';

withDefaults(defineProps<{ lines: ReadonlyArray<RewardLine>; headingId?: string }>(), { headingId: 'reward-summary' });
</script>

<template>
  <PlayCard v-if="lines.length > 0" as="section" tone="gold" :aria-labelledby="headingId">
    <h2 :id="headingId" class="rc-h2">Hadiah</h2>
    <ul class="rc-rewards">
      <li v-for="line in lines" :key="line.text" class="rc-rewards__line">
        <GameIcon :name="line.icon" :size="32" decorative />
        <span>{{ line.text }}</span>
      </li>
    </ul>
  </PlayCard>
</template>
