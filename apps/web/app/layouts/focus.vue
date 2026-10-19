<script setup lang="ts">
import type { User } from '~/interfaces/auth';
import CoreAvatar from '~/components/my-learning/CoreAvatar.vue';
import { useGamifyMe } from '~/composables/useGamify';
import { useHydrated } from '~/composables/useHydrated';
import { useLearning } from '~/stores/learning';

const props = defineProps<{ wide?: boolean }>();
const user = useState<User | null>('user');
const { dock, available, toggle } = useChatDock();
const learning = useLearning();
const hydrated = useHydrated();
const { data: me } = useGamifyMe();

const exitTo = computed(() =>
  hydrated.value && learning.topicSlug ? `/my-learning/topics/${learning.topicSlug}` : '/learn/profile/my-learning',
);
</script>

<template>
  <div class="rc-focus" :class="{ 'rc-focus--docked': dock.open, 'rc-focus--docked-wide': dock.open && dock.wide }">
    <SkipLink />
    <header class="rc-focus__bar">
      <NuxtLink :to="exitTo" class="rc-focus__exit" aria-label="Keluar dari mode belajar">
        <UIcon name="i-lucide-x" aria-hidden="true" />
        <span>Keluar</span>
      </NuxtLink>
      <div class="rc-focus__end">
        <PlayButton
          v-if="available"
          variant="outline"
          size="sm"
          class="rc-focus__ask"
          aria-controls="rc-chat-dock"
          :aria-expanded="dock.open"
          @click="toggle"
        >
          <CoreAvatar size="sm" />
          <span class="rc-focus__asklabel">{{ dock.open ? 'Tutup CORE' : 'Tanya CORE' }}</span>
        </PlayButton>
        <div v-if="user && hydrated && me" class="rc-focus__stats">
          <StatPill icon="streak" :value="me.streak.current" label="Streak" tone="flame" />
          <StatPill icon="xp" :value="me.xp" label="XP" tone="gold" />
        </div>
      </div>
    </header>
    <div class="rc-focus__body">
      <main id="main" class="rc-focus__main" :class="{ 'rc-focus__main--wide': props.wide }">
        <slot />
      </main>
    </div>
  </div>
</template>
