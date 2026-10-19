import { describe, expect, it } from 'vitest';
import { canAskRefund, refundFor, refundNotice, refundProblem, type RefundView } from '~/lib/refunds';

const refund = (over: Partial<RefundView> = {}): RefundView => ({
  id: 'r1',
  orderId: 'o1',
  status: 'REQUESTED',
  amount: '50000.00',
  reason: 'Salah beli',
  createdAt: '2026-10-11T10:00:00.000Z',
  ...over,
});

describe('refundProblem', () => {
  it('needs a reason of 5 to 1000 characters', () => {
    expect(refundProblem('ok')).toMatch(/minimal 5/);
    expect(refundProblem('   abc  ')).toMatch(/minimal 5/);
    expect(refundProblem('Saya membeli dua kali')).toBeNull();
    expect(refundProblem('x'.repeat(1001))).toMatch(/maksimal 1000/);
  });
});

describe('canAskRefund', () => {
  it('opens only for a fulfilled order that was paid with money', () => {
    expect(canAskRefund({ status: 'FULFILLED', paidAt: '2026-10-10T00:00:00Z', total: '50000.00' })).toBe(true);
    expect(canAskRefund({ status: 'FULFILLED', paidAt: null, total: '50000.00' })).toBe(false);
    expect(canAskRefund({ status: 'PENDING', paidAt: '2026-10-10T00:00:00Z', total: '50000.00' })).toBe(false);
    expect(canAskRefund({ status: 'REFUND_PENDING', paidAt: '2026-10-10T00:00:00Z', total: '50000.00' })).toBe(false);
  });

  it('stays closed for a free order because there is no payment to give back', () => {
    expect(canAskRefund({ status: 'FULFILLED', paidAt: '2026-10-10T00:00:00Z', total: '0.00' })).toBe(false);
    expect(canAskRefund({ status: 'FULFILLED', paidAt: '2026-10-10T00:00:00Z' })).toBe(false);
  });
});

describe('refundFor', () => {
  it('returns the latest refund of the order and none for another order', () => {
    const list = [refund({ id: 'old', createdAt: '2026-10-01T00:00:00Z', status: 'REJECTED' }), refund({ id: 'new' }), refund({ id: 'x', orderId: 'o2' })];

    expect(refundFor(list, 'o1')?.id).toBe('new');
    expect(refundFor(list, 'o3')).toBeNull();
  });
});

describe('refundNotice', () => {
  it('tells the buyer what happens next at every status', () => {
    expect(refundNotice(refund()).message).toMatch(/ditinjau/);
    expect(refundNotice(refund({ status: 'APPROVED' })).message).toMatch(/diproses/);
    expect(refundNotice(refund({ status: 'PROCESSED' }))).toMatchObject({ tone: 'success' });
  });

  it('shows the reason an administrator gave for a rejection', () => {
    expect(refundNotice(refund({ status: 'REJECTED', rejectionReason: 'Sudah dipakai' }))).toEqual({ tone: 'error', message: 'Permintaan ditolak: Sudah dipakai' });
    expect(refundNotice(refund({ status: 'REJECTED' })).message).toBe('Permintaan pengembalian dana ditolak.');
  });
});
