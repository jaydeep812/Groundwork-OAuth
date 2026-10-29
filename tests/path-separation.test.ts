import { describe, it, expect } from "vitest";
import { critiqueGuide, findPathViolations } from "@/lib/graph/critique";
import { backfillImplementation, findToolkitUrl } from "@/lib/guide/backfill";
import type { GeneratedGuide, EvidenceRef } from "@/lib/schema/guide";

function guide(partial: Partial<GeneratedGuide>): GeneratedGuide {
  return {
    providerName: "Acme",
    providerUrl: "https://acme.com",
    description: "d",
    recommendedPath: "custom-oauth",
    pathRationale: "r",
    difficulty: { rating: "moderate", rationale: "r", findingIds: [] },
    activeEffort: { kind: "unknown", value: null, unit: null, rationale: "r", evidenceIds: [], findingIds: [] },
    externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "r", evidenceIds: [], findingIds: [] },
    prerequisites: [],
    setupSteps: [],
    approvalRequirements: [],
    knownBlockers: [],
    blockerAssessment: "incomplete",
    agentCapabilities: [], capabilities: [],
    humanHandoff: [],
    evidence: [],
    uncertainties: [],
    nextAction: "go",
    findings: [],
    ...partial,
  };
}

const registerStep = (over: Record<string, unknown> = {}) => ({
  id: "reg",
  title: "Register OAuth app",
  category: "register-provider-app" as const,
  authPath: "custom-oauth" as const,
  instructions: "Create an OAuth app and get a client secret.",
  rationale: "",
  required: true,
  appliesWhen: null,
  fields: [],
  expectedOutcome: "",
  verification: "",
  recovery: "",
  executionMode: "manual" as const,
  defaultStatus: "not-started" as const,
  evidenceIds: [],
  findingIds: [],
  ...over,
});

describe("single custom-OAuth path (managed availability is supplementary)", () => {
  it("no longer flags path violations — managed availability never contradicts the guide", () => {
    const g = guide({ recommendedPath: "managed-auth", setupSteps: [registerStep()] });
    expect(findPathViolations(g)).toHaveLength(0);
    expect(critiqueGuide(g).violations).toHaveLength(0);
  });

  it("applies the custom-OAuth completeness checks regardless of recommendedPath", () => {
    // Every guide is a custom OAuth readiness guide, so a guide with only a
    // setup step and no endpoints is incomplete — the endpoints are required
    // content whether or not Composio also supports the provider.
    const managedData = guide({
      recommendedPath: "managed-auth",
      setupSteps: [registerStep({ title: "Register OAuth app" })],
    });
    expect(critiqueGuide(managedData).missing).toContain("authorize endpoint URL");
    const custom = guide({ recommendedPath: "custom-oauth", setupSteps: [registerStep()] });
    expect(critiqueGuide(custom).missing).toContain("authorize endpoint URL");
  });
});

describe("source-to-field backfill", () => {
  const evidence: EvidenceRef[] = [
    { id: "e1", title: "Acme developer portal", url: "https://developers.acme.com/apps", snippet: "", sourceType: "developer-portal" },
    { id: "e2", title: "Acme docs", url: "https://acme.com/docs/oauth", snippet: "", sourceType: "official-docs" },
    { id: "e3", title: "A blog", url: "https://medium.com/x", snippet: "", sourceType: "community" },
  ];

  it("fills developerPortalUrl from on-domain evidence when the model left it null", () => {
    const impl = { developerPortalUrl: null, authorizeUrl: null, tokenUrl: null, refreshUrl: null, revokeUrl: null, scopes: [], supportedScopes: [], redirectUriRule: "", pkce: "unknown" as const, tokenLifetime: null, rateLimits: [], testMode: "", evidenceIds: [], findingIds: [] };
    const { implementation, filled } = backfillImplementation(impl, evidence, ["acme.com"]);
    expect(filled).toContain("developerPortalUrl");
    // Prefers the developer-portal-classified URL.
    expect(implementation!.developerPortalUrl).toBe("https://developers.acme.com/apps");
  });

  it("does not overwrite an existing developerPortalUrl", () => {
    const impl = { developerPortalUrl: "https://acme.com/already", authorizeUrl: null, tokenUrl: null, refreshUrl: null, revokeUrl: null, scopes: [], supportedScopes: [], redirectUriRule: "", pkce: "unknown" as const, tokenLifetime: null, rateLimits: [], testMode: "", evidenceIds: [], findingIds: [] };
    const { implementation, filled } = backfillImplementation(impl, evidence, ["acme.com"]);
    expect(filled).toHaveLength(0);
    expect(implementation!.developerPortalUrl).toBe("https://acme.com/already");
  });

  it("never fills from off-domain (third-party) evidence", () => {
    const impl = { developerPortalUrl: null, authorizeUrl: null, tokenUrl: null, refreshUrl: null, revokeUrl: null, scopes: [], supportedScopes: [], redirectUriRule: "", pkce: "unknown" as const, tokenLifetime: null, rateLimits: [], testMode: "", evidenceIds: [], findingIds: [] };
    const offDomain: EvidenceRef[] = [{ id: "x", title: "nango", url: "https://nango.dev/acme", snippet: "", sourceType: "third-party-integration" }];
    const { implementation, filled } = backfillImplementation(impl, offDomain, ["acme.com"]);
    expect(filled).toHaveLength(0);
    expect(implementation!.developerPortalUrl).toBeNull();
  });

  it("findToolkitUrl returns a verified composio toolkit URL, not a guess", () => {
    const withToolkit: EvidenceRef[] = [...evidence, { id: "c", title: "Composio", url: "https://composio.dev/toolkits/acme", snippet: "", sourceType: "composio-docs" }];
    expect(findToolkitUrl(withToolkit)).toBe("https://composio.dev/toolkits/acme");
    expect(findToolkitUrl(evidence)).toBeNull();
  });
});
