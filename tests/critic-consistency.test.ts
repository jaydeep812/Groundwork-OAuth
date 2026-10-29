import { describe, it, expect } from "vitest";
import { critiqueGuide } from "@/lib/graph/critique";
import type { GeneratedGuide, NormalizedFact } from "@/lib/schema/guide";

/**
 * Critic semantic-consistency regressions. Deterministic. These assert the
 * claim-level checks that stop estimates masquerading as facts, dropped known
 * values, unsurfaced conflicts, PKCE contradictions, and empty-array blocker
 * claims.
 */

function guide(partial: Partial<GeneratedGuide>): GeneratedGuide {
  return {
    providerName: "Acme",
    providerUrl: "https://acme.com",
    description: "d",
    recommendedPath: "custom-oauth",
    pathRationale: "r",
    difficulty: { rating: "moderate", rationale: "r", findingIds: [] },
    activeEffort: { kind: "estimate", value: 2, unit: "hours", rationale: "planning estimate", evidenceIds: [], findingIds: [] },
    externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "r", evidenceIds: [], findingIds: [] },
    prerequisites: [],
    setupSteps: [
      {
        id: "s1", title: "Register", category: "register-provider-app", authPath: "custom-oauth",
        instructions: "Register the app", rationale: "", required: true, appliesWhen: null, fields: [],
        expectedOutcome: "", verification: "", recovery: "", executionMode: "manual",
        defaultStatus: "not-started", evidenceIds: [], findingIds: [],
      },
    ],
    approvalRequirements: [],
    knownBlockers: [],
    blockerAssessment: "incomplete",
    agentCapabilities: [], capabilities: [],
    humanHandoff: [],
    evidence: [],
    uncertainties: [],
    nextAction: "go",
    findings: [],
    implementation: {
      developerPortalUrl: "https://acme.com/dev", authorizeUrl: "https://acme.com/oauth/authorize",
      tokenUrl: "https://acme.com/oauth/token", refreshUrl: null, revokeUrl: null, scopes: [], supportedScopes: [],
      redirectUriRule: "https only", pkce: "unknown", tokenLifetime: null, rateLimits: [], testMode: "",
      evidenceIds: [], findingIds: [],
    },
    ...partial,
  };
}

const verifiedTokenFact: NormalizedFact = {
  fieldPath: "implementation.tokenUrl",
  value: "https://acme.com/oauth/token",
  status: "verified",
  evidenceRefs: ["ev-meta"],
  findingIds: [],
  sourceExcerpt: "token_endpoint",
  appliesTo: "",
  retrievalMethod: "oauth-metadata",
  retrievedAt: "2026-01-01T00:00:00.000Z",
  conflicts: [],
  unresolvedReason: null,
};

describe("critic — estimate honesty", () => {
  it("flags a hands-on effort estimate mislabeled as documented", () => {
    const g = guide({ activeEffort: { kind: "verified", value: 2, unit: "hours", rationale: "r", evidenceIds: [], findingIds: [] } });
    const c = critiqueGuide(g);
    const f = c.failures.find((x) => x.fieldPath === "activeEffort.kind");
    expect(f?.severity).toBe("error");
    expect(c.complete).toBe(false);
  });

  it("accepts a properly-labeled estimate", () => {
    const c = critiqueGuide(guide({}));
    expect(c.failures.some((x) => x.fieldPath === "activeEffort.kind")).toBe(false);
  });

  it("flags a documented external-waiting timeline with no evidence", () => {
    const g = guide({
      externalWaiting: { kind: "verified", value: 2, unit: "days", rationale: "r", evidenceIds: [], findingIds: [] },
    });
    const c = critiqueGuide(g);
    expect(c.failures.some((x) => x.fieldPath === "externalWaiting" && x.severity === "error")).toBe(true);
  });
});

describe("critic — known facts must not be dropped", () => {
  it("errors when the ledger verified the token URL but the guide left it null", () => {
    const g = guide({
      implementation: { ...guide({}).implementation!, tokenUrl: null },
    });
    const c = critiqueGuide(g, [verifiedTokenFact]);
    expect(c.failures.some((x) => x.fieldPath === "implementation.tokenUrl" && x.severity === "error")).toBe(true);
  });

  it("passes when the guide carries the ledger-verified value", () => {
    const c = critiqueGuide(guide({}), [verifiedTokenFact]);
    expect(c.failures.some((x) => x.fieldPath === "implementation.tokenUrl" && x.severity === "error")).toBe(false);
  });
});

describe("critic — conflicts must be surfaced", () => {
  const conflict: NormalizedFact = {
    ...verifiedTokenFact,
    status: "conflicting",
    unresolvedReason: "source_conflict",
    conflicts: [
      { value: "https://acme.com/oauth/token", evidenceRefs: ["ev-meta"], note: "oauth-metadata" },
      { value: "https://acme.com/oauth/token-v2", evidenceRefs: ["ev-doc"], note: "official-docs" },
    ],
  };

  it("errors when a conflict is not surfaced as an uncertainty", () => {
    const c = critiqueGuide(guide({}), [conflict]);
    expect(c.failures.some((x) => x.reason === "source_conflict" && x.severity === "error")).toBe(true);
  });

  it("downgrades to a warning when the conflict is surfaced", () => {
    const g = guide({
      uncertainties: [{ id: "u1", question: "Which tokenurl is correct?", resolution: "", kind: "unknown", findingIds: [] }],
    });
    const c = critiqueGuide(g, [conflict]);
    const f = c.failures.find((x) => x.reason === "source_conflict");
    expect(f?.severity).toBe("warn");
  });
});

describe("critic — PKCE support vs requirement", () => {
  it("errors when PKCE is required but not supported", () => {
    const g = guide({
      implementation: {
        ...guide({}).implementation!,
        pkceDetail: { supported: "no", required: "yes", methods: [], appliesTo: "", evidenceIds: [], findingIds: [] },
      },
    });
    const c = critiqueGuide(g);
    expect(c.failures.some((x) => x.fieldPath === "implementation.pkceDetail" && x.severity === "error")).toBe(true);
  });
});

describe("critic — blocker semantics", () => {
  it("does not treat an empty knownBlockers + assessed-none-found as a failure", () => {
    const c = critiqueGuide(guide({ blockerAssessment: "assessed-none-found" }));
    expect(c.failures.some((x) => x.fieldPath === "blockerAssessment")).toBe(false);
  });

  it("errors when blockerAssessment says blockers-found but the array is empty", () => {
    const c = critiqueGuide(guide({ blockerAssessment: "blockers-found", knownBlockers: [] }));
    expect(c.failures.some((x) => x.fieldPath === "blockerAssessment" && x.severity === "error")).toBe(true);
  });
});
