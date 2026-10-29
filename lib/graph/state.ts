import { Annotation } from "@langchain/langgraph";
import type { GeneratedGuide, Finding, NormalizedFact } from "@/lib/schema/guide";
import type { TavilyResult } from "@/lib/search/tavily";
import type { Critique } from "@/lib/graph/critique";
import type { OAuthMetadata } from "@/lib/research/oauth-metadata";
import type { EndpointHit } from "@/lib/research/endpoint-extract";

/**
 * Shared state for the OAuth research graph:
 *   normalize → plan → search → investigate → synthesize → critique → (loop | persist)
 *
 * Reducers: `evidence`/`findings`/`warnings` accumulate across loops; the
 * `evidence` reducer also dedupes by URL. All other scalar fields replace.
 */

function dedupeByUrl(current: TavilyResult[], incoming: TavilyResult[]): TavilyResult[] {
  const seen = new Set(current.map((r) => r.url));
  const out = [...current];
  for (const r of incoming) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

export const GraphState = Annotation.Root({
  // --- inputs (set once by normalize) ---
  providerNameOrUrl: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  useCase: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),

  providerName: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  providerUrl: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  providerUrlFromInput: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  providerDomains: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  // --- working set ---
  plannedQueries: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  evidence: Annotation<TavilyResult[]>({
    reducer: (a, b) => dedupeByUrl(a ?? [], b ?? []),
    default: () => [],
  }),
  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),

  draftGuide: Annotation<GeneratedGuide | null>({ reducer: (_, b) => b, default: () => null }),
  critique: Annotation<Critique | null>({ reducer: (_, b) => b, default: () => null }),
  loopCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  // --- structured retrieval signals (set on loop 0, authoritative for facts) ---
  /** Provider's own .well-known OAuth/OIDC metadata, when published. */
  oauthMetadata: Annotation<OAuthMetadata | null>({ reducer: (_, b) => b, default: () => null }),
  /** Literal endpoint URLs extracted from a provider doc page. */
  endpointHits: Annotation<EndpointHit[]>({ reducer: (_, b) => b, default: () => [] }),
  /** Documented access-token lifetime (seconds) parsed from a token-response
   * example (expires_in) in official docs. Fed into the ledger as verified. */
  extractedTokenLifetimeSeconds: Annotation<number | null>({ reducer: (_, b) => b, default: () => null }),

  // --- canonical fact ledger (built deterministically before synthesis) ---
  facts: Annotation<NormalizedFact[]>({ reducer: (_, b) => b, default: () => [] }),
  /** Field paths the critic/resolution flagged as unresolved high-impact gaps,
   * fed into the next re-plan with their failure reason. */
  unresolvedFields: Annotation<Array<{ fieldPath: string; reason: string }>>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // --- outputs ---
  slug: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  error: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  stage: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  warnings: Annotation<string[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
  searchErrors: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
});

export type GraphStateType = typeof GraphState.State;

/** Max reflection loops the critic may trigger. */
export const MAX_LOOPS = 2;
