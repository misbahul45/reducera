export const REFUND_REASON_MIN = 5;
export const REFUND_REASON_MAX = 1000;

export interface RefundView {
  id: string;
  orderId: string;
  status: string;
  amount: string | number;
  reason: string;
  rejectionReason?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export function refundProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < REFUND_REASON_MIN) return `Alasan minimal ${REFUND_REASON_MIN} karakter.`;
  if (trimmed.length > REFUND_REASON_MAX) return `Alasan maksimal ${REFUND_REASON_MAX} karakter.`;
  return null;
}

export const canAskRefund = (order: { status: string; paidAt?: string | null; total?: string | number | null }): boolean =>
  order.status === 'FULFILLED' && Boolean(order.paidAt) && Number(order.total ?? 0) > 0;

export function refundFor(refunds: readonly RefundView[], orderId: string): RefundView | null {
  const mine = refunds.filter((refund) => refund.orderId === orderId);
  if (mine.length === 0) return null;
  return [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export interface RefundNotice {
  tone: 'info' | 'success' | 'error';
  message: string;
}

export function refundNotice(refund: RefundView): RefundNotice {
  if (refund.status === 'REQUESTED') return { tone: 'info', message: 'Permintaan pengembalian dana sedang ditinjau admin.' };
  if (refund.status === 'APPROVED') return { tone: 'info', message: 'Pengembalian dana disetujui dan sedang diproses.' };
  if (refund.status === 'PROCESSED') return { tone: 'success', message: 'Dana sudah dikembalikan. Akses ke produk ini ditutup.' };
  if (refund.status === 'REJECTED') {
    return { tone: 'error', message: refund.rejectionReason ? `Permintaan ditolak: ${refund.rejectionReason}` : 'Permintaan pengembalian dana ditolak.' };
  }
  return { tone: 'info', message: 'Status pengembalian dana belum diketahui.' };
}
