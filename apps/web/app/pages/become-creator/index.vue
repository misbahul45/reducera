<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import ErrorState from '~/components/ui/ErrorState.vue';
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue';
import { creatorApi } from '~/lib/api';
import { describeApiError } from '~/lib/api-error';
import type { User } from '~/interfaces/auth';
import { applicationPayload, applicationProblem, applicationStage, eligibilityCopy, eligibleTopics, type TopicEligibility } from '~/lib/creator-application';
import { formatDate } from '~/lib/format';
import { userTopicService } from '~/services/learning/userTopic';

definePageMeta({
  title: 'Jadi Kreator — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
});

useHead({ title: 'Jadi Kreator — ReduCera' });

const { data: application, status, error, refresh } = useAsyncData('creator:application', () => creatorApi.myApplication(), { lazy: true });

const stage = computed(() => applicationStage(application.value));

const user = useState<User | null>('user');
const { data: topics, status: topicStatus } = useAsyncData(
  'creator-topic-eligibility',
  async (): Promise<TopicEligibility[]> => {
    if (!user.value?.id) return [];
    const res = await userTopicService.findAll<true>({ page: 1, limit: 50, userId: user.value.id, include: 'topic' });
    const owned = (res.data?.data ?? []).flatMap((row) => (row.topic ? [{ id: row.topic.id, title: row.topic.title }] : []));
    const checked = await Promise.all(
      owned.map(async (topic): Promise<TopicEligibility> => {
        const result = await creatorApi.checkEligibility(topic.id).catch(() => undefined);
        return {
          topicId: topic.id,
          title: topic.title,
          eligible: Boolean(result?.eligible),
          score: result?.score ?? null,
          passedConcepts: result?.passedConcepts ?? 0,
          totalConcepts: result?.totalConcepts ?? 0,
        };
      }),
    );
    return checked;
  },
  { lazy: true, server: false },
);
const ready = computed(() => eligibleTopics(topics.value ?? []));

const form = reactive({ fullName: '', bio: '', expertise: '', portfolioUrl: '', cvUrl: '', expertiseTopicId: '' });
const submitting = ref(false);
const formError = ref<string | null>(null);

async function submit() {
  if (submitting.value) return;
  const problem = applicationProblem(form);
  if (problem) {
    formError.value = problem;
    return;
  }
  submitting.value = true;
  formError.value = null;
  try {
    await creatorApi.apply(applicationPayload(form));
    await refresh();
  } catch (err) {
    formError.value = describeApiError(err, 'Pengajuan gagal dikirim. Coba lagi.');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="rc-stack rc-pay">
    <PageHeader title="Jadi kreator" subtitle="Tulis artikel dan buka kelas di marketplace ReduCera. Admin meninjau setiap pengajuan." />

    <LoadingSkeleton v-if="status === 'pending' && !application" variant="panel" :count="2" />
    <ErrorState v-else-if="error" title="Status pengajuan gagal dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <PlayCard v-else-if="stage === 'pending'" tone="info" as="section" aria-labelledby="stage-h">
      <h2 id="stage-h" class="rc-h2">Pengajuan sedang ditinjau</h2>
      <p>Pengajuan atas nama {{ application?.fullName }} dikirim {{ formatDate(application?.createdAt) }}. Kamu akan bisa membuka Studio setelah disetujui.</p>
    </PlayCard>

    <PlayCard v-else-if="stage === 'approved'" tone="success" as="section" aria-labelledby="stage-h">
      <h2 id="stage-h" class="rc-h2">Pengajuanmu disetujui</h2>
      <p v-if="application?.feedback">Catatan: {{ application.feedback }}</p>
      <div class="rc-actions">
        <PlayButton to="/studio">Buka Studio</PlayButton>
      </div>
    </PlayCard>

    <PlayCard v-else-if="stage === 'rejected'" tone="danger" as="section" aria-labelledby="stage-h">
      <h2 id="stage-h" class="rc-h2">Pengajuan belum disetujui</h2>
      <p>{{ application?.feedback || 'Admin tidak meninggalkan catatan.' }}</p>
      <p class="rc-hint">Hubungi admin bila kamu ingin mengajukan ulang.</p>
    </PlayCard>

    <PlayCard v-else as="form" class="rc-studio-form" aria-label="Form pengajuan kreator" novalidate @submit.prevent="submit">
      <fieldset class="rc-fieldset">
        <legend class="rc-h2">Course yang sudah kamu kuasai</legend>
        <p class="rc-hint">Kamu bisa mengajukan diri setelah semua konsep sebuah course lulus dengan rata-rata 85%.</p>
        <LoadingSkeleton v-if="(topicStatus === 'pending' || topicStatus === 'idle') && !topics" variant="row" :count="2" />
        <p v-else-if="!topics || topics.length === 0" class="rc-hint">
          Kamu belum mengikuti course apa pun. <NuxtLink to="/learn/topics">Pilih course</NuxtLink> dan selesaikan penilaiannya dulu.
        </p>
        <ul v-else class="rc-studio-list">
          <li v-for="row in topics" :key="row.topicId" class="rc-card">
            <label class="rc-check" :class="{ 'is-disabled': !row.eligible }">
              <input v-model="form.expertiseTopicId" type="radio" name="expertise-topic" :value="row.topicId" :disabled="!row.eligible" />
              <span>
                <strong>{{ row.title }}</strong>
                <span class="rc-hint">{{ eligibilityCopy(row) }}</span>
              </span>
            </label>
          </li>
        </ul>
        <p v-if="topics && topics.length > 0 && ready.length === 0" class="rc-alert rc-alert--info" role="status">
          Belum ada course yang memenuhi syarat. Lanjutkan belajar dan kerjakan penilaiannya.
        </p>
      </fieldset>
      <label class="rc-label">
        Nama lengkap
        <input v-model="form.fullName" class="rc-field" maxlength="200" autocomplete="name" />
      </label>
      <label class="rc-label">
        Tentang kamu
        <textarea v-model="form.bio" rows="4" maxlength="5000" class="rc-field" />
      </label>
      <label class="rc-label">
        Bidang keahlian
        <input v-model="form.expertise" class="rc-field" maxlength="1000" placeholder="Contoh: perpajakan, akuntansi biaya" />
      </label>
      <label class="rc-label">
        Tautan portofolio (opsional)
        <input v-model="form.portfolioUrl" type="url" class="rc-field" placeholder="https://" />
      </label>
      <label class="rc-label">
        Tautan CV (opsional)
        <input v-model="form.cvUrl" type="url" class="rc-field" placeholder="https://" />
      </label>
      <p v-if="formError" class="rc-alert rc-alert--error" role="alert">{{ formError }}</p>
      <div class="rc-actions">
        <PlayButton type="submit" :loading="submitting" :disabled="ready.length === 0">Kirim pengajuan</PlayButton>
      </div>
    </PlayCard>
  </div>
</template>
