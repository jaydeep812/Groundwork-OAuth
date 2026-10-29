import { describe, it, expect } from "vitest";
import { buildFactLedger, factFor } from "@/lib/graph/facts";
import { extractEndpoints } from "@/lib/research/endpoint-extract";
import { reconcileWithLedger } from "@/lib/graph/reconcile";
import { buildAgentPrompt } from "@/lib/guide/agent-prompt";
import { buildJourney } from "@/lib/guide/oauth-journey";
import { Implementation, type GeneratedGuide } from "@/lib/schema/guide";
import { PROVIDER_FIXTURES, boldsign } from "./fixtures/providers";

/**
 * Provider regression suite. Deterministic — runs each fixture's MOCKED
 * structured signals through the real fact ledger and asserts the resolved
 * value + provenance status. See tests/fixtures/providers.ts for the
 * authoritative source URLs + excerpts and the verification caveat.
 *
 * These assert how the ledger TREATS the inputs (value, status), not that a
 * provider's live docs currently say exactly this.
 */
describe("provider fact-ledger regressions", () => {
  for (const fx of PROVIDER_FIXTURES) {
    describe(fx.name, () => {
      const facts = buildFactLedger({
        oauthMetadata: fx.oauthMetadata,
        endpointHits: fx.endpointHits,
        findings: fx.findings,
        providerDomains: fx.providerDomains,
        // Map every expected/known URL to a synthetic evidence id.
        evidenceIdByUrl: new Map(
          [
            ...fx.endpointHits.map((h) => h.url),
            ...fx.findings.flatMap((f) => f.evidence.map((e) => e.url)),
            ...(fx.oauthMetadata ? [fx.oauthMetadata.sourceUrl] : []),
          ].map((u, i) => [u, `ev-${i + 1}`]),
        ),
      });

      for (const exp of fx.expectations) {
        it(`${exp.fieldPath} → ${exp.status} (${exp.value ?? "null"})`, () => {
          const f = factFor(facts, exp.fieldPath);
          expect(f, `no fact for ${exp.fieldPath}`).toBeTruthy();
          expect(f!.value).toBe(exp.value);
          expect(f!.status).toBe(exp.status);
          if (exp.status !== "unknown") {
            // A resolved fact must carry provenance, never be bare.
            expect(f!.evidenceRefs.length + f!.findingIds.length).toBeGreaterThan(0);
          }
        });
      }
    });
  }

  it("the unfamiliar provider yields honest unknowns, not fabricated endpoints", () => {
    const unknown = PROVIDER_FIXTURES.find((f) => f.name.startsWith("Obscure"))!;
    const facts = buildFactLedger({
      oauthMetadata: null,
      endpointHits: [],
      findings: unknown.findings,
      providerDomains: unknown.providerDomains,
      evidenceIdByUrl: new Map(),
    });
    expect(factFor(facts, "implementation.authorizeUrl")!.status).toBe("unknown");
    expect(factFor(facts, "implementation.tokenUrl")!.value).toBeNull();
  });
});

/**
 * BoldSign targeted corrections (from live-docs review). Asserts the five
 * concrete issues are fixed AND that the pack, brief, and journey all derive
 * from the same reconciled facts.
 */
describe("BoldSign — corrected facts flow consistently", () => {
  // The authorize endpoint is documented as a full example URL with params.
  const DOC_TEXT =
    "Redirect the user to https://account.boldsign.com/connect/authorize?response_type=code&client_id=X&code_challenge=C&code_challenge_method=S256 then POST to https://account.boldsign.com/connect/token";

  it("1. endpoint extraction strips inline query params → bare authorize endpoint", () => {
    const hits = extractEndpoints(DOC_TEXT, ["boldsign.com"]);
    const auth = hits.find((h) => h.kind === "authorize")!;
    expect(auth.url).toBe("https://account.boldsign.com/connect/authorize");
    expect(auth.url).not.toContain("?");
  });

  it("ledger normalizes the malformed authorize URL from the fixture hit", () => {
    const facts = buildFactLedger({
      oauthMetadata: null,
      endpointHits: boldsign.endpointHits,
      findings: boldsign.findings,
      providerDomains: boldsign.providerDomains,
      evidenceIdByUrl: new Map(boldsign.endpointHits.map((h, i) => [h.url, `ev-${i}`])),
    });
    expect(factFor(facts, "implementation.authorizeUrl")!.value).toBe(
      "https://account.boldsign.com/connect/authorize",
    );
  });

  it("2+3+5. reconciled pack: refreshUrl=tokenUrl, PKCE required, 1h lifetime, single-use refresh", () => {
    const guide = boldsignGuide();
    const facts = [
      { fieldPath: "implementation.pkce.supported", value: true as const, status: "verified" as const, evidenceRefs: ["e"], findingIds: [], sourceExcerpt: "", appliesTo: "", retrievalMethod: "official-docs" as const, retrievedAt: "", conflicts: [], unresolvedReason: null },
      { fieldPath: "implementation.pkce.required", value: true as const, status: "verified" as const, evidenceRefs: ["e"], findingIds: [], sourceExcerpt: "", appliesTo: "", retrievalMethod: "official-docs" as const, retrievedAt: "", conflicts: [], unresolvedReason: null },
    ];
    const { guide: g } = reconcileWithLedger(guide, facts);
    expect(g.implementation!.refreshUrl).toBe("https://account.boldsign.com/connect/token");
    expect(g.implementation!.pkce).toBe("required");
    expect(g.implementation!.pkceDetail!.required).toBe("yes");
    expect(g.implementation!.tokenLifetime!.value).toBe(1);
    expect(g.implementation!.tokenLifetime!.unit).toBe("hours");

    const brief = buildAgentPrompt(g)!;
    expect(brief).toMatch(/single-use|rotating/i);
    expect(brief).toContain("https://account.boldsign.com/connect/token");
    expect(brief).toMatch(/PKCE: REQUIRED/);
    // The pack stores the BARE authorize endpoint (params belong in the request,
    // not the copyable endpoint). The journey snippet may legitimately show the
    // full request URL with query params — that's how you build the redirect.
    expect(g.implementation!.authorizeUrl).toBe("https://account.boldsign.com/connect/authorize");
    const code = buildJourney(g).flatMap((s) => s.snippets).map((c) => c.code).join("\n");
    expect(code).toContain("https://account.boldsign.com/connect/authorize");
  });

  it("4. scopes are not all-required: API scopes optional, offline_access present", () => {
    const g = boldsignGuide();
    const names = g.implementation!.scopes.map((s) => s.name);
    expect(names).toContain("offline_access");
    expect(names).toContain("openid");
    // Not every scope is required.
    expect(g.implementation!.scopes.every((s) => s.required)).toBe(false);
    // The broad API scope is present but not forced required.
    const docsAll = g.implementation!.scopes.find((s) => s.name === "BoldSign.Documents.All");
    expect(docsAll).toBeTruthy();
  });
});

/** A BoldSign guide shaped as the corrected pipeline would synthesize it. */
function boldsignGuide(): GeneratedGuide {
  return {
    providerName: "BoldSign", providerUrl: "https://boldsign.com",
    description: "BoldSign e-signature REST API via OAuth 2.0 (IdentityServer).",
    recommendedPath: "custom-oauth", pathRationale: "r",
    difficulty: { rating: "moderate", rationale: "r", findingIds: [] },
    activeEffort: { kind: "estimate", value: 2, unit: "hours", rationale: "Planning estimate for a mid-level dev wiring the auth-code+PKCE flow; excludes production review.", evidenceIds: [], findingIds: [] },
    externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "No provider-side wait documented for standard API access.", evidenceIds: [], findingIds: [] },
    prerequisites: [], setupSteps: [], approvalRequirements: [], knownBlockers: [],
    blockerAssessment: "assessed-none-found", agentCapabilities: [], capabilities: [], humanHandoff: [],
    evidence: [], uncertainties: [], nextAction: "Register an app (admin required).",
    findings: [],
    implementation: Implementation.parse({
      developerPortalUrl: "https://app.boldsign.com/settings",
      authorizeUrl: "https://account.boldsign.com/connect/authorize",
      tokenUrl: "https://account.boldsign.com/connect/token",
      refreshUrl: null, // ← reconcile should fill this from the lifecycle fact
      revokeUrl: null,
      scopes: [
        { name: "openid", description: "OpenID Connect sign-in", required: true },
        { name: "profile", description: "Basic profile", required: true },
        { name: "email", description: "Email claim", required: true },
        { name: "offline_access", description: "Request a refresh token", required: true, enables: "refresh tokens" },
        { name: "BoldSign.Documents.All", description: "Full document access", required: false, enables: "create/read/send documents", narrowerAlternative: "a document-specific scope if available" },
        { name: "BoldSign.Templates.Create", description: "Create templates", required: false, enables: "template creation" },
        { name: "BoldSign.Users.All", description: "Manage users", required: false, enables: "user administration", requiresApproval: false },
      ],
      redirectUriRule: "Absolute HTTPS; must match a registered redirect URI.",
      pkce: "required",
      tokenLifetime: { kind: "verified", value: 1, unit: "hours", rationale: "Documented example: expires_in 3600." },
      tokenLifecycle: {
        refreshTokenIssued: "yes", refreshTokenRotates: "yes", refreshTokenSingleUse: "yes",
        revocationSupported: "unknown", tokenType: "Bearer", presentation: "Authorization: Bearer header",
        onRefreshFailure: "Re-run the authorization-code flow.",
      },
      appReadiness: {
        accountRequirements: "An account administrator must create the developer application; API availability depends on the subscription plan.",
        requiredAppFields: ["redirect URI", "allowed scopes"],
        environments: "Separate sandbox and live credentials.",
        scopeApproval: "unknown",
      },
    }),
  };
}

