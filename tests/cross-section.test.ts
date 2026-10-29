import { describe, it, expect } from "vitest";
import { reconcileWithLedger } from "@/lib/graph/reconcile";
import { buildAgentPrompt } from "@/lib/guide/agent-prompt";
import { buildJourney } from "@/lib/guide/oauth-journey";
import type { GeneratedGuide, NormalizedFact } from "@/lib/schema/guide";

/**
 * Cross-section consistency: after the fact ledger is reconciled onto the
 * guide, the implementation pack, the agent brief, and the OAuth journey must
 * all reflect the SAME canonical endpoint values. This guards the failure mode
 * where the overview said one thing and the brief/checklist said another.
 */

function guideWithNullEndpoints(): GeneratedGuide {
  return {
    providerName: "Acme", providerUrl: "https://acme.com", description: "d",
    recommendedPath: "custom-oauth", pathRationale: "r",
    difficulty: { rating: "moderate", rationale: "r", findingIds: [] },
    activeEffort: { kind: "estimate", value: 2, unit: "hours", rationale: "e", evidenceIds: [], findingIds: [] },
    externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "r", evidenceIds: [], findingIds: [] },
    prerequisites: [], setupSteps: [], approvalRequirements: [], knownBlockers: [],
    blockerAssessment: "incomplete", agentCapabilities: [], capabilities: [], humanHandoff: [], evidence: [],
    uncertainties: [], nextAction: "go", findings: [],
    implementation: {
      // The model MISSED the endpoints; the ledger has them.
      developerPortalUrl: null, authorizeUrl: null, tokenUrl: null, refreshUrl: null, revokeUrl: null,
      scopes: [], supportedScopes: [], redirectUriRule: "Absolute HTTPS.", pkce: "unknown", tokenLifetime: null,
      rateLimits: [], testMode: "", evidenceIds: [], findingIds: [],
    },
  };
}

function fact(fieldPath: string, value: string | boolean): NormalizedFact {
  return {
    fieldPath, value, status: "verified", evidenceRefs: ["ev-1"], findingIds: [],
    sourceExcerpt: "", appliesTo: "", retrievalMethod: "oauth-metadata",
    retrievedAt: "2026-01-01T00:00:00.000Z", conflicts: [], unresolvedReason: null,
  };
}

describe("cross-section consistency after reconciliation", () => {
  const facts = [
    fact("implementation.authorizeUrl", "https://acme.com/oauth/authorize"),
    fact("implementation.tokenUrl", "https://acme.com/oauth/token"),
  ];
  const { guide } = reconcileWithLedger(guideWithNullEndpoints(), facts);

  it("the implementation pack carries the ledger endpoints", () => {
    expect(guide.implementation!.authorizeUrl).toBe("https://acme.com/oauth/authorize");
    expect(guide.implementation!.tokenUrl).toBe("https://acme.com/oauth/token");
  });

  it("the agent brief uses the SAME endpoints (no contradiction, no guess)", () => {
    const brief = buildAgentPrompt(guide)!;
    expect(brief).toContain("https://acme.com/oauth/authorize");
    expect(brief).toContain("https://acme.com/oauth/token");
  });

  it("the OAuth journey templates the SAME endpoints into its snippets", () => {
    const journey = buildJourney(guide);
    const code = journey.flatMap((s) => s.snippets).map((c) => c.code).join("\n");
    expect(code).toContain("https://acme.com/oauth/authorize");
    expect(code).toContain("https://acme.com/oauth/token");
  });
});
