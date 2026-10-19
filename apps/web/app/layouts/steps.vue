<script setup lang="ts">
import { computed, ref } from 'vue'
import LessonStepPath from '~/components/my-learning/LessonStepPath.vue'
import type { User } from '~/interfaces/auth'

const user = useState<User | null>('user')
const lessonId = useLessonId()
const route = useRoute()

const sidebarOpen = ref(false)
const activeId = computed(() => (typeof route.params.userStepId === 'string' ? route.params.userStepId : null))
</script>

<template>
  <NuxtLayout name="focus" wide>
    <div class="rc-steps">
      <PlayButton
        variant="outline"
        size="sm"
        class="rc-steps__toggle"
        :aria-expanded="sidebarOpen"
        aria-controls="steps-list"
        @click="sidebarOpen = !sidebarOpen"
      >
        {{ sidebarOpen ? 'Tutup jalur langkah' : 'Jalur langkah' }}
      </PlayButton>

      <section v-if="sidebarOpen && user?.id && lessonId" id="steps-list" class="rc-steps__panel" aria-label="Jalur langkah">
        <LessonStepPath :lesson-id="lessonId" :user-id="user.id" :active-id="activeId" />
      </section>

      <div class="rc-steps__content">
        <slot />
      </div>
    </div>
  </NuxtLayout>
</template>

<style>
.rc-steps {
  display: grid;
  gap: 1rem;
  align-items: start;
}
.rc-steps__toggle {
  justify-self: start;
}
.rc-steps__panel {
  padding: 1rem;
  border: 2px solid var(--rc-border);
  border-radius: var(--rc-radius, 16px);
  background-color: var(--rc-surface);
}
.rc-steps__content {
  min-width: 0;
}
</style>
