import { Prisma, ReviewStatus } from '@prisma/client';
import { AppError, AppErrorCode } from '@/common/lib/error';

export const MAX_CONCEPTS_PER_PRODUCT = 5;

export type ProductRef = { kind: 'article'; id: string } | { kind: 'class'; id: string };

export interface ConceptTag {
  conceptId: string;
  title: string;
  level: number;
  status: ReviewStatus;
}

type Db = Prisma.TransactionClient;

const ownerOf = (product: ProductRef): Prisma.ProductConceptLinkWhereInput =>
  product.kind === 'article' ? { articleId: product.id } : { classProductId: product.id };

const ownerData = (product: ProductRef) => (product.kind === 'article' ? { articleId: product.id } : { classProductId: product.id });

const tagSelect = { conceptId: true, status: true, concept: { select: { title: true, level: true } } } as const;

const toTag = (row: { conceptId: string; status: ReviewStatus; concept: { title: string; level: number } }): ConceptTag => ({
  conceptId: row.conceptId,
  title: row.concept.title,
  level: row.concept.level,
  status: row.status,
});

export const toPublicConcepts = (tags: readonly ConceptTag[] | undefined): Array<{ id: string; title: string }> =>
  (tags ?? []).map((tag) => ({ id: tag.conceptId, title: tag.title }));

export async function replaceConceptLinks(db: Db, product: ProductRef, conceptIds: readonly string[], actorId: string): Promise<void> {
  const wanted = [...new Set(conceptIds)];
  if (wanted.length > MAX_CONCEPTS_PER_PRODUCT) {
    throw new AppError(`A product can carry at most ${MAX_CONCEPTS_PER_PRODUCT} concepts`, 422, AppErrorCode.VALIDATION_ERROR);
  }

  if (wanted.length > 0) {
    const active = await db.concept.findMany({ where: { id: { in: wanted }, status: 'ACTIVE' }, select: { id: true } });
    const known = new Set(active.map((concept) => concept.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new AppError(`Unknown concept: ${unknown.join(', ')}`, 422, AppErrorCode.VALIDATION_ERROR);
    }
  }

  await db.productConceptLink.deleteMany({ where: { ...ownerOf(product), conceptId: { notIn: wanted } } });
  const kept = new Set((await db.productConceptLink.findMany({ where: ownerOf(product), select: { conceptId: true } })).map((link) => link.conceptId));
  const fresh = wanted.filter((id) => !kept.has(id));
  if (fresh.length > 0) {
    await db.productConceptLink.createMany({ data: fresh.map((conceptId) => ({ conceptId, proposedById: actorId, ...ownerData(product) })) });
  }
}

export async function approveConceptLinks(db: Db, product: ProductRef, at: Date): Promise<number> {
  const result = await db.productConceptLink.updateMany({
    where: { ...ownerOf(product), status: ReviewStatus.PROPOSED },
    data: { status: ReviewStatus.APPROVED, reviewedAt: at },
  });
  return result.count;
}

export async function pendingConceptIds(db: Db, product: ProductRef): Promise<string[]> {
  const rows = await db.productConceptLink.findMany({
    where: { ...ownerOf(product), status: ReviewStatus.PROPOSED },
    select: { conceptId: true },
    orderBy: { conceptId: 'asc' },
  });
  return rows.map((row) => row.conceptId);
}

export async function dropPendingConceptLinks(db: Db, product: ProductRef): Promise<number> {
  const result = await db.productConceptLink.deleteMany({ where: { ...ownerOf(product), status: ReviewStatus.PROPOSED } });
  return result.count;
}

export async function conceptLinksOf(db: Db, product: ProductRef): Promise<ConceptTag[]> {
  const rows = await db.productConceptLink.findMany({ where: ownerOf(product), select: tagSelect, orderBy: [{ concept: { level: 'asc' } }, { conceptId: 'asc' }] });
  return rows.map(toTag);
}

export async function approvedConceptsByProduct(db: Db, kind: ProductRef['kind'], productIds: readonly string[]): Promise<Map<string, ConceptTag[]>> {
  const grouped = new Map<string, ConceptTag[]>();
  if (productIds.length === 0) return grouped;

  const rows = await db.productConceptLink.findMany({
    where: kind === 'article' ? { articleId: { in: [...productIds] }, status: ReviewStatus.APPROVED } : { classProductId: { in: [...productIds] }, status: ReviewStatus.APPROVED },
    select: { ...tagSelect, articleId: true, classProductId: true },
    orderBy: [{ concept: { level: 'asc' } }, { conceptId: 'asc' }],
  });
  for (const row of rows) {
    const productId = row.articleId ?? row.classProductId;
    if (productId === null) continue;
    const tags = grouped.get(productId) ?? [];
    tags.push(toTag(row));
    grouped.set(productId, tags);
  }
  return grouped;
}
