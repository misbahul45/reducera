import { z } from 'zod';

export const MAX_PAGE_SIZE = 50;
export const MAX_CURSOR = 100_000;

export const PageParamsSchema = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.coerce.number().int().min(0).max(MAX_CURSOR).optional(),
};

export interface PageInfo {
  total: number;
  limit: number | null;
  nextCursor: number | null;
}

export interface Page<T> {
  items: T[];
  page: PageInfo;
}

export const paginate = <T>(items: readonly T[], limit?: number, cursor = 0): Page<T> => {
  if (limit === undefined) return { items: [...items], page: { total: items.length, limit: null, nextCursor: null } };
  const slice = items.slice(cursor, cursor + limit);
  const end = cursor + slice.length;
  return { items: slice, page: { total: items.length, limit, nextCursor: end < items.length ? end : null } };
};
