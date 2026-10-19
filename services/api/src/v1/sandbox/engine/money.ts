export const MAX_RUPIAH = 999_999_999_999;

export const isRupiah = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_RUPIAH;

export const formatRupiah = (value: number): string => `Rp${Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
