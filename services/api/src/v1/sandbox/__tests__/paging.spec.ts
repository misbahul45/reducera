import { z } from 'zod';
import { MAX_PAGE_SIZE, PageParamsSchema, paginate } from '../paging';

const schema = z.object(PageParamsSchema);

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it('returns everything and no cursor when no limit is given', () => {
    const page = paginate(items);
    expect(page.items).toEqual(items);
    expect(page.page).toEqual({ total: 23, limit: null, nextCursor: null });
  });

  it('walks the list in pages and ends with a null cursor', () => {
    const seen: number[] = [];
    let cursor: number | null = 0;
    let pages = 0;
    while (cursor !== null) {
      const page = paginate(items, 10, cursor);
      seen.push(...page.items);
      expect(page.page.total).toBe(23);
      cursor = page.page.nextCursor;
      pages += 1;
    }
    expect(seen).toEqual(items);
    expect(pages).toBe(3);
  });

  it('ends exactly when the last page is full', () => {
    const page = paginate([1, 2, 3, 4], 2, 2);
    expect(page.items).toEqual([3, 4]);
    expect(page.page.nextCursor).toBeNull();
  });

  it('answers an empty page past the end and for an empty list', () => {
    expect(paginate(items, 10, 99)).toEqual({ items: [], page: { total: 23, limit: 10, nextCursor: null } });
    expect(paginate([], 10)).toEqual({ items: [], page: { total: 0, limit: 10, nextCursor: null } });
  });

  it('does not change the list it is given', () => {
    const copy = [...items];
    paginate(items, 5, 5);
    expect(items).toEqual(copy);
  });
});

describe('PageParamsSchema', () => {
  it('reads limit and cursor from a query string', () => {
    expect(schema.parse({ limit: '12', cursor: '24' })).toEqual({ limit: 12, cursor: 24 });
    expect(schema.parse({})).toEqual({});
  });

  it('refuses a limit or cursor outside the bounds', () => {
    expect(() => schema.parse({ limit: '0' })).toThrow();
    expect(() => schema.parse({ limit: String(MAX_PAGE_SIZE + 1) })).toThrow();
    expect(() => schema.parse({ limit: '1.5' })).toThrow();
    expect(() => schema.parse({ cursor: '-1' })).toThrow();
    expect(() => schema.parse({ cursor: '100001' })).toThrow();
    expect(() => schema.parse({ cursor: 'abc' })).toThrow();
  });
});
