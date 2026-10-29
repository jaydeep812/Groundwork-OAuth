import { describe, it, expect } from "vitest";
import { critiqueGuide } from "@/lib/graph/critique";
import { scrubIds, groundGuide } from "@/lib/graph/ground";
import type { GeneratedGuide, Finding } from "@/lib/schema/guide";
import { Implementation } from "@/lib/schema/guide";
import type { TavilyResult } from "@/lib/search/tavily";

function baseGuide(): GeneratedGuide {
  return {
    providerName: "X",
    providerUrl: "https://x.com",
    description: "d",
    recommendedPath: "custom-oauth",
    pathRationale: "r",
    difficulty: { rating: "moderate", rationale: "r", findingIds: [] },
    activeEffort: { kind: "estimate", value: null, unit: null, rationale: "r", evidenceIds: [], findingIds: [] },
    externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "r", evidenceIds: [], findingIds: [] },
    prerequisites: [],
    setupSteps: [],
    approvalRequirements: [],
    knownBlockers: [],
    agentCapabilities: [],
    humanHandoff: [],
    evidence: [],
    uncertainties: [],
    findings: [],
    nextAction: "go",
  } as unknown as GeneratedGuide;
}

describe("completeness critic", () => {
  it("flags the required custom-oauth fields as missing on a bare guide", () => {
    const c = critiqueGuide(baseGuide());
    expect(c.complete).toBe(false);
    expect(c.missing).toContain("authorize endpoint URL");
    expect(c.missing).toContain("token endpoint URL");
    expect(c.missing).toContain("developer portal URL");
    expect(c.missing).toContain("setup steps");
    // Scopes / PKCE / rate-limits are NOT forced requirements — a provider may
    // genuinely not have them, so they don't appear in `missing`.
    expect(c.missing).not.toContain("OAuth scopes");
    expect(c.score).toBeLessThan(0.3);
  });

  it("is complete when all checked fields are populated", () => {
    const g = baseGuide();
    (g as GeneratedGuide).implementation = Implementation.parse({
      developerPortalUrl: "https://x.com/dev",
      authorizeUrl: "https://x.com/oauth/authorize",
      tokenUrl: "https://x.com/oauth/token",
      refreshUrl: null,
      revokeUrl: null,
      scopes: [{ name: "read", description: "", required: true }],
      redirectUriRule: "https only",
      pkce: "required",
      tokenLifetime: { kind: "verified", value: 1, unit: "hours", rationale: "r" },
      rateLimits: [{ limit: "10", window: "per second", scope: "all", note: "" }],
      testMode: "sandbox available",
    });
    g.setupSteps = [
      {
        id: "s1",
        title: "t",
        category: "register-provider-app",
        instructions: "i",
        executionMode: "manual",
      },
    ] as unknown as GeneratedGuide["setupSteps"];
    const c = critiqueGuide(g);
    expect(c.missing).toEqual([]);
    expect(c.complete).toBe(true);
    expect(c.score).toBe(1);
  });
});

describe("ground / scrub", () => {
  it("drops dangling findingIds and evidenceIds across nested claims", () => {
    const guide = {
      setupSteps: [{ id: "s1", evidenceIds: ["ev-1", "ghost"], findingIds: ["find_1", "ghost-f"] }],
      difficulty: { findingIds: ["find_1", "nope"] },
    };
    const { evidenceIds, findingIds } = scrubIds(
      guide as unknown as Record<string, unknown>,
      new Set(["ev-1"]),
      new Set(["find_1"]),
    );
    expect(evidenceIds).toBe(1);
    expect(findingIds).toBe(2);
    expect(guide.setupSteps[0].evidenceIds).toEqual(["ev-1"]);
    expect(guide.setupSteps[0].findingIds).toEqual(["find_1"]);
    expect(guide.difficulty.findingIds).toEqual(["find_1"]);
  });

  it("drops fabricated evidence URLs and warns", () => {
    const retrieved: TavilyResult[] = [
      { title: "Real", url: "https://real.com/a", content: "x", score: 1, sourceType: "official-docs" },
    ];
    const guide = {
      ...baseGuide(),
      evidence: [
        { id: "ev-1", title: "Real", url: "https://real.com/a", snippet: "", sourceType: "official-docs" },
        { id: "ev-2", title: "Fake", url: "https://fake.com/none", snippet: "", sourceType: "unknown" },
      ],
    };
    const res = groundGuide(guide as never, retrieved, []);
    const urls = res.evidence.map((e) => e.url);
    expect(urls).toContain("https://real.com/a");
    expect(urls).not.toContain("https://fake.com/none");
    expect(res.warnings.some((w) => w.includes("fake.com"))).toBe(true);
  });

  it("falls back to retrieved sources when the model cited none", () => {
    const retrieved: TavilyResult[] = [
      { title: "Real", url: "https://real.com/a", content: "body", score: 1, sourceType: "official-docs" },
    ];
    const guide = { ...baseGuide(), evidence: [] };
    const res = groundGuide(guide as never, retrieved, []);
    expect(res.evidence).toHaveLength(1);
    expect(res.evidence[0].url).toBe("https://real.com/a");
    expect(res.warnings.some((w) => w.includes("attaching retrieved sources"))).toBe(true);
  });
});
