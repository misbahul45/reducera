<script setup lang="ts">
import AdminReasonDialog from '~/components/admin/AdminReasonDialog.vue';
import AdminState from '~/components/admin/AdminState.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { useGamifyLadder } from '~/composables/useGamifyAdmin';
import { useQueueActions } from '~/composables/useQueueActions';
import { LADDER_CHANGE_LABEL, LADDER_MAX_LEVELS, LADDER_MIN_LEVELS, ladderPreview, readLadder, suggestNextXp } from '~/lib/gamify-admin';
import { adminService } from '~/services/admin';

const { ladder, state, error, refresh } = useGamifyLadder();

const actions = useQueueActions(async () => {
  await refresh();
});

const edits = ref<string[] | null>(null);
const base = ref<string | null>(null);
const touched = ref(false);
const dialog = ref(false);

const stored = computed(() => ladder.value?.levels ?? []);
const storedXps = computed(() => stored.value.map((row) => String(row.xp)));
const xps = computed(() => edits.value ?? storedXps.value);
const reading = computed(() => readLadder(xps.value));
const dirty = computed(() => edits.value !== null && edits.value.join('|') !== storedXps.value.join('|'));
const stale = computed(() => edits.value !== null && base.value !== null && ladder.value !== null && ladder.value.fingerprint !== base.value);

const impact = computed(() => {
  const rows = reading.value.rows;
  if (!rows) return [];
  return ladderPreview(stored.value, rows, stored.value.map((row) => row.xp)).filter((row) => row.change !== 'same');
});

function load() {
  edits.value = null;
  base.value = null;
  touched.value = false;
}

function discard() {
  load();
  actions.clear();
}

function replaceXps(next: string[]) {
  if (edits.value === null) base.value = ladder.value?.fingerprint ?? null;
  edits.value = next;
}

function onInput(index: number, event: Event) {
  const next = [...xps.value];
  next[index] = (event.target as HTMLInputElement).value;
  replaceXps(next);
}

function addLevel() {
  if (xps.value.length < LADDER_MAX_LEVELS) replaceXps([...xps.value, suggestNextXp(xps.value)]);
}

function removeLast() {
  if (xps.value.length > LADDER_MIN_LEVELS) replaceXps(xps.value.slice(0, -1));
}

function ask() {
  touched.value = true;
  if (!dirty.value || reading.value.rows === null || stale.value) return;
  actions.clear();
  dialog.value = true;
}

async function save(reason: string) {
  const rows = reading.value.rows;
  if (!rows) return;
  const baseFingerprint = base.value ?? '';
  const ok = await actions.run('replace', 'ladder', () => adminService.gamify.replaceLevels({ baseFingerprint, levels: rows, reason }), 'Tangga level diganti.');
  if (ok) {
    dialog.value = false;
    load();
  } else {
    await refresh();
  }
}
</script>

<template>
  <div class="rc-stack">
    <p v-if="actions.notice.value" class="rc-alert rc-alert--success" role="status">{{ actions.notice.value }}</p>
    <p class="rc-hint">
      Tangga level menentukan berapa XP yang dibutuhkan untuk setiap level. XP pelajar tidak berubah, tetapi level yang mereka lihat mengikuti tangga baru begitu disimpan.
    </p>

    <AdminState :status="state" :error="error" error-title="Gagal memuat tangga level" @retry="refresh()">
      <PlayCard as="section" aria-labelledby="ladder-h" class="rc-detail rc-detail--wide">
        <h2 id="ladder-h">
          Tangga level
          <StatusBadge v-if="ladder?.builtin" tone="neutral" label="Bawaan kode" />
        </h2>

        <p v-if="stale" class="rc-alert rc-alert--info" role="status">
          Tangga ini sudah diganti orang lain sejak formulir dibuka.
          <PlayButton size="sm" variant="outline" @click="discard">Muat ulang tangga</PlayButton>
        </p>

        <form class="rc-stack" novalidate @submit.prevent="ask">
          <div class="rc-table-wrap">
            <table class="rc-table rc-table--compact">
              <caption>Level dan XP yang dibutuhkan</caption>
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">XP yang dibutuhkan</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(_, index) in xps" :key="index">
                  <th scope="row">Level {{ index + 1 }}</th>
                  <td>
                    <input
                      :value="xps[index]"
                      class="rc-field rc-field--narrow"
                      inputmode="numeric"
                      autocomplete="off"
                      :aria-label="`XP untuk level ${index + 1}`"
                      :readonly="index === 0"
                      @input="onInput(index, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul v-if="touched && reading.problems.length > 0" class="rc-reasons rc-error-text" role="alert" aria-label="Masalah pada tangga">
            <li v-for="problem in reading.problems" :key="problem">{{ problem }}</li>
          </ul>

          <div class="rc-actions">
            <PlayButton variant="outline" :disabled="xps.length >= LADDER_MAX_LEVELS" @click="addLevel">Tambah level</PlayButton>
            <PlayButton variant="outline" :disabled="xps.length <= LADDER_MIN_LEVELS" @click="removeLast">Hapus level terakhir</PlayButton>
            <PlayButton variant="ghost" :disabled="!dirty" @click="discard">Kembalikan</PlayButton>
            <PlayButton type="submit" :disabled="!dirty || stale">Simpan tangga</PlayButton>
          </div>
        </form>

        <section v-if="dirty && reading.rows" class="rc-stack" aria-labelledby="impact-h">
          <h3 id="impact-h" class="rc-h2">Dampak pada pelajar</h3>
          <p v-if="impact.length === 0" class="rc-hint">Pelajar di setiap batas XP lama tetap berada di level yang sama.</p>
          <template v-else>
            <p class="rc-hint">Level yang akan dilihat pelajar yang tepat berada di batas XP tangga lama:</p>
            <div class="rc-table-wrap">
              <table class="rc-table rc-table--compact">
                <caption>Perubahan level pada batas XP tangga lama</caption>
                <thead>
                  <tr>
                    <th scope="col" class="rc-table__num">XP</th>
                    <th scope="col" class="rc-table__num">Level sekarang</th>
                    <th scope="col" class="rc-table__num">Level baru</th>
                    <th scope="col">Arah</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in impact" :key="row.xp">
                    <td class="rc-table__num">{{ row.xp }}</td>
                    <td class="rc-table__num">{{ row.before }}</td>
                    <td class="rc-table__num">{{ row.after }}</td>
                    <td>
                      <StatusBadge :tone="row.change === 'up' ? 'success' : 'warning'" :label="LADDER_CHANGE_LABEL[row.change]" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>
      </PlayCard>
    </AdminState>

    <AdminReasonDialog
      :open="dialog"
      title="Ganti tangga level"
      message="Semua pelajar langsung melihat level baru mereka. XP mereka tidak berubah. Alasan tercatat di audit."
      confirm-label="Ganti tangga"
      :busy="actions.busy.value"
      :error="actions.error.value"
      @confirm="save"
      @cancel="dialog = false"
    />
  </div>
</template>
