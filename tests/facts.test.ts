import { describe, it, expect } from "vitest";
import { buildFactLedger, factFor, LEDGER_FIELDS } from "@/lib/graph/facts";
import type { Finding } from "@/lib/schema/guide";
import type { OAuthMetadata } from "@/lib/research/oauth-metadata";
import type { EndpointHit } from "@/lib/research/endpoint-extract";

/**
 * Fact-ledger regression tests. Deterministic — no live retrieval, no LLM.
 * These lock in the resolution rules that prevent the "inconsistent, missing,
 * contradictory, unsupported" guide data the harness fix targets.
 */

const PROVIDER_DOMAINS = ["acme.com"];

function mkFinding(partial: Partial<Finding>): Finding {
  return {
    id: partial.id ?? "find_1",
    agent: partial.agent ?? "docs-agent",
    question: partial.question ?? "q",
    attempted: partial.attempted ?? "a",
    attemptKind: partial.attemptKind ?? "docs-read",
    outcome: partial.outcome ?? "confirmed",
    conclusion: partial.conclusion ?? "c",
    observation: partial.observation ?? "",
    evidence: partial.evidence ?? [],
    uncertainty: partial.uncertainty ?? "",
    at: partial.at ?? "2026-01-01T00:00:00.000Z",
  };
}

const metadata: OAuthMetadata = {
  sourceUrl: "https://acme.com/.well-known/oauth-authorization-server",
  issuer: "https://acme.com",
  authorizeUrl: "https://acme.com/oauth/authorize",
  tokenUrl: "https://acme.com/oauth/token",
  registrationUrl: "https://acme.com/developers/apps",
  revokeUrl: "https://acme.com/oauth/revoke",
  supportedScopes: ["read", "write"],
  pkceMethods: ["S256"],
  pkce: "supported",
};

const idMap = () =>
  new Map<string, string>([
    ["https://acme.com/.well-known/oauth-authorization-server", "ev-meta"],
    ["https://acme.com/oauth/authorize", "ev-auth"],
    ["https://acme.com/oauth/token", "ev-token"],
  ]);

describe("buildFactLedger — metadata is authoritative (verified)", () => {
  it("establishes endpoints + PKCE support from provider metadata as verified", () => {
    const facts = buildFactLedger({
      oauthMetadata: metadata,
      endpointHits: [],
      findings: [],
      providerDomains: PROVIDER_DOMAINS,
      evidenceIdByUrl: idMap(),
    });
    const auth = factFor(facts, "implementation.authorizeUrl")!;
    expect(auth.value).toBe("https://acme.com/oauth/authorize");
    expect(auth.status).toBe("verified");
    expect(auth.retrievalMethod).toBe("oauth-metadata");
    expect(auth.evidenceRefs).toContain("ev-meta");

    const supported = factFor(facts, "implementation.pkce.supported")!;
    expect(supported.value).toBe(true);
    expect(supported.status).toBe("verified");
    // Metadata advertising methods proves SUPPORT, never REQUIREMENT.
    const required = factFor(facts, "implementation.pkce.required")!;
    expect(required.status).toBe("unknown");
    expect(required.value).toBeNull();
  });
});

describe("buildFactLedger — known values survive a failed second method", () => {
  it("keeps a metadata-verified token URL even when no probe/extraction confirmed it", () => {
    // Only metadata has the token URL; the auth-endpoint agent found nothing.
    const facts = buildFactLedger({
      oauthMetadata: metadata,
      endpointHits: [],
      findings: [
        mkFinding({
          agent: "auth-endpoint-agent",
          outcome: "insufficient",
          conclusion: "No endpoint on domain in evidence.",
        }),
      ],
      providerDomains: PROVIDER_DOMAINS,
      evidenceIdByUrl: idMap(),
    });
    const token = factFor(facts, "implementation.tokenUrl")!;
    expect(token.value).toBe("https://acme.com/oauth/token");
    expect(token.status).toBe("verified");
  });
});

describe("buildFactLedger — probes observe, they don't verify a contract", () => {
  it("marks a probed endpoint as observed, not verified", () => {
    const facts = buildFactLedger({
      oauthMetadata: null,
      endpointHits: [],
      findings: [
        mkFinding({
          id: "probe_1",
          agent: "auth-endpoint-agent",
          outcome: "confirmed",
          attemptKind: "api-error-probe",
          conclusion: "Endpoint reachable (HTTP 400).",
          evidence: [
            {
              id: "e",
              title: "Token endpoint",
              url: "https://acme.com/oauth/token",
              snippet: "error",
              sourceType: "official-docs",
            },
          ],
        }),
      ],
      providerDomains: PROVIDER_DOMAINS,
      evidenceIdByUrl: new Map([["https://acme.com/oauth/token", "ev-token"]]),
    });
    const token = factFor(facts, "implementation.tokenUrl")!;
    expect(token.value).toBe("https://acme.com/oauth/token");
    expect(token.status).toBe("observed");
    expect(token.retrievalMethod).toBe("http-probe");
    expect(token.findingIds).toContain("probe_1");
  });
});

describe("buildFactLedger — conflicts are preserved, not silently resolved", () => {
  it("records a conflict when two authoritative sources disagree on a URL", () => {
    const conflicting: EndpointHit[] = [
      { kind: "token", url: "https://acme.com/oauth/token-v2" },
    ];
    // metadata says .../oauth/token ; an on-domain doc page says .../oauth/token-v2
    const facts = buildFactLedger({
      oauthMetadata: metadata,
      endpointHits: conflicting,
      findings: [],
      providerDomains: PROVIDER_DOMAINS,
      evidenceIdByUrl: new Map([
        ["https://acme.com/.well-known/oauth-authorization-server", "ev-meta"],
        ["https://acme.com/oauth/token-v2", "ev-doc"],
      ]),
    });
    const token = factFor(facts, "implementation.tokenUrl")!;
    expect(token.status).toBe("conflicting");
    expect(token.unresolvedReason).toBe("source_conflict");
    expect(token.conflicts.length).toBeGreaterThanOrEqual(2);
    // Both competing values are retained.
    const values = token.conflicts.map((c) => c.value);
    expect(values).toContain("https://acme.com/oauth/token");
    expect(values).toContain("https://acme.com/oauth/token-v2");
  });

  it("a weaker off-domain hit does NOT conflict with a metadata value", () => {
    const offDomainHit: EndpointHit[] = [
      { kind: "authorize", url: "https://nango.dev/acme/authorize" },
    ];
    const facts = buildFactLedger({
      oauthMetadata: metadata,
      endpointHits: offDomainHit,
      findings: [],
      providerDomains: PROVIDER_DOMAINS,
      evidenceIdByUrl: idMap(),
    });
    const auth = factFor(facts, "implementation.authorizeUrl")!;
    expect(auth.status).toBe("verified"); // metadata wins; no conflict
    expect(auth.value).toBe("https://acme.com/oauth/authorize");
  });
});

describe("buildFactLedger — missing high-impact fields are explicit unknowns", () => {
  it("emits unknown facts with a researchable reason for fields nothing established", () => {
    const facts = buildFactLedger({
      oauthMetadata: null,
      endpointHits: [],
      findings: [],
      providerDomains: PROVIDER_DOMAINS,
      evidenceIdByUrl: new Map(),
    });
    for (const fp of LEDGER_FIELDS) {
      const f = factFor(facts, fp)!;
      expect(f.status).toBe("unknown");
      expect(f.value).toBeNull();
      expect(f.unresolvedReason).toBe("not_found_in_retrieved_evidence");
    }
  });
});
