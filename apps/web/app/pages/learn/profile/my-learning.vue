<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { User } from '~/interfaces/auth';
import ReviewCard from '~/components/my-learning/ReviewCard.vue';
import { userTopicService } from '~/services/learning/userTopic';

definePageMeta({ title: 'Belajar Saya — ReduCera', protection: { kind: 'authenticated' } });
useHead({ title: 'Belajar Saya — ReduCera' });

const user = useState<User | null>('user');
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ['learn', 'my-topics', computed(() => user.value?.id ?? '')],
  enabled: computed(() => Boolean(user.value?.id)),
  queryFn: async () => {
    const res = await userTopicService.findAll<true>({ page: 1, limit: 50, userId: user.value?.id, include: 'topic' });
    return (res.data?.data ?? []).flatMap((row) => (row.topic ? [{ id: row.id, title: row.topic.title, slug: row.topic.slug, progress: row.progressPercent ?? 0, status: row.status }] : []));
  },
});
</script>

<template>
  <div>
    <PageHeader title="Belajar saya" subtitle="Course yang sedang dan sudah kamu ikuti." />

    <ReviewCard />

    <LoadingSkeleton v-if="isLoading" variant="card" :count="3" aria-label="Memuat course" />
    <ErrorState v-else-if="isError" title="Course-mu belum bisa dimuat" message="Periksa koneksimu lalu coba lagi." @retry="refetch()" />
    <EmptyState v-else-if="!data || data.length === 0" title="Belum ada course" message="Pilih course pertamamu dan mulai kumpulkan bukti belajar." icon-name="i-lucide-book-open" cta-label="Jelajahi course" cta-to="/learn/topics" />
    <div v-else class="rc-grid rc-grid--wide">
      <PlayCard v-for="topic in data" :key="topic.id" as="article" interactive>
        <h2 class="rc-h2" style="font-size: 1.125rem">{{ topic.title }}</h2>
        <PlayProgress :value="topic.progress" :label="`Kemajuan ${topic.title}`" show-value />
        <PlayButton :to="`/my-learning/topics/${topic.slug}`" variant="secondary" size="sm" block style="margin-top: 1rem">Lanjutkan</PlayButton>
      </PlayCard>
    </div>
  </div>
</template>
