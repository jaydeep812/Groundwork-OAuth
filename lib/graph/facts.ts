import type { Finding, NormalizedFact, FactStatus, RetrievalMethod } from "@/lib/schema/guide";
import type { OAuthMetadata } from "@/lib/research/oauth-metadata";
import type { EndpointHit } from "@/lib/research/endpoint-extract";
import type { TavilyResult } from "@/lib/search/tavily";
import { hostIsOnDomain } from "@/lib/search/classify";

/**
 * The deterministic fact ledger. Builds a normalized, evidence-backed
 * NormalizedFact[] from the structured retrieval signals and findings the
 * research graph actually collected — NEVER from the model.
 *
 * Resolution rules (from the spec):
 *  - A field established by authoritative docs / provider metadata is `verified`
 *    and must NOT be downgraded to unknown because a different method failed.
 *  - A live HTTP probe `observes` that an endpoint exists; it does not by itself
 *    `verify` the request/response contract.
 *  - A URL being retrieved does not establish a fact about its contents.
 *  - Conflicting authoritative values are recorded as `conflicting`, keeping
 *    every competing value + source.
 *  - A missing value is `unknown` with an `unresolvedReason`, never a fabricated
 *    value, and an absent catalog entry/search hit is not proof of absence.
 *
 * Precedence for a single field (highest wins; equal values merge provenance):
 *   oauth-metadata  >  official-docs endpoint extraction  >  on-domain probe
 * Differing values across authoritative sources => `conflicting`.
 */

/** High-impact fields the ledger always reasons about (resolved or unresolved). */
export const LEDGER_FIELDS = [
  "implementation.authorizeUrl",
  "implementation.tokenUrl",
  "implementation.revokeUrl",
  "implementation.developerPortalUrl",
  "implementation.pkce.supported",
  "implementation.pkce.required",
] as const;

type Draft = {
  fieldPath: string;
  value: string | number | boolean | null;
  status: FactStatus;
  evidenceRefs: string[];
  findingIds: string[];
  sourceExcerpt: string;
  appliesTo: string;
  retrievalMethod: RetrievalMethod;
  retrievedAt: string;
  conflicts: { value: string | number | boolean; evidenceRefs: string[]; note: string }[];
  unresolvedReason: NormalizedFact["unresolvedReason"];
};

/** Rank of a retrieval method as a source of truth (higher = more authoritative). */
function rank(method: RetrievalMethod): number {
  switch (method) {
    case "oauth-metadata":
      return 4;
    case "official-docs":
      return 3;
    case "http-probe":
      return 2;
    case "catalog-probe":
      return 2;
    case "search-result":
      return 1;
    default:
      return 0;
  }
}

/** Status implied by a retrieval method when it supplies a value. */
function statusFor(method: RetrievalMethod): FactStatus {
  if (method === "oauth-metadata" || method === "official-docs") return "verified";
  if (method === "http-probe" || method === "catalog-probe") return "observed";
  if (method === "search-result") return "inferred";
  return "unknown";
}

type Candidate = {
  fieldPath: string;
  value: string | number | boolean;
  method: RetrievalMethod;
  evidenceRefs: string[];
  findingIds: string[];
  excerpt: string;
  appliesTo?: string;
  retrievedAt: string;
};

/**
 * Build the ledger. `evidenceIdByUrl` maps a retrieved URL to the EvidenceRef id
 * the grounded guide will use, so facts cite the SAME ids the guide renders.
 */
export function buildFactLedger(input: {
  oauthMetadata: OAuthMetadata | null;
  endpointHits: EndpointHit[];
  findings: Finding[];
  providerDomains: string[];
  evidenceIdByUrl: Map<string, string>;
  now?: string;
}): NormalizedFact[] {
  const now = input.now ?? new Date().toISOString();
  const evId = (url: string) => input.evidenceIdByUrl.get(url);
  const candidates: Candidate[] = [];

  // Link ledger facts back to the deterministic probe/extraction Findings by
  // agent name, so every metadata/endpoint fact carries a backing note id.
  const metadataFindingId = input.findings.find(
    (f) => f.agent === "oauth-metadata-probe" && f.outcome === "confirmed",
  )?.id;
  const endpointFindingId = input.findings.find(
    (f) => f.agent === "endpoint-extract" && f.outcome === "confirmed",
  )?.id;

  // --- (1) provider .well-known OAuth metadata: the most authoritative source
  const m = input.oauthMetadata;
  if (m) {
    const metaRef = evId(m.sourceUrl);
    const refs = metaRef ? [metaRef] : [];
    const findingIds = metadataFindingId ? [metadataFindingId] : [];
    const push = (fieldPath: string, value: string | boolean, excerpt?: string) =>
      candidates.push({
        fieldPath,
        value,
        method: "oauth-metadata",
        evidenceRefs: refs,
        findingIds,
        excerpt: excerpt ?? `From ${m.sourceUrl}`,
        retrievedAt: now,
      });
    if (m.authorizeUrl) push("implementation.authorizeUrl", m.authorizeUrl, `authorization_endpoint: ${m.authorizeUrl} (from ${m.sourceUrl})`);
    if (m.tokenUrl) push("implementation.tokenUrl", m.tokenUrl, `token_endpoint: ${m.tokenUrl} (from ${m.sourceUrl})`);
    if (m.revokeUrl) push("implementation.revokeUrl", m.revokeUrl, `revocation_endpoint: ${m.revokeUrl} (from ${m.sourceUrl})`);
    if (m.registrationUrl) push("implementation.developerPortalUrl", m.registrationUrl, `registration_endpoint: ${m.registrationUrl} (from ${m.sourceUrl})`);
    // Supported scopes: the server's advertised catalog (RFC 8414), NOT the
    // integration's required set. Stored as a serialized list; reconcile splits
    // it back and merges NAMES into supportedScopes without touching the
    // model's use-case recommendations. Only when the field was present.
    if (m.supportedScopes && m.supportedScopes.length > 0) {
      push(
        "implementation.supportedScopes",
        serializeScopes(m.supportedScopes),
        `scopes_supported: ${m.supportedScopes.join(" ")} (from ${m.sourceUrl})`,
      );
    }
    // PKCE: metadata advertising code_challenge_methods means SUPPORTED, not
    // required. Absence is NOT proof of non-support — leave `required` unknown.
    if (m.pkce === "supported") {
      push(
        "implementation.pkce.supported",
        true,
        `code_challenge_methods_supported: ${(m.pkceMethods ?? []).join(" ")} (from ${m.sourceUrl})`,
      );
    }
  }

  // --- (2) literal endpoint URLs extracted from an official doc page
  for (const hit of input.endpointHits) {
    const onDomain = isOnDomain(hit.url, input.providerDomains);
    const fieldPath =
      hit.kind === "authorize"
        ? "implementation.authorizeUrl"
        : hit.kind === "token"
          ? "implementation.tokenUrl"
          : "implementation.revokeUrl";
    candidates.push({
      fieldPath,
      value: hit.url,
      // On the provider's own domain → authoritative docs; off-domain → a weaker
      // search-grade signal (don't treat a third-party page as official).
      method: onDomain ? "official-docs" : "search-result",
      evidenceRefs: evId(hit.url) ? [evId(hit.url)!] : [],
      findingIds: endpointFindingId ? [endpointFindingId] : [],
      excerpt: `Endpoint URL extracted from provider documentation page`,
      retrievedAt: now,
    });
  }

  // --- (3) findings: live probes (observed) + portal/catalog facts
  for (const f of input.findings) {
    // auth-endpoint-agent probes confirm an endpoint is REACHABLE (observed).
    if (f.agent === "auth-endpoint-agent" && f.outcome === "confirmed") {
      for (const e of f.evidence) {
        if (!isOnDomain(e.url, input.providerDomains)) continue;
        const kind = /token|access_?token/i.test(e.url)
          ? "implementation.tokenUrl"
          : /authoriz/i.test(e.url)
            ? "implementation.authorizeUrl"
            : null;
        if (!kind) continue;
        candidates.push({
          fieldPath: kind,
          value: e.url,
          method: "http-probe",
          evidenceRefs: evId(e.url) ? [evId(e.url)!] : [],
          findingIds: [f.id],
          excerpt: f.observation || f.conclusion,
          retrievedAt: f.at,
        });
      }
    }
    // portal-agent confirms the developer portal URL is live.
    if (f.agent === "portal-agent" && f.outcome === "confirmed") {
      for (const e of f.evidence) {
        candidates.push({
          fieldPath: "implementation.developerPortalUrl",
          value: e.url,
          method: isOnDomain(e.url, input.providerDomains) ? "official-docs" : "search-result",
          evidenceRefs: evId(e.url) ? [evId(e.url)!] : [],
          findingIds: [f.id],
          excerpt: f.conclusion,
          retrievedAt: f.at,
        });
      }
    }
  }

  // --- resolve each field from its candidates
  const byField = new Map<string, Candidate[]>();
  for (const c of candidates) {
    // Normalize endpoint URLs to the bare endpoint (strip inline request params)
    // so a doc example like ".../authorize?response_type=code" resolves to the
    // copyable endpoint, not a malformed URL.
    c.value = normalizeEndpointValue(c.fieldPath, c.value);
    const arr = byField.get(c.fieldPath) ?? [];
    arr.push(c);
    byField.set(c.fieldPath, arr);
  }

  const facts: NormalizedFact[] = [];
  for (const [fieldPath, cands] of byField) {
    facts.push(resolveField(fieldPath, cands));
  }

  // --- emit honest `unknown` facts for high-impact fields nothing established,
  // so downstream (critic, synthesis, UI) can see the gap and its reason.
  for (const fieldPath of LEDGER_FIELDS) {
    if (byField.has(fieldPath)) continue;
    facts.push({
      fieldPath,
      value: null,
      status: "unknown",
      evidenceRefs: [],
      findingIds: [],
      sourceExcerpt: "",
      appliesTo: "",
      retrievalMethod: "unknown",
      retrievedAt: now,
      conflicts: [],
      unresolvedReason: "not_found_in_retrieved_evidence",
    });
  }

  return facts;
}

/** Resolve one field's competing candidates into a single NormalizedFact. */
function resolveField(fieldPath: string, cands: Candidate[]): NormalizedFact {
  // Group by distinct value (normalized).
  const byValue = new Map<string, Candidate[]>();
  for (const c of cands) {
    const key = String(c.value).trim().replace(/\/+$/, "");
    const arr = byValue.get(key) ?? [];
    arr.push(c);
    byValue.set(key, arr);
  }

  const distinct = [...byValue.entries()];
  // Highest-authority candidate overall.
  const best = cands.reduce((a, b) => (rank(b.method) > rank(a.method) ? b : a));

  // Conflict: two or more DISTINCT values are each backed by an authoritative
  // source (metadata/official-docs). A weaker value differing from a strong one
  // is NOT a conflict — the strong one wins.
  const authoritativeValues = distinct.filter(([, cs]) =>
    cs.some((c) => rank(c.method) >= 3),
  );
  const isConflict = authoritativeValues.length >= 2;

  const mergedRefs = (cs: Candidate[]) => Array.from(new Set(cs.flatMap((c) => c.evidenceRefs)));
  const mergedFindings = (cs: Candidate[]) => Array.from(new Set(cs.flatMap((c) => c.findingIds)));

  if (isConflict) {
    return {
      fieldPath,
      value: best.value,
      status: "conflicting",
      evidenceRefs: mergedRefs(cands),
      findingIds: mergedFindings(cands),
      sourceExcerpt: best.excerpt,
      appliesTo: best.appliesTo ?? "",
      retrievalMethod: best.method,
      retrievedAt: best.retrievedAt,
      conflicts: authoritativeValues.map(([v, cs]) => ({
        value: coerce(v),
        evidenceRefs: mergedRefs(cs),
        note: cs[0].method,
      })),
      unresolvedReason: "source_conflict",
    };
  }

  // Consensus / clear winner: merge provenance from every candidate that agrees
  // with the winning value.
  const winningKey = String(best.value).trim().replace(/\/+$/, "");
  const agreeing = byValue.get(winningKey) ?? [best];
  return {
    fieldPath,
    value: best.value,
    status: statusFor(best.method),
    evidenceRefs: mergedRefs(agreeing),
    findingIds: mergedFindings(agreeing),
    sourceExcerpt: best.excerpt,
    appliesTo: best.appliesTo ?? "",
    retrievalMethod: best.method,
    retrievedAt: best.retrievedAt,
    conflicts: [],
    unresolvedReason: null,
  };
}

function coerce(s: string): string | number | boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  return s;
}

/** Ledger `value` is scalar, so a scope list is stored as a single space-joined
 * string. These two helpers are the ONLY place that encoding lives, so the
 * fact producer (facts.ts) and consumer (reconcile.ts) can't drift. */
export function serializeScopes(scopes: string[]): string {
  return scopes.map((s) => s.trim()).filter(Boolean).join(" ");
}
export function parseScopes(value: string | number | boolean | null): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(/\s+/).filter(Boolean);
}

/** Endpoint field paths whose values are URLs and must be stored bare (no query
 * string / fragment — those are request parameters, not the endpoint). */
const URL_FIELDS = new Set([
  "implementation.authorizeUrl",
  "implementation.tokenUrl",
  "implementation.revokeUrl",
  "implementation.developerPortalUrl",
]);

/** Strip query/fragment from an endpoint URL; leave non-URL values untouched. */
function normalizeEndpointValue(fieldPath: string, value: string | number | boolean): string | number | boolean {
  if (!URL_FIELDS.has(fieldPath) || typeof value !== "string") return value;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function isOnDomain(url: string, domains: string[]): boolean {
  try {
    const h = new URL(url).hostname;
    return domains.some((d) => hostIsOnDomain(h, d));
  } catch {
    return false;
  }
}

/** Look up a resolved fact by field path. */
export function factFor(facts: NormalizedFact[], fieldPath: string): NormalizedFact | undefined {
  return facts.find((f) => f.fieldPath === fieldPath);
}
