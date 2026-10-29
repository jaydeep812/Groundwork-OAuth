import { describe, it, expect } from "vitest";
import { classifySource } from "@/lib/search/classify";
import {
  isOfficialProviderRepo,
  githubRawUrl,
  authoritativeHostsFor,
  canonicalWebsiteFor,
} from "@/lib/research/provider-registry";
import { extractEndpoints, extractExpiresIn, pickEndpointDocPage } from "@/lib/research/endpoint-extract";
import { buildFactLedger, factFor } from "@/lib/graph/facts";
import { reconcileWithLedger } from "@/lib/graph/reconcile";
import { recoveryQuery } from "@/lib/graph/nodes/plan";
import { GeneratedGuide, type GeneratedGuide as GeneratedGuideType } from "@/lib/schema/guide";

/**
 * Basecamp regression suite — the provider whose OFFICIAL OAuth docs live on
 * github.com/basecamp/api and whose OAuth host is launchpad.37signals.com,
 * neither of which is the canonical website (basecamp.com).
 *
 * VERIFICATION CAVEAT: endpoint/token values below are stated from Basecamp's
 * public API docs (github.com/basecamp/api, sections/authentication.md); they
 * were NOT re-fetched live in this environment. These tests assert how the
 * harness TREATS the inputs (classification, extraction, provenance), not that
 * the live docs currently read verbatim.
 */

const DOCS_URL = "https://github.com/basecamp/api/blob/master/sections/authentication.md";
// A realistic excerpt of Basecamp's authentication.md (Markdown source).
const DOCS_MD = `
# Authentication

To get access, send users to:

    https://launchpad.37signals.com/authorization/new?type=web_server&client_id=...&redirect_uri=...

Then exchange the verification code:

    POST https://launchpad.37signals.com/authorization/token?type=web_server&client_id=...

A successful response returns:

    { "access_token": "...", "expires_in": 1209600, "refresh_token": "..." }

Every request must include a User-Agent header identifying your application,
and you must fetch the authorization to discover which accounts the user can access.
`;

describe("1. canonical website vs docs host (identity ≠ classification)", () => {
  it("knows Basecamp's canonical website without inferring it from the docs host", () => {
    expect(canonicalWebsiteFor("Basecamp")).toBe("basecamp.com");
    // The GitHub docs repo is NOT the canonical website.
    expect(canonicalWebsiteFor("Basecamp")).not.toContain("github");
  });

  it("merges authoritative docs/OAuth hosts without changing the website", () => {
    const hosts = authoritativeHostsFor("Basecamp", ["basecamp.com"]);
    expect(hosts).toContain("basecamp.com");
    expect(hosts).toContain("launchpad.37signals.com");
  });
});

describe("2. verified official GitHub docs repo recognition", () => {
  it("credits the provider's own repo as official-docs", () => {
    expect(classifySource(DOCS_URL, ["basecamp.com"], "Basecamp")).toBe("official-docs");
    expect(isOfficialProviderRepo(DOCS_URL, "Basecamp", ["basecamp.com"])).toBe(true);
  });

  it("does NOT treat an unrelated GitHub repo as official", () => {
    expect(classifySource("https://github.com/someorg/cool-oauth-notes", ["basecamp.com"], "Basecamp")).toBe("unknown");
    expect(isOfficialProviderRepo("https://github.com/randomuser/notes", "Basecamp")).toBe(false);
  });

  it("requires an API/docs-looking repo even when the owner matches", () => {
    // owner matches but repo is a random project → not credited.
    expect(isOfficialProviderRepo("https://github.com/basecamp/trix", "Basecamp")).toBe(false);
    // owner matches and repo looks like API docs → credited (evidence-based).
    expect(isOfficialProviderRepo("https://github.com/basecamp/api", "Basecamp")).toBe(true);
  });
});

describe("3. OAuth endpoint extraction from official Markdown", () => {
  it("pulls authorize + token endpoints on the OAuth host (not the website)", () => {
    const hits = extractEndpoints(DOCS_MD, ["basecamp.com", "37signals.com", "launchpad.37signals.com"]);
    const byKind = Object.fromEntries(hits.map((h) => [h.kind, h.url]));
    expect(byKind.authorize).toBe("https://launchpad.37signals.com/authorization/new");
    expect(byKind.token).toBe("https://launchpad.37signals.com/authorization/token");
  });

  it("githubRawUrl maps a blob URL to its raw Markdown source", () => {
    expect(githubRawUrl(DOCS_URL)).toBe(
      "https://raw.githubusercontent.com/basecamp/api/master/sections/authentication.md",
    );
    expect(githubRawUrl("https://basecamp.com/docs")).toBeNull();
  });
});

describe("4. documented token-lifecycle value extraction", () => {
  it("parses expires_in from the token-response example", () => {
    expect(extractExpiresIn(DOCS_MD)).toBe(1209600); // 14 days
    expect(extractExpiresIn("no token here")).toBeNull();
  });

  it("reconcile turns the extracted expires_in into a verified token lifetime", () => {
    const { guide } = reconcileWithLedger(bareGuide(), [], { tokenLifetimeSeconds: 1209600 });
    expect(guide.implementation!.tokenLifetime!.kind).toBe("verified");
    expect(guide.implementation!.tokenLifetime!.value).toBe(14);
    expect(guide.implementation!.tokenLifetime!.unit).toBe("days");
  });

  it("does NOT override a token lifetime the model already captured", () => {
    const g = bareGuide();
    g.implementation!.tokenLifetime = { kind: "verified", value: 1, unit: "hours", rationale: "model", evidenceIds: [], findingIds: [] };
    const { guide } = reconcileWithLedger(g, [], { tokenLifetimeSeconds: 1209600 });
    expect(guide.implementation!.tokenLifetime!.value).toBe(1);
    expect(guide.implementation!.tokenLifetime!.unit).toBe("hours");
  });
});

describe("5. base endpoints vs parameterized authorization URLs", () => {
  it("stores the bare endpoint, dropping the type/client_id query", () => {
    const hits = extractEndpoints(DOCS_MD, ["launchpad.37signals.com"]);
    const auth = hits.find((h) => h.kind === "authorize")!;
    expect(auth.url).not.toMatch(/[?#]/);
    expect(auth.url).toBe("https://launchpad.37signals.com/authorization/new");
  });
});

describe("8. honest unknowns when no evidence supports a field", () => {
  it("keeps endpoints unknown when the docs host isn't recognized and nothing extracts", () => {
    const facts = buildFactLedger({
      oauthMetadata: null,
      endpointHits: [],
      findings: [],
      providerDomains: ["basecamp.com"],
      evidenceIdByUrl: new Map(),
    });
    expect(factFor(facts, "implementation.authorizeUrl")!.status).toBe("unknown");
    expect(factFor(facts, "implementation.tokenUrl")!.value).toBeNull();
  });
});

describe("Basecamp end-to-end: endpoints flow into the ledger as verified", () => {
  it("resolves authorize/token from extracted hits on the OAuth host", () => {
    const domains = ["basecamp.com", "37signals.com", "launchpad.37signals.com"];
    const hits = extractEndpoints(DOCS_MD, domains);
    const facts = buildFactLedger({
      oauthMetadata: null,
      endpointHits: hits,
      findings: [],
      providerDomains: domains,
      evidenceIdByUrl: new Map(hits.map((h, i) => [h.url, `ev-${i}`])),
    });
    const auth = factFor(facts, "implementation.authorizeUrl")!;
    const token = factFor(facts, "implementation.tokenUrl")!;
    expect(auth.value).toBe("https://launchpad.37signals.com/authorization/new");
    expect(auth.status).toBe("verified");
    expect(token.value).toBe("https://launchpad.37signals.com/authorization/token");
  });
});

describe("6. extraction failure triggers a DIFFERENT recovery strategy", () => {
  it("picks a distinct query per unresolved reason (no identical repeats)", () => {
    // A source conflict and a not-found gap on the same field must not produce
    // the same query — recovery changes strategy by reason.
    const conflictQ = recoveryQuery("Basecamp", "implementation.tokenUrl", "source_conflict");
    const notFoundQ = recoveryQuery("Basecamp", "implementation.tokenUrl", "not_found_in_retrieved_evidence");
    const noAuthQ = recoveryQuery("Basecamp", "implementation.tokenUrl", "no_authoritative_source_found");
    expect(new Set([conflictQ, notFoundQ, noAuthQ]).size).toBe(3);
    expect(conflictQ).toMatch(/exact|official/i);
  });
});

describe("7. post-authorization requirements representable in the setup guide", () => {
  it("a verify-data-access step with account discovery + User-Agent validates", () => {
    const g = bareGuide();
    g.setupSteps = [
      {
        id: "first-request", title: "Make your first authorized request",
        category: "verify-data-access", authPath: "custom-oauth",
        instructions:
          "After authorization, GET https://launchpad.37signals.com/authorization.json to discover which accounts the user can access, then call the account-specific API base URL. Every request must send a User-Agent that identifies your app.",
        rationale: "The token alone doesn't identify the account or satisfy the required header.",
        required: true, appliesWhen: null, fields: [], expectedOutcome: "A 200 from an account endpoint.",
        verification: "The account list returns and an authorized call succeeds.",
        recovery: "A 401 means the token/header is wrong; a 404 means the wrong account base URL.",
        executionMode: "agent-assisted", defaultStatus: "not-started", evidenceIds: [], findingIds: [],
      },
    ];
    const parsed = GeneratedGuide.safeParse(g);
    expect(parsed.success).toBe(true);
    expect(g.setupSteps[0].category).toBe("verify-data-access");
  });
});

function bareGuide(): GeneratedGuideType {
  return {
    providerName: "Basecamp", providerUrl: "https://basecamp.com", description: "d",
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
