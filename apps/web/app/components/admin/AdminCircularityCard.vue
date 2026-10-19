<script setup lang="ts">
import PlayCard from '~/components/play/PlayCard.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import type { CircularityMetric } from '~/interfaces/admin';
import { METRIC_DEFINITIONS, progressOf, requirements, stateMeta, valueRows } from '~/lib/circularity';

const props = defineProps<{ metric: CircularityMetric; demoDomain: string }>();

const definition = computed(() => METRIC_DEFINITIONS[props.metric.id]);
const meta = computed(() => stateMeta(props.metric.state));
const needs = computed(() => requirements(props.metric));
const rows = computed(() => (props.metric.value ? valueRows(props.metric.id, props.metric.value as never) : []));
const demoRows = computed(() => (props.metric.demoValue ? valueRows(props.metric.id, props.metric.demoValue as never) : []));
const headingId = computed(() => `metric-${props.metric.id.toLowerCase()}`);
</script>

<template>
  <PlayCard as="article" :aria-labelledby="headingId" class="rc-metric">
    <header class="rc-metric__head">
      <h3 :id="headingId" class="rc-h2 rc-metric__title">{{ definition.title }}</h3>
      <StatusBadge :tone="meta.tone" :label="meta.label" />
    </header>
    <p class="rc-hint">{{ definition.question }}</p>

    <ul class="rc-metric__needs" aria-label="Bukti organik yang tersedia dibanding minimum">
      <li v-for="need in needs" :key="need.label">
        <span class="rc-metric__needlabel">{{ need.label }}</span>
        <span class="rc-metric__needcount">{{ need.have }} dari {{ need.need }}</span>
        <span class="rc-metric__bar" aria-hidden="true"><span class="rc-metric__fill" :style="{ width: `${Math.round(progressOf(need) * 100)}%` }" /></span>
      </li>
    </ul>

    <dl v-if="rows.length" class="rc-metric__values">
      <div v-for="row in rows" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.text }}</dd>
      </div>
    </dl>
    <p v-else class="rc-metric__empty" role="status">
      Belum cukup bukti organik, jadi angka tidak ditampilkan. Bukti akan dihitung setelah minimum di atas terpenuhi.
    </p>

    <section v-if="demoRows.length" class="rc-metric__demo" :aria-label="`Akun demo ${demoDomain}`">
      <h4 class="rc-metric__demohead">Akun demo (fixture), bukan hasil</h4>
      <p class="rc-hint">
        {{ metric.demo.n }} baris dari {{ metric.demo.learners }} akun berakhiran @{{ demoDomain }}. Ini hanya bukti bahwa jalurnya bekerja.
      </p>
      <dl class="rc-metric__values">
        <div v-for="row in demoRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.text }}</dd>
        </div>
      </dl>
    </section>

    <details class="rc-metric__details">
      <summary>Rumus, sumber, dan batasan</summary>
      <dl class="rc-metric__values">
        <div><dt>Rumus</dt><dd>{{ definition.formula }}</dd></div>
        <div><dt>Sumber data</dt><dd>{{ definition.sources }}</dd></div>
        <div><dt>Batasan</dt><dd>{{ definition.limits }}</dd></div>
      </dl>
    </details>
  </PlayCard>
</template>
