import { describe, it, expect } from "vitest";
import { reconcileWithLedger, deriveManagedAuth } from "@/lib/graph/reconcile";
import type { GeneratedGuide, NormalizedFact, Finding } from "@/lib/schema/guide";

function fact(partial: Partial<NormalizedFact> & { fieldPath: string }): NormalizedFact {
  return {
    value: null, status: "unknown", evidenceRefs: [], findingIds: [], sourceExcerpt: "",
    appliesTo: "", retrievalMethod: "unknown", retrievedAt: "", conflicts: [], unresolvedReason: null,
    ...partial,
  };
}

function baseGuide(): GeneratedGuide {
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
      developerPortalUrl: null, authorizeUrl: null, tokenUrl: null, refreshUrl: null, revokeUrl: null,
      scopes: [], supportedScopes: [], redirectUriRule: "", pkce: "unknown", tokenLifetime: null, rateLimits: [], testMode: "",
      evidenceIds: [], findingIds: [],
    },
  };
}

function mkFinding(p: Partial<Finding>): Finding {
  return {
    id: p.id ?? "f1", agent: p.agent ?? "catalog-agent", question: "q", attempted: "a",
    attemptKind: p.attemptKind ?? "catalog-check", outcome: p.outcome ?? "confirmed",
    conclusion: "c", observation: "", evidence: p.evidence ?? [], uncertainty: p.uncertainty ?? "",
    at: "2026-01-01T00:00:00.000Z",
  };
}

describe("reconcileWithLedger", () => {
  it("fills a null endpoint from a verified ledger fact", () => {
    const facts = [
      fact({ fieldPath: "implementation.tokenUrl", value: "https://acme.com/oauth/token", status: "verified" }),
      fact({ fieldPath: "implementation.authorizeUrl", value: "https://acme.com/oauth/authorize", status: "verified" }),
    ];
    const { guide, changed } = reconcileWithLedger(baseGuide(), facts);
    expect(guide.implementation!.tokenUrl).toBe("https://acme.com/oauth/token");
    expect(guide.implementation!.authorizeUrl).toBe("https://acme.com/oauth/authorize");
    expect(changed).toContain("implementation.tokenUrl");
  });

  it("never fabricates: an unknown ledger fact leaves the field null", () => {
    const facts = [fact({ fieldPath: "implementation.tokenUrl", value: null, status: "unknown" })];
    const { guide, changed } = reconcileWithLedger(baseGuide(), facts);
    expect(guide.implementation!.tokenUrl).toBeNull();
    expect(changed).toHaveLength(0);
  });

  it("derives PKCE supported WITHOUT inventing a requirement", () => {
    const facts = [fact({ fieldPath: "implementation.pkce.supported", value: true, status: "verified" })];
    const { guide } = reconcileWithLedger(baseGuide(), facts);
    expect(guide.implementation!.pkceDetail?.supported).toBe("yes");
    expect(guide.implementation!.pkceDetail?.required).toBe("unknown");
    // Legacy summary becomes "supported", not "required".
    expect(guide.implementation!.pkce).toBe("supported");
  });

  it("marks PKCE required only when the ledger says required", () => {
    const facts = [
      fact({ fieldPath: "implementation.pkce.supported", value: true, status: "verified" }),
      fact({ fieldPath: "implementation.pkce.required", value: true, status: "verified" }),
    ];
    const { guide } = reconcileWithLedger(baseGuide(), facts);
    expect(guide.implementation!.pkceDetail?.required).toBe("yes");
    expect(guide.implementation!.pkce).toBe("required");
  });

  it("preserves a model-stated CONDITIONAL PKCE requirement when the ledger is silent", () => {
    // Asana case: no .well-known metadata (no ledger PKCE fact), but the model
    // read the docs: required for localhost/native redirects, S256 recommended.
    const g = baseGuide();
    g.implementation!.pkce = "unknown";
    g.implementation!.pkceDetail = {
      supported: "yes", required: "yes", methods: ["S256"],
      appliesTo: "localhost, 127.0.0.1, and native-app redirect URIs",
      evidenceIds: [], findingIds: [],
    };
    const { guide } = reconcileWithLedger(g, []); // no ledger facts at all
    expect(guide.implementation!.pkce).toBe("required"); // derived from pkceDetail
    expect(guide.implementation!.pkceDetail!.appliesTo).toContain("localhost");
    expect(guide.implementation!.pkceDetail!.methods).toContain("S256");
  });
});

describe("deriveManagedAuth — separated from the custom guide", () => {
  it("confirmed catalog finding => available, with an honest credentials caveat", () => {
    const ma = deriveManagedAuth([
      mkFinding({
        outcome: "confirmed",
        evidence: [{ id: "c1", title: "Composio toolkit", url: "https://composio.dev/toolkits/acme", snippet: "", sourceType: "composio-docs" }],
      }),
    ]);
    expect(ma.availability).toBe("available");
    expect(ma.integrationUrl).toBe("https://composio.dev/toolkits/acme");
    expect(ma.caveats.toLowerCase()).toContain("credential");
  });

  it("a failed/insufficient probe is UNKNOWN, never 'unavailable'", () => {
    const ma = deriveManagedAuth([mkFinding({ outcome: "insufficient", uncertainty: "slug may differ" })]);
    expect(ma.availability).toBe("unknown");
    expect(ma.integrationUrl).toBeNull();
  });

  it("no catalog finding => unknown", () => {
    const ma = deriveManagedAuth([mkFinding({ agent: "docs-agent", outcome: "confirmed" })]);
    expect(ma.availability).toBe("unknown");
  });
});

describe("supportedScopes — server catalog is separate from use-case recommendations", () => {
  it("sets supportedScopes from the metadata fact without injecting them into scopes[]", () => {
    const g = baseGuide();
    // The model recommended one use-case scope with its own description.
    g.implementation!.scopes = [
      { name: "read", description: "Read the user's data (needed for sync)", required: true, enables: "", narrowerAlternative: "", requiresApproval: false, evidenceIds: [], findingIds: [] },
    ];
    const { guide, changed } = reconcileWithLedger(g, [
      fact({
        fieldPath: "implementation.supportedScopes",
        value: "read write admin openid",
        status: "verified",
        retrievalMethod: "oauth-metadata",
        evidenceRefs: ["ev-meta"],
      }),
    ]);
    // Catalog is authoritative and complete...
    expect(guide.implementation!.supportedScopes).toEqual(["read", "write", "admin", "openid"]);
    expect(changed).toContain("implementation.supportedScopes");
    // ...but the use-case recommendations are NOT overwritten with the catalog.
    expect(guide.implementation!.scopes).toHaveLength(1);
    expect(guide.implementation!.scopes[0].name).toBe("read");
    expect(guide.implementation!.scopes[0].required).toBe(true);
    // A recommended scope the catalog confirms gets the metadata evidence id.
    expect(guide.implementation!.scopes[0].evidenceIds).toContain("ev-meta");
  });

  it("leaves supportedScopes untouched when no metadata scope fact exists", () => {
    const { guide, changed } = reconcileWithLedger(baseGuide(), []);
    expect(guide.implementation!.supportedScopes).toEqual([]);
    expect(changed).not.toContain("implementation.supportedScopes");
  });
});
