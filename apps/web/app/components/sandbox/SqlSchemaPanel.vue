<script setup lang="ts">
import type { SqlDatasetInfo } from '~/interfaces/sandbox/sql'

defineProps<{ dataset: SqlDatasetInfo }>()
</script>

<template>
  <details class="rc-sbx-details rc-sql-schema">
    <summary>Skema basis data: {{ dataset.title }}</summary>
    <div>
      <p class="rc-hint">{{ dataset.description }} Setiap kali dijalankan, data kembali ke keadaan awal sehingga kamu bebas mencoba.</p>
      <ul class="rc-sql-schema__tables">
        <li v-for="table in dataset.tables" :key="table.name">
          <h4 class="rc-sql-schema__name">{{ table.name }}</h4>
          <p class="rc-hint">{{ table.description }}</p>
          <dl class="rc-sql-schema__cols">
            <template v-for="column in table.columns" :key="column.name">
              <dt>{{ column.name }}</dt>
              <dd>
                {{ column.type }}<span v-if="column.note" class="rc-hint"> · {{ column.note }}</span>
              </dd>
            </template>
          </dl>
        </li>
      </ul>
    </div>
  </details>
</template>
