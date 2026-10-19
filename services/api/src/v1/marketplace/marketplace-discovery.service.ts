import { Injectable } from '@nestjs/common';
import { ClassDifficulty, ContentStatus, EnrollmentStatus, EntitlementStatus, Prisma, ProductAccessType, ReviewStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { LearnerStateService } from '@/v1/learner-model/learner-state.service';
import { buildReviewQueue } from '@/v1/learner-model/review/review-schedule';
import {
  DifficultyFit,
  LearnerNeed,
  MatchedConcept,
  ProductForRanking,
  RECOMMENDATION_VERSION,
  difficultyForScore,
  learnerNeeds,
  rankProducts,
  reasonFor,
} from './recommendation-ranking';

export const LINK_FETCH_LIMIT = 500;
export const NEW_ARRIVAL_REASON = 'Terbaru di marketplace.';

const articleSelect = {
  id: true,
  title: true,
  excerpt: true,
  coverImage: true,
  accessType: true,
  price: true,
  currency: true,
  publishedAt: true,
  author: { select: { name: true } },
  tenant: { select: { name: true } },
} satisfies Prisma.ArticleSelect;

const classSelect = {
  id: true,
  title: true,
  description: true,
  coverImage: true,
  accessType: true,
  price: true,
  currency: true,
  format: true,
  difficulty: true,
  publishedAt: true,
  instructor: { select: { name: true } },
  tenant: { select: { name: true } },
} satisfies Prisma.ClassProductSelect;

type ArticleRow = Prisma.ArticleGetPayload<{ select: typeof articleSelect }>;
type ClassRow = Prisma.ClassProductGetPayload<{ select: typeof classSelect }>;

export interface RecommendedProduct {
  kind: 'article' | 'class';
  id: string;
  title: string;
  excerpt: string | null;
  description: string | null;
  coverUrl: string | null;
  creator: string;
  accessType: ProductAccessType;
  price: number | null;
  currency: string;
  difficulty: ClassDifficulty | null;
  format: string | null;
  publishedAt: Date | null;
}

export interface Recommendation {
  product: RecommendedProduct;
  score: number;
  reason: string;
  personalized: boolean;
  matchedConcepts: MatchedConcept[];
  difficultyFit: DifficultyFit;
}

export interface RecommendationResult {
  algorithm: string;
  averageMastery: number;
  preferredDifficulty: ClassDifficulty;
  needs: Array<Pick<LearnerNeed, 'conceptId' | 'title' | 'kind' | 'score'>>;
  recommendations: Recommendation[];
}

const coverOf = (image: Prisma.JsonValue): string | null =>
  image !== null && typeof image === 'object' && !Array.isArray(image) && typeof image.url === 'string' ? image.url : null;

const priceOf = (price: Prisma.Decimal | null): number | null => (price === null ? null : Number(price.toString()));

const fromArticle = (row: ArticleRow): RecommendedProduct => ({
  kind: 'article',
  id: row.id,
  title: row.title,
  excerpt: row.excerpt,
  description: null,
  coverUrl: coverOf(row.coverImage),
  creator: row.author.name ?? row.tenant.name,
  accessType: row.accessType,
  price: priceOf(row.price),
  currency: row.currency,
  difficulty: null,
  format: null,
  publishedAt: row.publishedAt,
});

const fromClass = (row: ClassRow): RecommendedProduct => ({
  kind: 'class',
  id: row.id,
  title: row.title,
  excerpt: null,
  description: row.description,
  coverUrl: coverOf(row.coverImage),
  creator: row.instructor.name ?? row.tenant.name,
  accessType: row.accessType,
  price: priceOf(row.price),
  currency: row.currency,
  difficulty: row.difficulty,
  format: row.format,
  publishedAt: row.publishedAt,
});

const visibleWhere = { status: ContentStatus.PUBLISHED, tenant: { status: TenantStatus.ACTIVE } } as const;

@Injectable()
export class MarketplaceDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: LearnerStateService,
  ) {}

  async recommend(userId: string, options: { limit: number }, now: Date = new Date()): Promise<RecommendationResult> {
    const [mastery, nodes, next, owned, enrolled] = await Promise.all([
      this.state.listMastery(userId),
      this.state.skillNodes(userId),
      this.state.nextConcept(userId),
      this.ownedProducts(userId),
      this.state.hasEnrollment(userId),
    ]);

    const evidenced = mastery.filter((entry) => entry.evidenceCount > 0);
    const averageMastery = evidenced.length === 0 ? 0 : evidenced.reduce((sum, entry) => sum + entry.score, 0) / evidenced.length;

    const due = buildReviewQueue(
      mastery.map((entry) => ({ conceptId: entry.conceptId, score: entry.score, evidenceCount: entry.evidenceCount, lastEventAt: entry.lastEventAt })),
      now,
    ).due;

    const needs = learnerNeeds({
      mastery: mastery.map((entry) => ({ conceptId: entry.conceptId, title: entry.title, score: entry.score, evidenceCount: entry.evidenceCount, passed: entry.passed })),
      nextConceptId: enrolled ? next.conceptId : null,
      dueConceptIds: due.map((item) => item.conceptId),
      readyConcepts: enrolled ? nodes.filter((node) => node.state === 'AVAILABLE').map((node) => ({ conceptId: node.conceptId, title: node.title })) : [],
    });

    const personalized = await this.personalized(userId, needs, owned, options.limit, now);
    const missing = options.limit - personalized.length;
    const fillers = missing > 0 ? await this.newArrivals(userId, owned, new Set(personalized.map((item) => `${item.product.kind}:${item.product.id}`)), missing) : [];

    return {
      algorithm: RECOMMENDATION_VERSION,
      averageMastery,
      preferredDifficulty: difficultyForScore(evidenced.length === 0 ? null : averageMastery),
      needs: needs.slice(0, 5).map(({ conceptId, title, kind, score }) => ({ conceptId, title, kind, score })),
      recommendations: [...personalized, ...fillers],
    };
  }

  private async personalized(
    userId: string,
    needs: readonly LearnerNeed[],
    owned: Set<string>,
    limit: number,
    now: Date,
  ): Promise<Recommendation[]> {
    if (needs.length === 0) return [];

    const links = await this.prisma.productConceptLink.findMany({
      where: {
        conceptId: { in: needs.map((need) => need.conceptId) },
        status: ReviewStatus.APPROVED,
        OR: [
          { article: { ...visibleWhere, authorId: { not: userId } } },
          { classProduct: { ...visibleWhere, instructorId: { not: userId } } },
        ],
      },
      select: {
        conceptId: true,
        article: { select: articleSelect },
        classProduct: { select: classSelect },
      },
      orderBy: { createdAt: 'desc' },
      take: LINK_FETCH_LIMIT,
    });

    const products = new Map<string, { product: RecommendedProduct; conceptIds: string[] }>();
    for (const link of links) {
      const product = link.article ? fromArticle(link.article) : link.classProduct ? fromClass(link.classProduct) : null;
      if (product === null) continue;
      const key = `${product.kind}:${product.id}`;
      if (owned.has(key)) continue;
      const entry = products.get(key) ?? { product, conceptIds: [] };
      entry.conceptIds.push(link.conceptId);
      products.set(key, entry);
    }

    const candidates: ProductForRanking[] = [...products.values()].map(({ product, conceptIds }) => ({
      kind: product.kind,
      id: product.id,
      conceptIds,
      difficulty: product.difficulty,
      free: product.accessType === ProductAccessType.FREE,
      publishedAt: product.publishedAt,
    }));

    return rankProducts(needs, candidates, now)
      .slice(0, limit)
      .map((ranked) => ({
        product: (products.get(`${ranked.kind}:${ranked.id}`) as { product: RecommendedProduct }).product,
        score: ranked.score,
        reason: reasonFor(ranked),
        personalized: true,
        matchedConcepts: ranked.matched,
        difficultyFit: ranked.difficultyFit,
      }));
  }

  private async newArrivals(userId: string, owned: Set<string>, taken: Set<string>, count: number): Promise<Recommendation[]> {
    const window = count + owned.size + taken.size;
    const [articles, classes] = await Promise.all([
      this.prisma.article.findMany({
        where: { ...visibleWhere, authorId: { not: userId } },
        select: articleSelect,
        orderBy: { publishedAt: 'desc' },
        take: window,
      }),
      this.prisma.classProduct.findMany({
        where: { ...visibleWhere, instructorId: { not: userId } },
        select: classSelect,
        orderBy: { publishedAt: 'desc' },
        take: window,
      }),
    ]);

    return [...articles.map(fromArticle), ...classes.map(fromClass)]
      .filter((product) => !owned.has(`${product.kind}:${product.id}`) && !taken.has(`${product.kind}:${product.id}`))
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id))
      .slice(0, count)
      .map((product) => ({ product, score: 0, reason: NEW_ARRIVAL_REASON, personalized: false, matchedConcepts: [], difficultyFit: 'NOT_APPLICABLE' as const }));
  }

  private async ownedProducts(userId: string): Promise<Set<string>> {
    const [entitlements, enrollments] = await Promise.all([
      this.prisma.entitlement.findMany({
        where: { userId, status: EntitlementStatus.ACTIVE, OR: [{ articleId: { not: null } }, { classId: { not: null } }] },
        select: { articleId: true, classId: true },
      }),
      this.prisma.classEnrollment.findMany({
        where: { userId, status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] } },
        select: { classProductId: true },
      }),
    ]);

    const owned = new Set<string>();
    for (const entitlement of entitlements) {
      if (entitlement.articleId) owned.add(`article:${entitlement.articleId}`);
      if (entitlement.classId) owned.add(`class:${entitlement.classId}`);
    }
    for (const enrollment of enrollments) owned.add(`class:${enrollment.classProductId}`);
    return owned;
  }
}
