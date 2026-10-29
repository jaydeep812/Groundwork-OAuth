import { describe, it, expect } from "vitest";
import { buildJourney } from "@/lib/guide/oauth-journey";
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
  pkce: "required" as const,
  tokenLifetime: { kind: "verified" as const, value: 60, unit: "minutes" as const, rationale: "Documented 60-minute access token." },
  rateLimits: [{ limit: "5 requests per second", window: "per base", scope: "", note: "" }],
  testMode: "",
});

const customGuide = {
  providerName: "Airtable",
  recommendedPath: "custom-oauth" as const,
  implementation: implFull,
};

describe("buildJourney — custom-oauth", () => {
  it("produces the 7 OAuth stages in order", () => {
    const j = buildJourney(customGuide);
    expect(j.map((s) => s.key)).toEqual([
      "register", "grant-type", "authorize", "exchange", "store-tokens", "api-request", "refresh",
    ]);
    expect(j.every((s) => s.authPath === "custom-oauth")).toBe(true);
  });

  it("templates the REAL endpoints into snippets (no fabrication)", () => {
    const j = buildJourney(customGuide);
    const authorize = j.find((s) => s.key === "authorize")!;
    const exchange = j.find((s) => s.key === "exchange")!;
    expect(authorize.snippets.some((c) => c.code.includes("https://airtable.com/oauth2/v1/authorize"))).toBe(true);
    expect(exchange.snippets.some((c) => c.code.includes("https://airtable.com/oauth2/v1/token"))).toBe(true);
    expect(exchange.snippets.map((c) => c.label).sort()).toEqual(["TypeScript", "cURL"]);
    expect(authorize.snippets.some((c) => c.code.includes("data.records:read"))).toBe(true);
  });

  it("generates PKCE code only when PKCE is required/supported", () => {
    const withPkce = buildJourney(customGuide);
    const authWith = withPkce.find((s) => s.key === "authorize")!;
    expect(authWith.snippets.some((c) => /code_challenge/.test(c.code))).toBe(true);

    // pkce "not-supported" → NO PKCE params or code anywhere.
    const noPkce = buildJourney({ ...customGuide, implementation: { ...implFull, pkce: "not-supported" as const } });
    const authNo = noPkce.find((s) => s.key === "authorize")!;
    const exchNo = noPkce.find((s) => s.key === "exchange")!;
    expect(authNo.snippets.every((c) => !/code_challenge/.test(c.code))).toBe(true);
    expect(exchNo.snippets.every((c) => !/code_verifier/.test(c.code))).toBe(true);
    expect(noPkce.find((s) => s.key === "grant-type")!.summary).toMatch(/does not use PKCE/i);

    // pkce "unknown" → also no PKCE code (don't assume).
    const unknownPkce = buildJourney({ ...customGuide, implementation: { ...implFull, pkce: "unknown" as const } });
    expect(unknownPkce.find((s) => s.key === "authorize")!.snippets.every((c) => !/code_challenge/.test(c.code))).toBe(true);
  });

  it("stays honest when facts are missing (no snippet, no fabricated URL)", () => {
    const thin = { ...customGuide, implementation: { ...implFull, authorizeUrl: null, tokenUrl: null } };
    const authorize = buildJourney(thin).find((s) => s.key === "authorize")!;
    expect(authorize.established).toBe(false);
    expect(authorize.snippets).toHaveLength(0);
    expect(authorize.docUrl).toBeNull();
    expect(authorize.summary).toMatch(/confirm the exact endpoint/i);
  });
});

describe("buildJourney — managed availability is supplementary", () => {
  // A guide whose data still carries recommendedPath "managed-auth" (older rows,
  // or a model slip) must STILL produce the full custom OAuth walkthrough — the
  // journey is always the custom readiness guide regardless of managed support.
  const managedData = { ...customGuide, recommendedPath: "managed-auth" as const };

  it("always produces the 7 custom OAuth stages, never a Composio-only flow", () => {
    const j = buildJourney(managedData, { toolkitUrl: "https://composio.dev/toolkits/airtable" });
    expect(j.map((s) => s.key)).toEqual([
      "register", "grant-type", "authorize", "exchange", "store-tokens", "api-request", "refresh",
    ]);
    expect(j.every((s) => s.authPath === "custom-oauth")).toBe(true);
    // No managed-only step keys are produced anymore.
    expect(j.some((s) => s.key.startsWith("managed-"))).toBe(false);
  });

  it("ignores the toolkitUrl option (it no longer changes the walkthrough)", () => {
    const withUrl = buildJourney(managedData, { toolkitUrl: "https://composio.dev/toolkits/airtable" });
    const without = buildJourney(managedData);
    expect(withUrl.map((s) => s.key)).toEqual(without.map((s) => s.key));
    // The real custom endpoints are still templated in.
    const exchange = withUrl.find((s) => s.key === "exchange")!;
    expect(exchange.snippets.some((c) => c.code.includes("https://airtable.com/oauth2/v1/token"))).toBe(true);
  });
});
