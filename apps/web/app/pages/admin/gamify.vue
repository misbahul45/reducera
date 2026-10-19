<script setup lang="ts">
import GamifyAchievementsPanel from '~/components/admin/gamify/GamifyAchievementsPanel.vue';
import GamifyLevelsPanel from '~/components/admin/gamify/GamifyLevelsPanel.vue';
import GamifyRulesPanel from '~/components/admin/gamify/GamifyRulesPanel.vue';
import PageHeader from '~/components/play/PageHeader.vue';
import type { FilterDefs } from '~/lib/query-filters';

definePageMeta({
  title: 'Gamifikasi — ReduCera Admin',
  protection: { kind: 'role', role: 'ADMIN' },
  layout: 'admin',
});

useHead({ title: 'Gamifikasi — ReduCera Admin' });

const TABS = [
  { value: 'rules', label: 'Aturan hadiah' },
  { value: 'levels', label: 'Tangga level' },
  { value: 'achievements', label: 'Pencapaian' },
] as const;

const defs = {
  tab: { kind: 'enum', values: TABS.map((tab) => tab.value) },
} satisfies FilterDefs;

const { filters, set } = useQueryFilters(defs);
const tab = computed(() => (TABS.some((item) => item.value === filters.value.tab) ? String(filters.value.tab) : 'rules'));
</script>

<template>
  <div class="rc-stack">
    <PageHeader
      title="Gamifikasi"
      subtitle="Atur berapa XP dan bintang yang dibayar, tangga level, dan pencapaian. Setiap perubahan tercatat di audit dan tidak mengubah hadiah yang sudah dibayar."
    />

    <div class="rc-segment" role="group" aria-label="Bagian gamifikasi">
      <button v-for="item in TABS" :key="item.value" type="button" class="rc-segment__item" :aria-pressed="tab === item.value" @click="set({ tab: item.value })">
        {{ item.label }}
      </button>
    </div>

    <GamifyRulesPanel v-show="tab === 'rules'" />
    <GamifyLevelsPanel v-show="tab === 'levels'" />
    <GamifyAchievementsPanel v-show="tab === 'achievements'" />
  </div>
</template>
