import type { TavilyResult } from "@/lib/search/tavily";
import { registrableHost, type SourceType } from "@/lib/search/classify";
import {
  normalizeProviderUrl,
  providerNameFromUrl,
} from "@/lib/util/text";

/**
 * Pure research helpers shared by the research graph. These used to live in
 * lib/research/pipeline.ts; they are kept framework-free so graph nodes and
 * tests can import them without pulling in LangGraph.
 */

export type NormalizedInput = {
  providerName: string;
  providerUrl: string;
  providerUrlFromInput: boolean;
};

/**
 * Normalize a raw provider-name-or-URL into a stable name + https URL.
 * Lifted from the two former pipelines (which each copied this block).
 * Returns null when the input is empty.
 */
export function normalizeInput(raw: string | undefined): NormalizedInput | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const looksLikeUrl = /\.[a-z]{2,}(\/|$|\?|:)/i.test(trimmed) || /^https?:\/\//i.test(trimmed);
  let providerUrl = normalizeProviderUrl(trimmed);
  let providerName: string;
  let providerUrlFromInput = false;

  if (looksLikeUrl && providerUrl) {
    providerName = providerNameFromUrl(providerUrl);
    providerUrlFromInput = true;
  } else {
    providerName = trimmed;
    providerUrl = providerUrl ?? `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }

  return { providerName, providerUrl, providerUrlFromInput };
}

/** Targeted queries: official OAuth setup, app registration, scopes, verification, Composio. */
export function buildQueries(provider: string): string[] {
  return [
    `${provider} OAuth app setup developer documentation`,
    `${provider} register OAuth application client id redirect URI`,
    `${provider} OAuth scopes permissions API`,
    `${provider} OAuth app verification or production approval requirements how long review time`,
    `${provider} developer portal official documentation`,
  ];
}

const SOURCE_RANK: Record<SourceType, number> = {
  "official-docs": 5,
  "developer-portal": 5,
  "composio-docs": 3,
  "third-party-integration": 1,
  community: 0,
  unknown: 0,
};

export function rankEvidence(results: TavilyResult[]): TavilyResult[] {
  return [...results].sort(
    (a, b) => SOURCE_RANK[b.sourceType] - SOURCE_RANK[a.sourceType] || b.score - a.score,
  );
}

/**
 * Determine the provider's registrable domain(s) from the user input and
 * retrieved evidence. Returns an array ordered by confidence (most-cited
 * matching host first). Multi-domain support exists because providers often
 * span registrable domains ("Kite Connect (Zerodha)" → kite.trade AND
 * zerodha.com).
 */
export function determineProviderDomains(
  providerName: string,
  providerUrl: string,
  evidence: TavilyResult[],
  providerUrlFromInput: boolean,
): string[] {
  if (providerUrlFromInput) {
    try {
      return [registrableHost(new URL(providerUrl).hostname)];
    } catch {
      /* fall through */
    }
  }

  const collapsed = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!collapsed) return [];
  // Generic platform words must NOT qualify a domain on their own — e.g. the
  // token "apis" from "Google APIs" otherwise matched the unrelated apis.io and
  // got trusted as a Google domain. The full collapsed name ("googleapis") is
  // still a needle; only the standalone generic fragments are dropped.
  const GENERIC_TOKENS = new Set([
    "api", "apis", "app", "apps", "cloud", "dev", "developer", "developers",
    "docs", "data", "web", "io", "inc", "the", "oauth", "auth", "platform",
    "connect", "integration", "integrations", "sdk", "console", "portal",
  ]);
  const tokens = providerName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
  const needles = new Set<string>([collapsed, ...tokens]);

  const hostCounts = new Map<string, number>();
  for (const r of evidence) {
    if (r.sourceType === "third-party-integration" || r.sourceType === "community") continue;
    let host: string;
    try {
      host = new URL(r.url).hostname;
    } catch {
      continue;
    }
    const root = registrableHost(host);
    const rootKey = root.replace(/[^a-z0-9]/g, "");
    const matches = [...needles].some((n) => n && rootKey.includes(n));
    if (!matches) continue;
    hostCounts.set(root, (hostCounts.get(root) ?? 0) + 1);
  }
  if (hostCounts.size === 0) return [];
  return [...hostCounts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

/** Backward-compat singular wrapper used by existing tests. */
export function determineProviderDomain(
  providerName: string,
  providerUrl: string,
  evidence: TavilyResult[],
  providerUrlFromInput: boolean,
): string | null {
  return (
    determineProviderDomains(providerName, providerUrl, evidence, providerUrlFromInput)[0] ?? null
  );
}
