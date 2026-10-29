import type { GraphStateType } from "@/lib/graph/state";
import { Guide } from "@/lib/schema/guide";
import { reclassifyResults } from "@/lib/search/tavily";
import { groundGuide, type EvidenceOut } from "@/lib/graph/ground";
import { getGuideBySlug, slugExists, upsertGuide } from "@/lib/db/guides";
import { randomId, slugify } from "@/lib/util/text";
import { buildAgentPrompt } from "@/lib/guide/agent-prompt";
import { buildJourney } from "@/lib/guide/oauth-journey";
import { backfillGuide } from "@/lib/guide/backfill";
import { buildFactLedger } from "@/lib/graph/facts";
import { reconcileWithLedger, deriveManagedAuth } from "@/lib/graph/reconcile";
import { orderSetupSteps } from "@/lib/guide/workflow-order";

/**
 * Ground the draft against actually-retrieved evidence + findings, build the
 * canonical fact ledger, reconcile the guide against it (so all sections agree
 * on the same OAuth values), embed findings + managed-auth metadata, assemble
 * server-controlled fields, validate the full Guide, and persist. Terminal node.
 */
export async function persistNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (state.error) return {};
  if (!state.draftGuide) {
    return { error: "No guide was produced.", stage: "synthesis" };
  }

  const evidence = reclassifyResults(state.evidence, state.providerDomains, state.providerName);
  const draft = state.draftGuide as typeof state.draftGuide & { evidence: EvidenceOut[] };

  const grounded = groundGuide(draft, evidence, state.findings);
  const warnings = [...grounded.warnings];
  if (state.searchErrors.length) {
    warnings.push(`${state.searchErrors.length} search quer(ies) failed.`);
  }

  // Deterministic source-to-field backfill: fill developerPortalUrl from the
  // grounded on-domain evidence when the model left it null (fixes the
  // "not established despite evidence" bug). Never invents a URL.
  const { draft: backfilled, filled } = backfillGuide(
    state.draftGuide,
    grounded.evidence,
    state.providerDomains,
  );
  if (filled.length) warnings.push(`Backfilled from evidence: ${filled.join(", ")}.`);

  // Build the canonical fact ledger from the STRUCTURED retrieval signals +
  // findings, citing the same evidence ids the grounded guide renders.
  const evidenceIdByUrl = new Map(grounded.evidence.map((e) => [e.url, e.id]));
  const facts = buildFactLedger({
    oauthMetadata: state.oauthMetadata,
    endpointHits: state.endpointHits,
    findings: state.findings,
    providerDomains: state.providerDomains,
    evidenceIdByUrl,
  });

  // Reconcile: the ledger is authoritative over the model's implementation pack
  // so every section reflects the same values; never fabricates a value.
  const { guide: reconciled, changed } = reconcileWithLedger(backfilled, facts, {
    tokenLifetimeSeconds: state.extractedTokenLifetimeSeconds,
  });
  if (changed.length) warnings.push(`Reconciled from fact ledger: ${changed.join(", ")}.`);

  // Canonical workflow order: the model emits setup steps per category, but the
  // Setup checklist must follow the ONE canonical OAuth sequence (register →
  // configure → authorize → exchange → store → verify → approve) so it never
  // contradicts the deterministic Technical walkthrough. Sort deterministically
  // here, at build time, so every consumer (UI, journey, brief) reads the same
  // order from storage. Never drops or invents a step.
  const orderedSteps = orderSetupSteps(reconciled.setupSteps);
  const reorderedCount = orderedSteps.filter((s, idx) => s !== reconciled.setupSteps[idx]).length;
  if (reorderedCount > 0) {
    warnings.push(`Reordered ${reorderedCount} setup step(s) into canonical workflow sequence.`);
  }
  const reconciledOrdered = { ...reconciled, setupSteps: orderedSteps };

  const managedAuth = deriveManagedAuth(state.findings);

  const slug = await uniqueSlug(slugify(state.draftGuide.providerName || state.providerName));
  const now = new Date().toISOString();

  // Guard: never persist a providerUrl that doesn't belong to the provider.
  const safeProviderUrl =
    state.providerUrlFromInput || state.providerDomains[0]
      ? state.providerUrl
      : `https://www.google.com/search?q=${encodeURIComponent(state.providerName)}`;

  const guideCandidate = {
    ...reconciledOrdered,
    providerUrl: safeProviderUrl,
    evidence: grounded.evidence,
    findings: state.findings,
    facts,
    managedAuth,
    // Echo the developer's stated use case so the UI can prioritize capabilities
    // and the brief can tailor to it. Server-set, never model-authored.
    useCase: state.useCase ?? "",
    // Deterministic brief for coding agents — the custom OAuth flow, facts only.
    agentPrompt: buildAgentPrompt(reconciledOrdered, state.useCase),
    // The custom OAuth readiness walkthrough (7 stages, PKCE-gated).
    journey: buildJourney(reconciledOrdered),
    id: randomId("guide"),
    slug,
    lastResearchedAt: now,
    status: "generated" as const,
  };

  const finalParsed = Guide.safeParse(guideCandidate);
  if (!finalParsed.success) {
    return {
      error: `Assembled guide failed final validation: ${finalParsed.error.issues[0]?.message}`,
      stage: "validation",
      warnings,
    };
  }

  try {
    const saved = await upsertGuide(finalParsed.data);
    return { slug: saved.slug, warnings };
  } catch (err) {
    return { error: `Failed to persist guide: ${(err as Error).message}`, stage: "persist", warnings };
  }
}

async function uniqueSlug(base: string): Promise<string> {
  const safe = base || "provider";
  if (!(await slugExists(safe)) && !(await getGuideBySlug(safe))) return safe;
  return `${safe}-${randomId("x").split("_")[1]?.slice(0, 6) ?? "gen"}`;
}
