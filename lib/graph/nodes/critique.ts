import type { GraphStateType } from "@/lib/graph/state";
import { critiqueGuide } from "@/lib/graph/critique";
import { buildFactLedger } from "@/lib/graph/facts";

/**
 * Build the fact ledger from structured retrieval signals, score the draft for
 * completeness AND semantic consistency against that ledger, record the
 * unresolved high-impact field paths (with reasons) for targeted recovery, and
 * bump the loop counter.
 */
export function critiqueNode(state: GraphStateType): Partial<GraphStateType> {
  if (state.error || !state.draftGuide) return {};

  // Ledger here uses evidence URLs as ids (grounding assigns final ids later);
  // the critic only needs values/status/reasons, not the final id mapping.
  const evidenceIdByUrl = new Map(state.evidence.map((e) => [e.url, e.url]));
  const facts = buildFactLedger({
    oauthMetadata: state.oauthMetadata,
    endpointHits: state.endpointHits,
    findings: state.findings,
    providerDomains: state.providerDomains,
    evidenceIdByUrl,
  });

  const critique = critiqueGuide(state.draftGuide, facts);

  // Unresolved high-impact fields → feed recovery with their failure reason so
  // the planner changes STRATEGY per reason rather than repeating queries.
  const unresolvedFields = critique.failures
    .filter((f) => f.severity !== "warn" || f.reason === "not_found_in_retrieved_evidence")
    .map((f) => ({ fieldPath: f.fieldPath, reason: f.reason }));

  return { critique, facts, unresolvedFields, loopCount: state.loopCount + 1 };
}
