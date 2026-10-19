<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue';

definePageMeta({
  title: 'Metrik belajar — ReduCera Admin',
  protection: { kind: 'role', role: 'ADMIN' },
  layout: 'admin',
});

useHead({ title: 'Metrik belajar — ReduCera Admin' });
</script>

<template>
  <div class="rc-stack">
    <PageHeader
      title="Metrik belajar"
      subtitle="Bukti sirkularitas yang bisa diaudit: perubahan penguasaan, hasil ulasan, pemakaian ulang pengetahuan, konversi ke kreator, dan bukti perbaikan prompt."
    />
    <AdminCircularityPanel />
  </div>
</template>
