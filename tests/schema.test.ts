import { describe, it, expect } from "vitest";
import { Guide, GeneratedGuide } from "@/lib/schema/guide";
import { SEED_GUIDES } from "@/lib/db/seed-data";

describe("Guide schema", () => {
  it("accepts every seeded guide", () => {
    for (const g of SEED_GUIDES) {
      const res = Guide.safeParse(g);
      expect(res.success, `seed "${g.slug}": ${JSON.stringify(res.success ? {} : res.error.issues[0])}`).toBe(true);
    }
  });

  it("rejects a non-kebab-case slug", () => {
    const bad = { ...SEED_GUIDES[0], slug: "Not Kebab" };
    expect(Guide.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid provider URL", () => {
    const bad = { ...SEED_GUIDES[0], providerUrl: "not-a-url" };
    expect(Guide.safeParse(bad).success).toBe(false);
  });

  it("rejects evidence entries with non-URL urls", () => {
    const bad = {
      ...SEED_GUIDES[0],
      evidence: [{ id: "x", title: "t", url: "javascript:alert(1)", snippet: "", sourceType: "unknown" }],
    };
    expect(Guide.safeParse(bad).success).toBe(false);
  });

  it("GeneratedGuide omits server-controlled fields", () => {
    const keys = Object.keys(GeneratedGuide.shape);
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("slug");
    expect(keys).not.toContain("lastResearchedAt");
    expect(keys).not.toContain("status");
  });

  it("applies defaults for optional collections", () => {
    const minimal = {
      providerName: "X",
      providerUrl: "https://x.com",
      description: "d",
      recommendedPath: "custom-oauth",
      pathRationale: "r",
      difficulty: { rating: "easy", rationale: "r" },
      activeEffort: { kind: "estimate", rationale: "r" },
      externalWaiting: { kind: "unknown", rationale: "r" },
      setupSteps: [],
      evidence: [],
      nextAction: "do it",
    };
    const res = GeneratedGuide.safeParse(minimal);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.prerequisites).toEqual([]);
      expect(res.data.activeEffort.value).toBeNull();
      // findingIds defaults to [] on every claim-bearing object even when
      // the input omits them (so curated seeds don't have to carry them).
      expect(res.data.difficulty.findingIds).toEqual([]);
      expect(res.data.activeEffort.findingIds).toEqual([]);
      expect(res.data.externalWaiting.findingIds).toEqual([]);
    }
  });

  it("round-trips a Guide with embedded Findings and findingIds on claims", async () => {
    const { Guide } = await import("@/lib/schema/guide");
    const g = {
      id: "g1",
      slug: "x",
      providerName: "X",
      providerUrl: "https://x.com",
      description: "d",
      recommendedPath: "custom-oauth",
      pathRationale: "r",
      difficulty: { rating: "moderate", rationale: "r", findingIds: ["find_1"] },
      activeEffort: { kind: "estimate", rationale: "r", findingIds: ["find_1"] },
      externalWaiting: { kind: "unknown", rationale: "r" },
      setupSteps: [
        {
          id: "s1",
          title: "Register",
          category: "register-provider-app",
          instructions: "Go to the portal.",
          executionMode: "manual",
          findingIds: ["find_1"],
        },
      ],
      knownBlockers: [
        { id: "b1", title: "Blocked", description: "d", findingIds: ["find_1"] },
      ],
      findings: [
        {
          id: "find_1",
          agent: "docs-agent",
          question: "q?",
          attempted: "did x",
          attemptKind: "docs-read",
          outcome: "confirmed",
          conclusion: "c",
          at: new Date().toISOString(),
        },
      ],
      lastResearchedAt: new Date().toISOString(),
      status: "generated",
      nextAction: "go",
    };
    const res = Guide.safeParse(g);
    expect(res.success, JSON.stringify(res.success ? {} : res.error.issues[0])).toBe(true);
    if (res.success) {
      expect(res.data.findings).toHaveLength(1);
      expect(res.data.setupSteps[0].findingIds).toEqual(["find_1"]);
      expect(res.data.knownBlockers[0].findingIds).toEqual(["find_1"]);
    }
  });
});
