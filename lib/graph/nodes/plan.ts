import type { GraphStateType } from "@/lib/graph/state";
import { buildQueries } from "@/lib/research/helpers";
import { generateObjectLC } from "@/lib/graph/llm";

/**
 * Query planner.
 *
 * Loop 0: seed with the standard base queries plus a few implementation-
 * targeted ones (endpoints, scopes, rate limits).
 *
 * Re-plan loops: recovery is driven by WHY each important field is unresolved,
 * not by blindly re-searching the field name. A missing field searches the
 * provider's official docs for it; a source conflict searches for the
 * authoritative passage; a field with no authoritative source broadens to the
 * official auth docs. This changes retrieval STRATEGY per reason so we never
 * append a near-identical failed query.
 */

/** Map a field path to a human label for query phrasing. */
const FIELD_LABEL: Record<string, string> = {
  "implementation.authorizeUrl": "OAuth authorization endpoint URL",
  "implementation.tokenUrl": "OAuth token endpoint URL",
  "implementation.revokeUrl": "OAuth token revocation endpoint",
  "implementation.developerPortalUrl": "developer portal OAuth app registration",
  "implementation.pkce.supported": "OAuth PKCE code_challenge support",
  "implementation.pkce.required": "whether PKCE is required for OAuth",
  "implementation.redirectUriRule": "OAuth redirect URI requirements",
};

/** Turn one unresolved field + reason into a targeted query (strategy varies). */
export function recoveryQuery(provider: string, fieldPath: string, reason: string): string {
  const label = FIELD_LABEL[fieldPath] ?? fieldPath.split(".").pop() ?? fieldPath;
  switch (reason) {
    case "source_conflict":
      return `${provider} official documentation ${label} exact value`;
    case "no_authoritative_source_found":
      return `${provider} official OAuth 2.0 authentication documentation ${label}`;
    case "contradiction":
    case "misrepresented-confidence":
      return `${provider} developer docs ${label}`;
    default: // not_found_in_retrieved_evidence / unsupported-claim
      return `${provider} developer documentation ${label}`;
  }
}

export async function planNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (state.error) return {};

  // First pass: deterministic, no model call needed.
  if (state.loopCount === 0) {
    const base = buildQueries(state.providerName);
    const impl = [
      `${state.providerName} OAuth authorize endpoint and token endpoint URL`,
      `${state.providerName} API rate limits requests per second`,
    ];
    return { plannedQueries: [...base, ...impl] };
  }

  // Re-plan pass: strategy per failure reason. Prefer the structured unresolved
  // field list (from the critic) over the coarse `missing` labels.
  const unresolved = state.unresolvedFields ?? [];
  if (unresolved.length > 0) {
    const seen = new Set<string>();
    const queries: string[] = [];
    for (const u of unresolved) {
      const q = recoveryQuery(state.providerName, u.fieldPath, u.reason);
      if (seen.has(q)) continue; // never repeat an identical query
      seen.add(q);
      queries.push(q);
      if (queries.length >= 4) break;
    }
    if (queries.length > 0) return { plannedQueries: queries };
  }

  // Fallback: the critic's coarse missing labels.
  const missing = state.critique?.missing ?? [];
  if (missing.length === 0) return { plannedQueries: [] };
  const fallback = missing.slice(0, 4).map((m) => `${state.providerName} ${m}`);

  try {
    const result = await generateObjectLC<{ queries: string[] }>({
      system:
        "You generate precise web-search queries to fill specific gaps in an OAuth integration guide. Output ONLY JSON: {\"queries\": string[]}. Each query targets one missing fact for the named provider from its OFFICIAL documentation. 2-4 queries. No markdown.",
      prompt: `PROVIDER: ${state.providerName}\nPROVIDER DOMAIN(S): ${
        state.providerDomains.join(", ") || "unknown"
      }\nMISSING FACTS:\n${missing.map((m) => `- ${m}`).join("\n")}\n\nReturn targeted search queries to find these specific facts in the provider's official docs.`,
      maxOutputTokens: 512,
    });
    const queries = Array.isArray(result.queries)
      ? result.queries.filter((q) => typeof q === "string" && q.trim()).slice(0, 4)
      : [];
    return { plannedQueries: queries.length > 0 ? queries : fallback };
  } catch {
    return { plannedQueries: fallback };
  }
}
