import { describe, it, expect } from "vitest";
import { buildAgentPrompt, hasEnoughForAgentPrompt } from "@/lib/guide/agent-prompt";
import { Implementation } from "@/lib/schema/guide";

const implFull = Implementation.parse({
  developerPortalUrl: "https://airtable.com/create/oauth",
  authorizeUrl: "https://airtable.com/oauth2/v1/authorize",
  tokenUrl: "https://airtable.com/oauth2/v1/token",
  refreshUrl: "https://airtable.com/oauth2/v1/token",
  revokeUrl: null,
  scopes: [
    { name: "data.records:read", description: "", required: true },
    { name: "schema.bases:read", description: "", required: false },
  ],
  redirectUriRule: "Absolute HTTPS; localhost allowed for dev.",
  pkce: "supported" as const,
  tokenLifetime: { kind: "verified" as const, value: 60, unit: "minutes" as const, rationale: "Documented 60-minute access token." },
  rateLimits: [{ limit: "5 requests per second", window: "per second", scope: "per base", note: "" }],
  testMode: "",
});

const managed = { providerName: "Airtable", recommendedPath: "managed-auth" as const, pathRationale: "", implementation: implFull, capabilities: [] };
const custom = { providerName: "Airtable", recommendedPath: "custom-oauth" as const, pathRationale: "", implementation: implFull, capabilities: [] };

describe("buildAgentPrompt — managed availability is supplementary", () => {
  it("still produces the custom OAuth brief even when data says managed-auth", () => {
    const p = buildAgentPrompt(managed, "read and create records", {
      toolkitUrl: "https://composio.dev/toolkits/airtable",
    })!;
    // The brief is the custom OAuth implementation, not a Composio-only flow.
    expect(p).toMatch(/implement OAuth/i);
    expect(p).toContain("https://airtable.com/oauth2/v1/authorize");
    expect(p).toContain("read and create records"); // use case echoed
    // The managed toolkit URL does not leak into the custom brief.
    expect(p).not.toContain("https://composio.dev/toolkits/airtable");
  });

  it("returns null for a sparse pack with no endpoints (needs facts to be useful)", () => {
    const sparse = { providerName: "Y", recommendedPath: "managed-auth" as const, pathRationale: "", implementation: undefined, capabilities: [] };
    expect(hasEnoughForAgentPrompt(sparse)).toBe(false);
    expect(buildAgentPrompt(sparse)).toBeNull();
  });
});

describe("buildAgentPrompt — custom-oauth", () => {
  it("includes only established facts and says PKCE supported (not required)", () => {
    const p = buildAgentPrompt(custom)!;
    expect(p).toContain("https://airtable.com/oauth2/v1/authorize");
    expect(p).toContain("data.records:read");
    expect(p).toMatch(/PKCE: supported/);
    expect(p).not.toMatch(/PKCE: REQUIRED/);
    expect(p.toLowerCase()).toContain("never hardcode");
  });

  it("ties verified capabilities + their required access into the brief and tests", () => {
    const withCaps = {
      ...custom,
      capabilities: [
        {
          title: "Read and create records",
          summary: "", dataAndActions: "", requiredAccess: ["data.records:read", "data.records:write"],
          limitations: "", docUrl: null, evidenceIds: [], findingIds: [],
        },
      ],
    };
    const p = buildAgentPrompt(withCaps, "sync records")!;
    // Capability named with its minimum access in the brief body…
    expect(p).toContain("Read and create records");
    expect(p).toContain("data.records:write");
    // …and a capability-aware acceptance test is generated.
    expect(p).toMatch(/An authorized call for "Read and create records" succeeds/);
  });

  it("is a self-contained brief: env placeholders, steps, tests, and docs", () => {
    const p = buildAgentPrompt(custom, "sync records")!;
    expect(p).toContain("sync records"); // goal / use case
    expect(p).toMatch(/Environment variables/);
    expect(p).toMatch(/AIRTABLE_CLIENT_ID=<your client id>/);
    expect(p).not.toMatch(/CLIENT_SECRET=sk-|CLIENT_SECRET=[A-Za-z0-9]{8,}/); // never a real secret
    expect(p).toMatch(/Implementation steps:/);
    expect(p).toMatch(/Tests to add:/);
    expect(p).toMatch(/Reference \(verified during research\):/);
    expect(p).toMatch(/Security requirements:/);
  });

  it("returns null when a custom guide lacks the key endpoints (no thin brief)", () => {
    const thin = { ...custom, implementation: { ...implFull, authorizeUrl: null, tokenUrl: null } };
    expect(hasEnoughForAgentPrompt(thin)).toBe(false);
    expect(buildAgentPrompt(thin)).toBeNull();
  });

  it("does not fabricate: unknown fields are flagged to verify, not invented", () => {
    const sparse = {
      ...custom,
      implementation: { ...implFull, developerPortalUrl: null, scopes: [], pkce: "unknown" as const, tokenLifetime: null },
    };
    const p = buildAgentPrompt(sparse)!;
    expect(p).toMatch(/Unresolved.*verify/i);
    expect(p).toMatch(/where to register the OAuth app/i);
    expect(p).toMatch(/the scope list/i);
    // Never claims unestablished scopes are verified.
    expect(p).not.toMatch(/Required scopes:/);
    // No PKCE instruction when unknown.
    expect(p).not.toMatch(/with PKCE/);
    expect(p).toMatch(/Do NOT add PKCE/i);
  });

  it("marks PKCE required only when the data says required", () => {
    const req = { ...custom, implementation: { ...implFull, pkce: "required" as const } };
    expect(buildAgentPrompt(req)!).toMatch(/PKCE: REQUIRED/);
  });
});
