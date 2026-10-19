<script setup lang="ts">
import PageHeader from '~/components/play/PageHeader.vue';
import PlayButton from '~/components/play/PlayButton.vue';
import PlayCard from '~/components/play/PlayCard.vue';
import ErrorState from '~/components/ui/ErrorState.vue';
import LoadingSkeleton from '~/components/ui/LoadingSkeleton.vue';
import StatusBadge from '~/components/ui/StatusBadge.vue';
import { ordersApi, refundsApi } from '~/lib/api';
import { createIdempotencyKey } from '~/composables/useIdempotencyKey';
import { describeApiError } from '~/lib/api-error';
import { formatDateTime, formatMoney } from '~/lib/format';
import { orderItemLink, orderItemTitle, orderNext, orderStatusMeta } from '~/lib/order-status';
import { REFUND_REASON_MAX, canAskRefund, refundFor, refundNotice, refundProblem } from '~/lib/refunds';

definePageMeta({
  title: 'Detail Pesanan — ReduCera',
  protection: { kind: 'authenticated' },
  layout: 'learner',
});

const route = useRoute();
const orderId = computed(() => String(route.params.id || ''));

const { data: order, status, error, refresh } = useAsyncData(
  () => `order:${orderId.value}`,
  () => ordersApi.get(orderId.value),
  { lazy: true, watch: [orderId] },
);

const next = computed(() => (order.value ? orderNext(order.value) : null));

const { data: refunds, refresh: refreshRefunds } = useAsyncData(() => `order-refunds:${orderId.value}`, () => refundsApi.mine(), {
  lazy: true,
  watch: [orderId],
});
const refund = computed(() => refundFor(refunds.value ?? [], orderId.value));
const notice = computed(() => (refund.value ? refundNotice(refund.value) : null));
const askable = computed(() => Boolean(order.value && canAskRefund(order.value) && !refund.value));

const reason = ref('');
const touched = ref(false);
const submitting = ref(false);
const refundError = ref<string | null>(null);
const refundKey = createIdempotencyKey();
const problem = computed(() => refundProblem(reason.value));

async function askRefund() {
  touched.value = true;
  if (problem.value || submitting.value) return;
  submitting.value = true;
  refundError.value = null;
  try {
    await refundsApi.request(orderId.value, reason.value.trim(), refundKey.current());
    refundKey.reset();
    reason.value = '';
    touched.value = false;
    await Promise.all([refresh(), refreshRefunds()]);
  } catch (err) {
    refundError.value = describeApiError(err, 'Permintaan pengembalian dana gagal dikirim.');
  } finally {
    submitting.value = false;
  }
}

useHead({ title: () => (order.value ? `Pesanan #${order.value.id.slice(0, 8)} — ReduCera` : 'Detail Pesanan — ReduCera') });
</script>

<template>
  <div class="rc-stack">
    <LoadingSkeleton v-if="status === 'pending'" variant="panel" :count="2" />
    <ErrorState v-else-if="error || !order" title="Pesanan tidak dapat dimuat" :message="describeApiError(error)" @retry="refresh()" />

    <template v-else>
      <PageHeader :title="`Pesanan #${order.id.slice(0, 8)}`" :subtitle="`Dibuat ${formatDateTime(order.createdAt)}`">
        <template #actions>
          <StatusBadge :tone="orderStatusMeta(order.status).tone" :label="orderStatusMeta(order.status).label" />
        </template>
      </PageHeader>

      <PlayCard as="section" aria-labelledby="order-items">
        <h2 id="order-items" class="rc-h2">Isi pesanan</h2>
        <ul class="rc-orders__lines">
          <li v-for="item in order.items" :key="item.id">
            <div>
              <NuxtLink v-if="orderItemLink(item) && next?.kind === 'open'" :to="orderItemLink(item)!" class="rc-cdetail__link">
                {{ orderItemTitle(item) }}
              </NuxtLink>
              <span v-else>{{ orderItemTitle(item) }}</span>
            </div>
            <strong>{{ formatMoney(item.totalPrice, order.currency) }}</strong>
          </li>
        </ul>
        <p class="rc-orders__total">Total <strong>{{ formatMoney(order.total, order.currency) }}</strong></p>
        <p v-if="order.paidAt" class="rc-hint">Dibayar {{ formatDateTime(order.paidAt) }}</p>
      </PlayCard>

      <PlayCard v-if="askable" as="section" aria-labelledby="refund-h">
        <h2 id="refund-h" class="rc-h2">Ajukan pengembalian dana</h2>
        <p class="rc-hint">Hanya bisa dalam masa pengembalian dan sebelum produk dipakai. Admin meninjau setiap permintaan.</p>
        <form class="rc-studio-form" novalidate @submit.prevent="askRefund">
          <label class="rc-label">
            Alasan
            <textarea v-model="reason" rows="3" :maxlength="REFUND_REASON_MAX" class="rc-field" :aria-invalid="touched && problem ? 'true' : undefined" />
          </label>
          <p v-if="touched && problem" class="rc-error-text" role="alert">{{ problem }}</p>
          <p v-if="refundError" class="rc-alert rc-alert--error" role="alert">{{ refundError }}</p>
          <div class="rc-actions">
            <PlayButton type="submit" variant="outline" :loading="submitting">Kirim permintaan</PlayButton>
          </div>
        </form>
      </PlayCard>

      <p v-if="notice" class="rc-alert" :class="`rc-alert--${notice.tone}`" role="status">{{ notice.message }}</p>

      <div v-if="next" class="rc-actions">
        <PlayButton v-if="next.kind === 'pay'" :to="next.to">{{ next.label }}</PlayButton>
        <p v-else class="rc-alert" :class="{ 'rc-alert--success': next.kind === 'open' }" role="status">{{ next.message }}</p>
        <PlayButton to="/learn/orders" variant="secondary">Semua pesanan</PlayButton>
      </div>
    </template>
  </div>
</template>
