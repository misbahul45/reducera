import type { ApiResponse, Tokens } from "~/interfaces/api";
import { authService } from "~/services/auth";
import { captureSsrContext, failureEnvelope, normalizeEnvelope, relaySetCookies, rememberRefreshedTokens, statusOf } from "~/lib/api";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "PATCH";

const AI_PREFIX = "/ai/v1";

export function getAiApiUrl() {
  const config = useRuntimeConfig();
  if (typeof window === "undefined") {
    return config.aiInternalUrl || config.public.AI_URL;
  }
  return config.public.AI_URL;
}

export function normalizeAiPath(endpoint: string) {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    try {
      const parsed = new URL(endpoint);
      endpoint = parsed.pathname + parsed.search;
    } catch {
      return endpoint;
    }
  }
  if (endpoint.startsWith(AI_PREFIX)) return endpoint;
  return `${AI_PREFIX}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

export function aiUrl(path: string) {
  return `${getAiApiUrl()}${normalizeAiPath(path)}`;
}

export async function requestAi<T>(
  endpoint: string,
  method: HttpMethod = "GET",
  body?: any,
  headers: Record<string, string> = {},
  retry = true,
  tokens?: Tokens
): Promise<ApiResponse<T>> {
  const AI_URL = getAiApiUrl();
  const path = normalizeAiPath(endpoint);
  const isServer = typeof window === "undefined";

  try {
    if (!isServer) {
      try {
        const parsed = await $fetch<unknown>(path, {
          baseURL: AI_URL,
          method,
          body: method !== "GET" && method !== "HEAD" ? body : undefined,
          headers: { "Content-Type": "application/json", ...headers },
          credentials: "include",
        });
        return normalizeEnvelope<T>(parsed, 200);
      } catch (error: any) {
        if (retry && statusOf(error) === 401) {
          const refreshed = await authService.refreshToken();
          if (refreshed.success) return await requestAi<T>(endpoint, method, body, headers, false);
        }
        return failureEnvelope<T>(error);
      }
    }

    const ssr = captureSsrContext(tokens);
    const bearer = tokens?.access_token ? tokens : ssr.tokens;
    const authHeaders: Record<string, string> = bearer?.access_token ? { Authorization: `Bearer ${bearer.access_token}` } : {};
    const res = await fetch(`${AI_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...ssr.cookie,
        ...authHeaders,
        ...headers,
      },
      body: method !== "GET" && method !== "HEAD" && body ? JSON.stringify(body) : undefined,
    });
    relaySetCookies(res, ssr.event);

    if (res.status === 401 && retry) {
      const refreshed = await authService.refreshToken(bearer, ssr);
      if (refreshed.success && refreshed.data) {
        const fresh = {
          access_token: refreshed.data.access_token,
          refresh_token: refreshed.data.refresh_token,
        };
        rememberRefreshedTokens(ssr.event, fresh);
        return await requestAi<T>(endpoint, method, body, headers, false, fresh);
      }
    }

    return normalizeEnvelope<T>(await res.json().catch(() => null), res.status);
  } catch (err: any) {
    return failureEnvelope<T>(err);
  }
}
