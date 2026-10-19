<script setup lang="ts">
import BannerTopics from '~/components/topics/BannerTopics.vue';
import MappingCategories from '~/components/topics/MappingCategories.vue';
import MappingTopics from '~/components/topics/MappingTopics.vue';

const siteUrl = useRuntimeConfig().public.SITE_URL

const router = useRouter();
const route = useRoute();

const category = computed<string | null>({
  get: () => (typeof route.query.kategori === 'string' && route.query.kategori.trim() ? route.query.kategori : null),
  set: (value) => {
    const { kategori: _removed, ...rest } = route.query;
    router.replace({ query: value ? { ...rest, kategori: value } : rest });
  },
});

useHead({
  title: 'Courses | ReduCera',
  meta: [
    {
      name: 'description',
      content:
        'Jelajahi course pembelajaran ReduCera — modul microlearning berbasis AI dan gamifikasi yang dirancang untuk membantu mahasiswa mempersiapkan penguasaan kompetensi secara terstruktur.',
    },
    {
      name: 'keywords',
      content:
        'ReduCera, penguasaan kompetensi, perguruan tinggi, microlearning, AI learning, gamifikasi, RAG, pembelajaran adaptif',
    },
    { property: 'og:title', content: 'Courses | ReduCera' },
    {
      property: 'og:description',
      content:
        'Temukan materi pembelajaran ReduCera yang membantu mahasiswa mempersiapkan penguasaan kompetensi dengan pendekatan microlearning dan AI Agent Learning.',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: `${siteUrl}/learn/topics` },
    { property: 'og:image', content: '/meta/og-topics.png' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: 'Courses | ReduCera' },
    {
      name: 'twitter:description',
      content:
        'Pelajari course ReduCera — konten microlearning berbasis AI untuk persiapan penguasaan kompetensi di perguruan tinggi.',
    },
    { name: 'twitter:image', content: '/meta/og-topics.png' },
  ],
  link: [{ rel: 'icon', type: 'image/png', href: '/favicon-32x32.png' }],
})

</script>

<template>
  <div class="rc-stack rc-topics-page">
    <PageHeader title="Courses" subtitle="Pilih course, kerjakan penilaiannya, dan kumpulkan bukti belajarmu." />
    <BannerTopics />
    <MappingCategories v-model="category" />
    <MappingTopics :category="category" />
  </div>
</template>
