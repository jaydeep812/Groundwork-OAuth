import { describe, it, expect } from "vitest";
import { bitbucketManagedGuide, BITBUCKET_FACTS } from "./fixtures/bitbucket";
import { buildJourney } from "@/lib/guide/oauth-journey";
import { buildAgentPrompt } from "@/lib/guide/agent-prompt";
import { critiqueGuide, findPathViolations } from "@/lib/graph/critique";
import { Guide } from "@/lib/schema/guide";

/**
 * Bitbucket regression — uses an explicitly-sourced fixture (facts verified
 * against Atlassian's official docs; see tests/fixtures/bitbucket.ts). No live
 * network: this asserts the builders/critic produce correct, honest output for
 * the known-correct Bitbucket shape.
 */
describe("Bitbucket OAuth facts (from official docs)", () => {
  const impl = bitbucketManagedGuide.implementation!;

  it("has the verified authorize and token endpoints", () => {
    expect(impl.authorizeUrl).toBe("https://bitbucket.org/site/oauth2/authorize");
    expect(impl.tokenUrl).toBe("https://bitbucket.org/site/oauth2/access_token");
    expect(impl.authorizeUrl).toBe(BITBUCKET_FACTS.authorizeUrl);
  });

  it("records the 2-hour access-token lifetime and refresh support", () => {
    expect(impl.tokenLifetime?.value).toBe(2);
    expect(impl.tokenLifetime?.unit).toBe("hours");
    expect(impl.tokenLifetime?.kind).toBe("verified");
    expect(impl.refreshUrl).toBe(impl.tokenUrl); // refresh grant at the token endpoint
  });

  it("does NOT claim PKCE (undocumented → unknown, no PKCE code)", () => {
    expect(impl.pkce).toBe("unknown");
    // The custom walkthrough for Bitbucket must not emit PKCE params/code.
    const custom = buildJourney({ ...bitbucketManagedGuide, recommendedPath: "custom-oauth" });
    const allCode = custom.flatMap((s) => s.snippets).map((c) => c.code).join("\n");
    expect(allCode).not.toMatch(/code_challenge|code_verifier/);
    expect(custom.find((s) => s.key === "grant-type")!.summary).toMatch(/not established/i);
  });

  it("populates the developer portal (OAuth consumer location) from a real source", () => {
    expect(impl.developerPortalUrl).toBeTruthy();
    expect(impl.developerPortalUrl).toContain("bitbucket");
  });

  it("the fixture validates against the real Guide schema", () => {
    const candidate = { ...bitbucketManagedGuide, id: "guide_x", slug: "bitbucket", lastResearchedAt: new Date().toISOString(), status: "generated" as const };
    const parsed = Guide.safeParse(candidate);
    expect(parsed.success).toBe(true);
  });
});

describe("Bitbucket — one custom OAuth guide (managed availability is supplementary)", () => {
  it("always builds the custom OAuth walkthrough with the real endpoints", () => {
    const j = buildJourney(bitbucketManagedGuide, { toolkitUrl: "https://composio.dev/toolkits/bitbucket" });
    expect(j.map((s) => s.key)).toContain("register");
    expect(j.some((s) => s.key.startsWith("managed-"))).toBe(false);
    const exchange = j.find((s) => s.key === "exchange")!;
    expect(exchange.snippets.some((c) => c.code.includes("https://bitbucket.org/site/oauth2/access_token"))).toBe(true);
  });

  it("the coding-agent prompt is the custom OAuth brief (real endpoints, no Composio toolkit URL)", () => {
    const p = buildAgentPrompt(bitbucketManagedGuide, undefined, { toolkitUrl: "https://composio.dev/toolkits/bitbucket" })!;
    expect(p).toContain("https://bitbucket.org/site/oauth2/access_token");
    expect(p).not.toContain("https://composio.dev/toolkits/bitbucket");
  });

  it("the critic reports no path violations (single path, nothing to contradict)", () => {
    expect(findPathViolations(bitbucketManagedGuide)).toHaveLength(0);
    expect(critiqueGuide(bitbucketManagedGuide).violations).toHaveLength(0);
  });

  it("custom OAuth remains the walkthrough with the real endpoints", () => {
    const alt = buildJourney({ ...bitbucketManagedGuide, recommendedPath: "custom-oauth" });
    const exchange = alt.find((s) => s.key === "exchange")!;
    expect(exchange.snippets.some((c) => c.code.includes("https://bitbucket.org/site/oauth2/access_token"))).toBe(true);
  });
});
