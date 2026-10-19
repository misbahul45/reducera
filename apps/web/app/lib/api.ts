import type { ApiResponse, AppErrorCode, Query } from "~/interfaces/api";
import { authService } from "~/services/auth";
import { ApiError, isApiError, kindFromStatus, toApiError, unwrap, unwrapList } from "~/lib/api-error";
import { withStudioTenant } from "~/lib/studio-tenant";
import type {
  ManualPaymentStatus,
  ManualSubmissionView,
  StudioArticle,
  StudioArticleSummary,
  StudioClass,
  StudioClassSession,
  StudioClassSummary,
  StudioConceptLink,
  TeacherApplicationView,
  ClassMaterialsView,
  EnrollmentView,
  MarketplaceArticleView,
  MarketplaceClassView,
  OrderView,
  Paginated,
  PayoutView,
} from "~/interfaces/commerce";
import type {
  SandboxGraph,
  PlacementResult,
  ConceptMasteryEntry,
} from "~/interfaces/sandbox";
import type {
  Catalog as SandboxCatalog,
  CatalogQuery,
  CheckResult,
  HintResult,
  PracticeSignals,
  RevealResult,
  SavedLine,
  ScenarioDetail,
  VariantCheckResult,
  VariantDetail,
  VariantReveal,
} from "~/interfaces/sandbox/practice";
import type {
  SqlCatalog,
  SqlCheckResult,
  SqlHintResult,
  SqlRevealResult,
  SqlRunResult,
} from "~/interfaces/sandbox/sql";
import type {
  TryoutCatalog,
  TryoutHistory,
  TryoutHistoryQuery,
  TryoutPlan,
  TryoutResult,
  TryoutSavedAnswers,
  TryoutSession,
} from "~/interfaces/sandbox/tryout";
import type { AchievementList, GamifyMe, TopicBoard } from "~/interfaces/gamify";
import type { NextConceptView, StrategySummaryView, StrategyView } from "~/lib/learner";
import type { RecommendationResult } from "~/lib/marketplace";
import type { ReviewView } from "~/lib/review";
import type { RefundView } from "~/lib/refunds";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "PATCH";

interface Tokens {
  access_token?: string;
  refresh_token?: string;
}

const REFRESH_PATH = "/api/v1/auth/refresh-token";

function isServerRuntime() {
  return typeof window === "undefined";
}

export function getApiUrl() {
  const config = useRuntimeConfig();
  if (isServerRuntime()) {
    return config.apiInternalUrl || config.public.API_URL;
  }
  return config.public.API_URL;
}

export function normalizeApiPath(endpoint: string) {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    try {
      const parsed = new URL(endpoint);
      endpoint = parsed.pathname + parsed.search;
    } catch {
      return endpoint;
    }
  }
  if (endpoint.startsWith("/api/v1")) {
    return endpoint;
  }
  if (!endpoint.startsWith("/")) {
    endpoint = `/${endpoint}`;
  }
  return `/api/v1${endpoint}`;
}

export function apiUrl(path: string) {
  return `${getApiUrl()}${normalizeApiPath(path)}`;
}

export const sandboxApi = {
  catalog: (query: CatalogQuery = {}) => {
    const params = new URLSearchParams();
    if (query.level) params.set("level", String(query.level));
    if (query.difficulty) params.set("difficulty", query.difficulty);
    if (query.status) params.set("status", query.status);
    if (query.q) params.set("q", query.q);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.cursor) params.set("cursor", String(query.cursor));
    const suffix = params.toString();
    return request<SandboxCatalog>(`/api/v1/sandbox/scenarios${suffix ? `?${suffix}` : ""}`).then(unwrap);
  },
  signals: () => request<PracticeSignals>(`/api/v1/sandbox/signals`).then(unwrap),
  detail: (id: string) => request<ScenarioDetail>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}`).then(unwrap),
  check: (id: string, lines: SavedLine[]) =>
    request<CheckResult>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}/check`, "POST", { lines }).then(unwrap),
  hint: (id: string) => request<HintResult>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}/hint`, "POST", {}).then(unwrap),
  reveal: (id: string) => request<RevealResult>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}/reveal`, "POST", {}).then(unwrap),
  variant: (id: string, seed: number) => request<VariantDetail>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}/variants/${seed}`).then(unwrap),
  checkVariant: (id: string, seed: number, lines: SavedLine[]) =>
    request<VariantCheckResult>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}/variants/${seed}/check`, "POST", { lines }).then(unwrap),
  revealVariant: (id: string, seed: number) =>
    request<VariantReveal>(`/api/v1/sandbox/scenarios/${encodeURIComponent(id)}/variants/${seed}/reveal`, "POST", {}).then(unwrap),
  graph: (token?: string) =>
    request<SandboxGraph>(
      `/api/v1/sandbox/graph`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) ?? { levels: [] }),
  placement: (answers: string[], token?: string) =>
    request<PlacementResult>(
      `/api/v1/learning/placement-diagnostic`,
      "POST",
      { answers },
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) as PlacementResult | undefined),
};

export const sqlSandboxApi = {
  catalog: () => request<SqlCatalog>(`/api/v1/sandbox/sql`).then(unwrap),
  run: (datasetId: string, sql: string) => request<SqlRunResult>(`/api/v1/sandbox/sql/run`, "POST", { datasetId, sql }).then(unwrap),
  check: (id: string, sql: string) =>
    request<SqlCheckResult>(`/api/v1/sandbox/sql/exercises/${encodeURIComponent(id)}/check`, "POST", { sql }).then(unwrap),
  hint: (id: string) => request<SqlHintResult>(`/api/v1/sandbox/sql/exercises/${encodeURIComponent(id)}/hint`, "POST", {}).then(unwrap),
  reveal: (id: string) => request<SqlRevealResult>(`/api/v1/sandbox/sql/exercises/${encodeURIComponent(id)}/reveal`, "POST", {}).then(unwrap),
};

export const tryoutApi = {
  catalog: () => request<TryoutCatalog>(`/api/v1/sandbox/tryout`).then(unwrap),
  history: (query: TryoutHistoryQuery = {}) => {
    const params = new URLSearchParams();
    if (query.band) params.set("band", query.band);
    if (query.subtest) params.set("subtest", query.subtest);
    if (query.sort) params.set("sort", query.sort);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.cursor) params.set("cursor", String(query.cursor));
    const suffix = params.toString();
    return request<TryoutHistory>(`/api/v1/sandbox/tryout/history${suffix ? `?${suffix}` : ""}`).then(unwrap);
  },
  start: (plan: TryoutPlan) => request<TryoutSession>(`/api/v1/sandbox/tryout`, "POST", plan).then(unwrap),
  view: (id: string) => request<TryoutSession>(`/api/v1/sandbox/tryout/${encodeURIComponent(id)}`).then(unwrap),
  saveAnswers: (id: string, answers: Record<string, number | null>) =>
    request<TryoutSavedAnswers>(`/api/v1/sandbox/tryout/${encodeURIComponent(id)}/answers`, "PUT", { answers }).then(unwrap),
  submit: (id: string, answers?: Record<string, number | null>) =>
    request<TryoutResult>(`/api/v1/sandbox/tryout/${encodeURIComponent(id)}/submit`, "POST", answers ? { answers } : {}).then(unwrap),
  result: (id: string) => request<TryoutResult>(`/api/v1/sandbox/tryout/${encodeURIComponent(id)}/result`).then(unwrap),
};

export interface ConceptOption {
  id: string;
  title: string;
  description: string | null;
  level: number;
}

export const personalizationApi = {
  listMastery: (token?: string) =>
    request<ConceptMasteryEntry[]>(
      `/api/v1/learner-model/me/mastery`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
  listMisconceptions: (token?: string) =>
    request<MisconceptionPattern[]>(
      `/api/v1/personalization/misconceptions/active`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
  nextConcept: (token?: string) =>
    request<NextConceptView>(`/api/v1/learner-model/me/next`, "GET", undefined, {}, true, token ? { access_token: token } : undefined).then(
      (res) => unwrap(res) as NextConceptView,
    ),
  strategy: (conceptId?: string, token?: string) =>
    request<StrategyView | null>(
      `/api/v1/learner-model/me/strategy${conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : ""}`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => (unwrap(res) ?? null) as StrategyView | null),
  strategies: (token?: string) =>
    request<StrategySummaryView>(`/api/v1/learner-model/me/strategies`, "GET", undefined, {}, true, token ? { access_token: token } : undefined).then(
      (res) => unwrap(res) as StrategySummaryView,
    ),
  review: (token?: string) =>
    request<ReviewView>(`/api/v1/learner-model/me/review`, "GET", undefined, {}, true, token ? { access_token: token } : undefined).then(
      (res) => unwrap(res) as ReviewView,
    ),
  setReviewReminders: (enabled: boolean) =>
    request<{ reminders: boolean }>(`/api/v1/learner-model/me/review/reminders`, "PUT", { enabled }).then(unwrap),
  concepts: (token?: string) =>
    request<ConceptOption[]>(`/api/v1/learner-model/concepts`, "GET", undefined, {}, true, token ? { access_token: token } : undefined).then(unwrapList),
  listMyEvents: () =>
    request<Array<{ id: string; action: string; createdAt: string }>>(`/api/v1/analytics/events/me`).then(unwrapList),
};

export const gamifyApi = {
  me: (token?: string) =>
    request<GamifyMe>(`/api/v1/gamify/me`, "GET", undefined, {}, true, token ? { access_token: token } : undefined).then(
      (res) => unwrap(res) as GamifyMe,
    ),
  achievements: (token?: string) =>
    request<AchievementList>(`/api/v1/gamify/achievements/me`, "GET", undefined, {}, true, token ? { access_token: token } : undefined).then(
      (res) => unwrap(res) as AchievementList,
    ),
  topicBoard: (topicId: string, limit = 20, token?: string) =>
    request<TopicBoard>(
      `/api/v1/gamify/leaderboards/topics/${encodeURIComponent(topicId)}?limit=${limit}`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) as TopicBoard),
  updateBoardMembership: (body: { optIn?: boolean; handle?: string }, token?: string) =>
    request<{ optedIn: boolean; handle: string | null }>(
      `/api/v1/gamify/leaderboards/me`,
      "PUT",
      body,
      {},
      true,
      token ? { access_token: token } : undefined,
    ),
};

export const creatorApi = {
  create: (
    body: { title: string; content: string; excerpt?: string; accessType?: "FREE" | "PAID"; price?: number; conceptIds?: string[] },
    tenantId?: string,
  ) =>
    request<{ id: string }>(`/api/v1/articles`, "POST", body, withTenant(tenantId)).then(unwrap),
  createClass: (
    body: {
      title: string;
      description?: string;
      accessType?: "FREE" | "PAID";
      price?: number;
      format?: string;
      difficulty?: string;
      durationMinutes?: number;
      capacity?: number;
      conceptIds?: string[];
    },
    tenantId?: string,
  ) =>
    request<{ id: string }>(`/api/v1/classes`, "POST", body, withTenant(tenantId)).then(unwrap),
  addClassSession: (
    classId: string,
    body: { startsAt: string; endsAt: string; meetingUrl?: string },
    tenantId?: string,
  ) =>
    request<{ id: string }>(`/api/v1/classes/${encodeURIComponent(classId)}/sessions`, "POST", body, withTenant(tenantId)).then(unwrap),
  checkEligibility: (topicId: string, token?: string) =>
    request<{ eligible: boolean; score: number | null; passedConcepts: number; totalConcepts: number }>(
      `/api/v1/teacher/eligibility?topicId=${encodeURIComponent(topicId)}`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) as { eligible: boolean; score: number | null; passedConcepts: number; totalConcepts: number } | undefined),
  apply: (body: Record<string, unknown>, token?: string) =>
    request(`/api/v1/teacher/applications`, "POST", body, {}, true, token ? { access_token: token } : undefined).then(unwrap),
  myApplication: () =>
    request<Paginated<TeacherApplicationView>>(`/api/v1/teacher/applications?limit=1`).then((res) => unwrap(res).data[0] ?? null),
  profile: (id: string, token?: string) =>
    request<Record<string, unknown>>(
      `/api/v1/teacher/creators/${id}`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
};

export const checkoutApi = {
  listCreditPackages: () =>
    request<Array<{ id: string; slug: string; name: string; creditAmount: number | string; priceAmount: string | number; priceCurrency: string }>>(
      `/api/v1/commerce/credit-packages`,
    ).then(unwrapList),
};

export const walletApi = {
  me: () =>
    request<Array<{ balance: string | number; currency?: string }>>(`/api/v1/wallets/mine`).then((res) => {
      const first = unwrapList(res)[0];
      return first ? { balance: first.balance, currency: first.currency ?? "IDR" } : null;
    }),
};

export const earningsApi = {
  me: (token?: string) =>
    request<{ available: number; pending: number; currency: string }>(
      `/api/v1/commerce/studio-earnings/me`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) as { available: number; pending: number; currency: string }),
  history: (token?: string) =>
    request<any[]>(
      `/api/v1/commerce/studio-earnings/history`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
};

const withTenant = (tenantId?: string): Record<string, string> => (tenantId ? { "x-tenant-id": tenantId } : {});

export const ordersApi = {
  list: () =>
    request<Paginated<OrderView>>(`/api/v1/orders?limit=50`).then((res) => unwrap(res).data),
  get: (id: string) => request<OrderView>(`/api/v1/orders/${encodeURIComponent(id)}`).then(unwrap),
  create: (
    items: Array<{ type: "ARTICLE" | "CLASS" | "TOPIC"; id: string }>,
    idempotencyKey: string,
    paymentMethod?: string,
  ) =>
    request<OrderView>(
      `/api/v1/orders`,
      "POST",
      { items, ...(paymentMethod ? { paymentMethod } : {}) },
      { "Idempotency-Key": idempotencyKey },
    ).then(unwrap),
};

export const refundsApi = {
  mine: () => request<Paginated<RefundView>>(`/api/v1/refunds/mine?limit=50`).then((res) => unwrap(res).data),
  request: (orderId: string, reason: string, idempotencyKey: string) =>
    request<RefundView>(`/api/v1/orders/${encodeURIComponent(orderId)}/refund-requests`, "POST", { reason }, { "Idempotency-Key": idempotencyKey }).then(unwrap),
};

export const paymentsApi = {
  methods: () =>
    request<{ provider: string; methods: Array<{ method: string; label: string }> }>(`/api/v1/payments/methods`).then(unwrap),
  submitManual: (
    intentId: string,
    body: {
      paymentMethod: string;
      referenceNumber?: string;
      proof: { url: string; fileId: string };
      note?: string;
    },
    idempotencyKey: string,
  ) =>
    request<unknown>(
      `/api/v1/payments/manual/intents/${encodeURIComponent(intentId)}/submissions`,
      "POST",
      body,
      { "Idempotency-Key": idempotencyKey },
    ).then(unwrap),
};

const UPLOAD_FAILED = "Unggah gagal. Pastikan file berupa gambar (maksimal 4 MB), lalu coba lagi.";

export const uploadApi = {
  proof: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await $fetch<ApiResponse<{ url: string; fileId: string }>>(apiUrl("/uploads"), {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const uploaded = unwrap(res);
      if (!uploaded) throw toApiError(failureEnvelope({ data: { message: "Upload gagal" } }));
      return uploaded;
    } catch (error) {
      const failure = isApiError(error) ? error : toApiError(failureEnvelope(error));
      throw new ApiError({ message: UPLOAD_FAILED, status: failure.status, code: failure.code, requestId: failure.requestId });
    }
  },
};

export const payoutApi = {
  list: () => request<Paginated<PayoutView>>(`/api/v1/payouts?limit=50`).then((res) => unwrap(res).data),
  request: (
    body: { amount: number; destination: { bankName: string; accountNumber: string; accountName: string } },
    idempotencyKey: string,
  ) => request<PayoutView>(`/api/v1/payouts`, "POST", body, { "Idempotency-Key": idempotencyKey }).then(unwrap),
};

export const adminPaymentsApi = {
  queue: (status?: ManualPaymentStatus, page = 1) =>
    request<Paginated<ManualSubmissionView>>(
      `/api/v1/admin/payments/manual/submissions?${toQueryString({ limit: 20, page, ...(status ? { status } : {}) })}`,
    ).then(unwrap),
  get: (id: string) =>
    request<ManualSubmissionView>(`/api/v1/admin/payments/manual/submissions/${encodeURIComponent(id)}`).then(unwrap),
  startReview: (id: string, idempotencyKey: string) =>
    request<unknown>(
      `/api/v1/admin/payments/manual/submissions/${encodeURIComponent(id)}/start-review`,
      "POST",
      {},
      { "Idempotency-Key": idempotencyKey },
    ).then(unwrap),
  approve: (id: string, reason: string, idempotencyKey: string) =>
    request<unknown>(
      `/api/v1/admin/payments/manual/submissions/${encodeURIComponent(id)}/approve`,
      "POST",
      { reason },
      { "Idempotency-Key": idempotencyKey },
    ).then(unwrap),
  reject: (id: string, reason: string, allowResubmit: boolean, idempotencyKey: string) =>
    request<unknown>(
      `/api/v1/admin/payments/manual/submissions/${encodeURIComponent(id)}/reject`,
      "POST",
      { reason, allowResubmit },
      { "Idempotency-Key": idempotencyKey },
    ).then(unwrap),
};

export const studioArticlesApi = {
  list: (tenantId?: string) =>
    request<Paginated<StudioArticleSummary>>(`/api/v1/articles?limit=50`, "GET", undefined, withTenant(tenantId)).then(
      (res) => unwrap(res).data,
    ),
  get: (id: string, tenantId?: string) =>
    request<StudioArticle>(`/api/v1/articles/${encodeURIComponent(id)}`, "GET", undefined, withTenant(tenantId)).then(unwrap),
  update: (
    id: string,
    body: { title?: string; content?: string; excerpt?: string; accessType?: "FREE" | "PAID"; price?: number; conceptIds?: string[] },
    tenantId?: string,
  ) =>
    request<StudioArticleSummary>(`/api/v1/articles/${encodeURIComponent(id)}`, "PATCH", body, withTenant(tenantId)).then(unwrap),
  submitReview: (id: string, tenantId?: string) =>
    request<StudioArticleSummary>(`/api/v1/articles/${encodeURIComponent(id)}/submit-review`, "POST", {}, withTenant(tenantId)).then(unwrap),
  withdraw: (id: string, tenantId?: string) =>
    request<StudioArticleSummary>(`/api/v1/articles/${encodeURIComponent(id)}/withdraw`, "POST", {}, withTenant(tenantId)).then(unwrap),
  archive: (id: string, tenantId?: string) =>
    request<StudioArticleSummary>(`/api/v1/articles/${encodeURIComponent(id)}/archive`, "POST", {}, withTenant(tenantId)).then(unwrap),
  setConcepts: (id: string, conceptIds: string[], tenantId?: string) =>
    request<{ conceptLinks: StudioConceptLink[] }>(`/api/v1/articles/${encodeURIComponent(id)}/concepts`, "PUT", { conceptIds }, withTenant(tenantId)).then(unwrap),
};

export const studioClassesApi = {
  list: (tenantId?: string) =>
    request<Paginated<StudioClassSummary>>(`/api/v1/classes?limit=50`, "GET", undefined, withTenant(tenantId)).then(
      (res) => unwrap(res).data,
    ),
  get: (id: string, tenantId?: string) =>
    request<StudioClass>(`/api/v1/classes/${encodeURIComponent(id)}`, "GET", undefined, withTenant(tenantId)).then(unwrap),
  update: (
    id: string,
    body: {
      title?: string;
      description?: string;
      accessType?: "FREE" | "PAID";
      price?: number;
      format?: string;
      difficulty?: string;
      durationMinutes?: number;
      capacity?: number;
      conceptIds?: string[];
    },
    tenantId?: string,
  ) => request<StudioClassSummary>(`/api/v1/classes/${encodeURIComponent(id)}`, "PATCH", body, withTenant(tenantId)).then(unwrap),
  submitReview: (id: string, tenantId?: string) =>
    request<StudioClassSummary>(`/api/v1/classes/${encodeURIComponent(id)}/submit-review`, "POST", {}, withTenant(tenantId)).then(unwrap),
  withdraw: (id: string, tenantId?: string) =>
    request<StudioClassSummary>(`/api/v1/classes/${encodeURIComponent(id)}/withdraw`, "POST", {}, withTenant(tenantId)).then(unwrap),
  archive: (id: string, tenantId?: string) =>
    request<StudioClassSummary>(`/api/v1/classes/${encodeURIComponent(id)}/archive`, "POST", {}, withTenant(tenantId)).then(unwrap),
  setConcepts: (id: string, conceptIds: string[], tenantId?: string) =>
    request<{ conceptLinks: StudioConceptLink[] }>(`/api/v1/classes/${encodeURIComponent(id)}/concepts`, "PUT", { conceptIds }, withTenant(tenantId)).then(unwrap),
  addSession: (
    id: string,
    body: { startsAt: string; endsAt: string; meetingUrl?: string; recordingUrl?: string },
    tenantId?: string,
  ) => request<StudioClassSession>(`/api/v1/classes/${encodeURIComponent(id)}/sessions`, "POST", body, withTenant(tenantId)).then(unwrap),
  cancelSession: (id: string, sessionId: string, tenantId?: string) =>
    request<StudioClassSession>(
      `/api/v1/classes/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/cancel`,
      "POST",
      {},
      withTenant(tenantId),
    ).then(unwrap),
};

export const tenantsApi = {
  mine: () =>
    request<Array<{ id: string; name: string; slug: string; status: string; membershipRole: string }>>(`/api/v1/tenants/mine`).then(unwrapList),
};

export const marketplaceApi = {
  articles: (query: { q?: string; page?: number; limit?: number; sort?: string; accessType?: string } = {}) =>
    request<Paginated<MarketplaceArticleView>>(`/api/v1/marketplace/articles?${toQueryString({ limit: 24, ...query })}`).then(unwrap),
  article: (id: string) =>
    request<MarketplaceArticleView>(`/api/v1/marketplace/articles/${encodeURIComponent(id)}`).then(unwrap),
  classes: (query: { q?: string; page?: number; limit?: number; sort?: string; accessType?: string } = {}) =>
    request<Paginated<MarketplaceClassView>>(`/api/v1/marketplace/classes?${toQueryString({ limit: 24, ...query })}`).then(unwrap),
  class: (id: string) =>
    request<MarketplaceClassView>(`/api/v1/marketplace/classes/${encodeURIComponent(id)}`).then(unwrap),
  recommendations: (limit = 8) =>
    request<RecommendationResult>(`/api/v1/marketplace-discovery/recommendations?limit=${limit}`).then(unwrap),
  articlePreview: (id: string) =>
    request<{ id: string; preview: string; truncated: boolean; wordCount: number; readingMinutes: number }>(
      `/api/v1/marketplace/articles/${encodeURIComponent(id)}/preview`,
    ).then(unwrap),
  articleContent: (id: string) =>
    request<{ id: string; title: string; content: string; publishedAt: string | null }>(
      `/api/v1/marketplace/articles/${encodeURIComponent(id)}/content`,
    ).then(unwrap),
  classAccess: (id: string) =>
    request<{ classId: string; accessible: boolean; enrolled: boolean; entitled: boolean }>(
      `/api/v1/marketplace/classes/${encodeURIComponent(id)}/access`,
    ).then(unwrap),
  classMaterials: (id: string) =>
    request<ClassMaterialsView>(`/api/v1/marketplace/classes/${encodeURIComponent(id)}/materials`).then(unwrap),
  myEnrollments: (page = 1) =>
    request<Paginated<EnrollmentView>>(`/api/v1/marketplace/classes/enrollments/mine?${toQueryString({ page, limit: 50 })}`).then(unwrap),
  enrollFreeClass: (id: string) =>
    request<unknown>(`/api/v1/marketplace/classes/${encodeURIComponent(id)}/enroll`, "POST", {}).then(unwrap),
  articleAccess: (id: string) =>
    request<{ articleId: string; accessible: boolean }>(`/api/v1/marketplace/articles/${encodeURIComponent(id)}/access`).then(unwrap),
};

export const agentApi = {
  run: (
    body: { userId: string; intent: string; query: string; lessonId?: string },
    token?: string,
  ) =>
    request<any>(`/api/v1/agents/run`, "POST", body, {}, true, token ? { access_token: token } : undefined).then(unwrap),
  listTraces: (token?: string) =>
    request<any[]>(
      `/api/v1/agents/decision-trace/me`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
};

export const analyticsApi = {
  creatorMe: (token?: string) =>
    request<{ metrics: any[]; recentOrders: any[]; refundCount: number }>(
      `/api/v1/analytics/creator/me`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
  adminOverview: (token?: string) =>
    request<{
      totalUsers: number;
      totalCreators: number;
      totalContent: number;
      totalAgentDecisions: number;
      recentEngagement: any[];
    }>(
      `/api/v1/analytics/admin/overview`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
  topConcepts: (token?: string) =>
    request<Array<{ conceptId: string; title: string; learners: number; avgScore: number }>>(
      `/api/v1/analytics/admin/top-concepts`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
  recordEvent: (
    body: { action: string; entityId?: string; metadata?: Record<string, unknown> },
    token?: string,
  ) =>
    request<any>(
      `/api/v1/analytics/events`,
      "POST",
      body,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
};

export const simulatorApi = {
  listScenarios: (token?: string) =>
    request<{ slug: string; name: string; days: number }[]>(
      `/api/v1/simulator/scenarios`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
  create: (body: { scenarioSlug: string; days?: number }, token?: string) =>
    request<{ id: string }>(
      `/api/v1/simulator/companies`,
      "POST",
      body,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) as { id: string }),
  get: (id: string, token?: string) =>
    request<any>(
      `/api/v1/simulator/companies/${id}`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
  listEntries: (id: string, token?: string) =>
    request<any[]>(
      `/api/v1/simulator/companies/${id}/journal-entries`,
      "GET",
      undefined,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrapList),
  addEntry: (
    id: string,
    body: { date: string; debitAccount: string; creditAccount: string; amount: number; memo?: string },
    token?: string,
  ) =>
    request<any>(
      `/api/v1/simulator/companies/${id}/journal-entries`,
      "POST",
      body,
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
  closePeriod: (id: string, period: string, token?: string) =>
    request<{ snapshotHash: string }>(
      `/api/v1/simulator/companies/${id}/close-period`,
      "POST",
      { period },
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then((res) => unwrap(res) as { snapshotHash: string }),
  statements: (id: string, period: string, token?: string) =>
    request<{
      incomeStatement: any;
      balanceSheet: any;
      cashFlow: any;
      snapshotHash: string;
    }>(
      `/api/v1/simulator/companies/${id}/statements`,
      "POST",
      { period },
      {},
      true,
      token ? { access_token: token } : undefined,
    ).then(unwrap),
};

export function statusOf(err: any): number {
  const status = err?.response?.status ?? err?.statusCode ?? err?.status;
  return typeof status === "number" ? status : 0;
}

export function failureEnvelope<T>(err: any): ApiResponse<T> {
  const status = statusOf(err);
  const body = err?.data;
  return {
    success: false,
    message: typeof body?.message === "string" && body.message ? body.message : "Request failed",
    code: typeof body?.code === "string" ? (body.code as AppErrorCode) : undefined,
    data: null,
    meta: { statusCode: status, requestId: body?.meta?.requestId },
    error: kindFromStatus(status),
  };
}

export function normalizeEnvelope<T>(parsed: any, status: number): ApiResponse<T> {
  if (parsed && typeof parsed.success === "boolean") {
    if (!parsed.success && parsed.meta?.statusCode === undefined) {
      return { ...parsed, meta: { ...parsed.meta, statusCode: status } };
    }
    return parsed as ApiResponse<T>;
  }
  const ok = status >= 200 && status < 300;
  return {
    success: ok,
    message: typeof parsed?.message === "string" ? parsed.message : ok ? "OK" : "Request failed",
    data: parsed?.data ?? null,
    meta: { statusCode: status },
    error: ok ? undefined : kindFromStatus(status),
  };
}

export function relaySetCookies(res: { headers?: { getSetCookie?: () => string[] } }, event?: ServerEvent) {
  const cookies = res.headers?.getSetCookie?.() ?? [];
  if (cookies.length === 0) return;
  const nodeRes = (event ?? useRequestEvent())?.node?.res;
  if (!nodeRes) return;
  const existing = nodeRes.getHeader("set-cookie");
  const current = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  nodeRes.setHeader("set-cookie", [...current, ...cookies]);
}

type ServerEvent = {
  node?: { res?: { getHeader: (name: string) => unknown; setHeader: (name: string, value: string[]) => unknown } };
  context?: Record<string, unknown>;
};

export interface SsrContext {
  cookie: Record<string, string>;
  event: ServerEvent | undefined;
  apiUrl: string | undefined;
  tokens?: Tokens;
}

const REFRESHED_TOKENS_KEY = "rcRefreshedTokens";

export function rememberRefreshedTokens(event: ServerEvent | undefined, tokens: Tokens) {
  if (event?.context) event.context[REFRESHED_TOKENS_KEY] = tokens;
}

function recallRefreshedTokens(event: ServerEvent | undefined): Tokens | undefined {
  return event?.context?.[REFRESHED_TOKENS_KEY] as Tokens | undefined;
}

export function captureSsrContext(tokens?: Tokens): SsrContext {
  try {
    const event = useRequestEvent() as ServerEvent | undefined;
    const refreshed = tokens?.access_token ? undefined : recallRefreshedTokens(event);
    return {
      cookie: refreshed ? {} : forwardedCookie(tokens),
      event,
      apiUrl: getApiUrl(),
      tokens: refreshed,
    };
  } catch {
    return { cookie: {}, event: undefined, apiUrl: undefined };
  }
}

export function forwardedCookie(tokens?: Tokens): Record<string, string> {
  if (tokens?.access_token) return {};
  const cookie = useRequestHeaders(["cookie"]).cookie;
  return cookie ? { cookie } : {};
}

export async function request<T>(
  endpoint: string,
  method: HttpMethod = "GET",
  body?: any,
  headers: Record<string, string> = {},
  retry: boolean = true,
  tokens?: Tokens,
  ssrContext?: SsrContext,
): Promise<ApiResponse<T>> {
  const isServer = isServerRuntime();
  const ssr = isServer ? (ssrContext ?? captureSsrContext(tokens)) : undefined;
  const API_URL = ssr?.apiUrl ?? getApiUrl();
  const path = normalizeApiPath(endpoint);
  const canRetry = retry && path.split("?")[0] !== REFRESH_PATH;
  const cookieHeader = isServer ? ssr?.cookie?.cookie : typeof document !== "undefined" ? document.cookie : undefined;
  const sent = withStudioTenant(path, headers, cookieHeader);

  const bearer = tokens?.access_token ? tokens : (ssr?.tokens ?? tokens);
  const authHeaders: Record<string, string> = {};
  if (bearer?.access_token) authHeaders["Authorization"] = `Bearer ${bearer.access_token}`;
  if (bearer?.refresh_token) authHeaders["X-Refresh-Token"] = bearer.refresh_token;

  try {
    if (!isServer) {
      try {
        return await $fetch<ApiResponse<T>>(path, {
          baseURL: API_URL,
          method,
          headers: {
            "Content-Type": "application/json",
            ...sent,
          },
          credentials: "include",
          body: method !== "GET" && method !== "HEAD" ? body : undefined,
        });
      } catch (error: any) {
        if (statusOf(error) === 401 && canRetry) {
          const refreshed = await authService.refreshToken();
          if (refreshed.success) {
            return await request<T>(endpoint, method, body, sent, false);
          }
        }
        return failureEnvelope<T>(error);
      }
    }

    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(ssr?.cookie ?? {}),
        ...authHeaders,
        ...sent,
      },
      body:
        method !== "GET" && method !== "HEAD" && body
          ? JSON.stringify(body)
          : undefined,
    });
    relaySetCookies(res, ssr?.event);

    if (res.status === 401 && canRetry) {
      const refreshed = await authService.refreshToken(bearer, ssr);
      if (refreshed.success && refreshed.data) {
        const fresh = {
          access_token: refreshed.data.access_token,
          refresh_token: refreshed.data.refresh_token,
        };
        rememberRefreshedTokens(ssr?.event, fresh);
        return await request<T>(endpoint, method, body, sent, false, fresh, ssr && { ...ssr, cookie: {} });
      }
    }

    const parsed = await res.json().catch(() => null);
    return normalizeEnvelope<T>(parsed, res.status);
  } catch (err: any) {
    return failureEnvelope<T>(err);
  }
}

export function toQueryString(q: Query) {
  const params = new URLSearchParams();
  for (const key in q) {
    const value = q[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) params.append(key, value.join(","));
    else params.append(key, value.toString());
  }
  return params.toString();
}
