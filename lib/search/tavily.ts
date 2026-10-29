/**
 * Minimal server-side Tavily search client.
 *
 * Responsibilities: query construction, result normalization, dedup by URL,
 * timeouts, and explicit error handling. Validates its own API key at the
 * service boundary. Retrieved content is UNTRUSTED data — callers must never
 * treat it as instructions.
 *
 * Source classification is deliberately a two-step process: this module
 * assigns an initial classification based only on host identity (Composio /
 * third-party integration platforms / community). The research pipeline then
 * reclassifies results against the provider's own domain once established —
 * only hosts on that domain can earn "official-docs" or "developer-portal".
 */

import { classifySource, type SourceType } from "@/lib/search/classify";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Per-query retry on transient failure (429 / 5xx / timeout). */
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_RETRY_WAIT_MS = 8_000;

export type TavilyResult = {
  title: string;
  url: string;
  /** Snippet / extracted content. Untrusted. */
  content: string;
  /** Tavily relevance score (0..1) when provided. */
  score: number;
  /** Classified provenance. See lib/search/classify.ts. */
  sourceType: SourceType;
};

export class TavilyError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  constructor(
    message: string,
    readonly cause?: unknown,
    meta: { retryable?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = "TavilyError";
    this.retryable = meta.retryable ?? false;
    this.retryAfterMs = meta.retryAfterMs ?? null;
  }
}

export class MissingApiKeyError extends Error {
  constructor(key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = "MissingApiKeyError";
  }
}

export type SearchOptions = {
  maxResults?: number;
  /** Restrict to these domains (e.g. a provider's docs host). */
  includeDomains?: string[];
  timeoutMs?: number;
  /** Per-query attempts including the first (default 2). */
  maxAttempts?: number;
};

// Initial classification runs without a provider-domain hint — see module
// doc at the top of the file. The pipeline reclassifies once it has one.

/** Run a single Tavily search. Throws TavilyError on failure (no fabrication). */
/** Run a single Tavily search. Throws TavilyError on failure (no fabrication). */
export async function tavilySearch(
  query: string,
  opts: SearchOptions = {},
): Promise<TavilyResult[]> {
  const maxAttempts = Math.max(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await tavilySearchOnce(query, opts);
    } catch (err) {
      lastErr = err;
      // Only retry transient failures (rate limit / overload / timeout), and
      // only if attempts remain. Honor a server-suggested Retry-After delay.
      if (attempt >= maxAttempts || !isRetryable(err)) break;
      const waitMs = Math.min(retryAfterMs(err) ?? 750 * attempt, MAX_RETRY_WAIT_MS);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/** A single Tavily HTTP attempt. Retryable failures carry retry metadata. */
async function tavilySearchOnce(query: string, opts: SearchOptions): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("TAVILY_API_KEY");

  const maxResults = Math.min(Math.max(opts.maxResults ?? 5, 1), 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "advanced",
        include_answer: false,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 429 / 5xx are transient; tag them so the retry loop can act, capturing
      // any Retry-After header (seconds).
      const retryAfter = res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : null;
      throw new TavilyError(`Tavily returned ${res.status}: ${body.slice(0, 200)}`, undefined, {
        retryable: res.status === 429 || res.status >= 500,
        retryAfterMs: retryAfter,
      });
    }

    const json = (await res.json()) as { results?: unknown };
    return normalizeResults(json.results);
  } catch (err) {
    if (err instanceof TavilyError || err instanceof MissingApiKeyError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new TavilyError(`Tavily search timed out for query: ${query}`, err, { retryable: true });
    }
    throw new TavilyError(`Tavily search failed: ${(err as Error).message}`, err, { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null;
}

function isRetryable(err: unknown): boolean {
  return err instanceof TavilyError && err.retryable === true;
}

function retryAfterMs(err: unknown): number | null {
  return err instanceof TavilyError ? err.retryAfterMs ?? null : null;
}

/** Normalize raw Tavily results, dropping malformed entries and deduping by URL. */
export function normalizeResults(raw: unknown): TavilyResult[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TavilyResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : "";
    const title = typeof r.title === "string" ? r.title : "";
    if (!url || !title) continue;
    // Validate URL and dedup.
    try {
      new URL(url);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      content: typeof r.content === "string" ? r.content : "",
      score: typeof r.score === "number" ? r.score : 0,
      sourceType: classifySource(url),
    });
  }
  return out;
}

/**
 * Re-classify an existing result list against a provider's own domain(s).
 * Called by the pipeline once the provider domain has been established so
 * that only hosts on that domain can earn "official-docs"/"developer-portal".
 * Leaves everything else at its existing (domain-independent) classification.
 */
export function reclassifyResults(
  results: TavilyResult[],
  providerDomains: string[],
  providerName = "",
): TavilyResult[] {
  if (providerDomains.length === 0 && !providerName) return results;
  return results.map((r) => ({
    ...r,
    sourceType: classifySource(r.url, providerDomains, providerName),
  }));
}

/**
 * Run several queries with a hard cap on total searches, flattening and
 * deduping across all of them. Failures of individual queries are collected,
 * not silently swallowed.
 *
 * Queries run in small concurrent batches rather than all at once: firing 6
 * parallel requests tended to trip Tavily's rate limit simultaneously, so a
 * single burst could lose several queries at once. Batching plus per-query
 * retry keeps evidence coverage stable.
 */
export async function tavilySearchMany(
  queries: string[],
  opts: SearchOptions & { maxSearches?: number; concurrency?: number } = {},
): Promise<{ results: TavilyResult[]; errors: string[]; queriesRun: string[] }> {
  const cap = opts.maxSearches ?? 6;
  const toRun = queries.slice(0, cap);
  const batchSize = Math.max(opts.concurrency ?? 3, 1);

  const seen = new Set<string>();
  const results: TavilyResult[] = [];
  const errors: string[] = [];

  for (let start = 0; start < toRun.length; start += batchSize) {
    const batch = toRun.slice(start, start + batchSize);
    const settled = await Promise.allSettled(batch.map((q) => tavilySearch(q, opts)));
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        for (const r of s.value) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          results.push(r);
        }
      } else {
        errors.push(`"${batch[i]}": ${s.reason?.message ?? String(s.reason)}`);
      }
    });
  }
  return { results, errors, queriesRun: toRun };
}
