import { describe, it, expect } from "vitest";
import { sanitizeDraft } from "@/lib/graph/nodes/synthesize";
import { GeneratedGuide } from "@/lib/schema/guide";

/**
 * Regression for the Strava failure: the model emitted real facts with
 * out-of-enum units ("seconds", "weeks") and an estimate missing its
 * rationale, which discarded the whole guide as "invalid JSON". sanitizeDraft
 * must preserve the datum by rescaling the unit and backfilling structure so
 * the guide validates.
 */
function base(): Record<string, unknown> {
  return {
    providerName: "Strava",
    providerUrl: "https://www.strava.com",
    description: "d",
    recommendedPath: "custom-oauth",
    pathRationale: "r",
    difficulty: { rating: "moderate", rationale: "r", findingIds: [] },
    activeEffort: { kind: "estimate", value: 30, unit: "minutes", rationale: "r", evidenceIds: [], findingIds: [] },
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
  };
}

describe("sanitizeDraft — unit normalization", () => {
  it("rescales a 21600-second token lifetime into 6 hours", () => {
    const g = base();
    g.implementation = {
      developerPortalUrl: null, authorizeUrl: null, tokenUrl: null, refreshUrl: null, revokeUrl: null,
      scopes: [], redirectUriRule: "", pkce: "unknown", rateLimits: [], testMode: "", evidenceIds: [], findingIds: [],
      tokenLifetime: { kind: "verified", value: 21600, unit: "seconds", rationale: "Expires in 6h." },
    };
    sanitizeDraft(g);
    const tl = (g.implementation as Record<string, unknown>).tokenLifetime as Record<string, unknown>;
    expect(tl.value).toBe(6);
    expect(tl.unit).toBe("hours");
  });

  it("rescales a 2-week approval timeline into 14 days", () => {
    const g = base();
    g.approvalRequirements = [
      { id: "a1", title: "App review", description: "Scope review", kind: "provider-review",
        timeline: { kind: "estimate", value: 2, unit: "weeks", rationale: "Several weeks." }, evidenceIds: [], findingIds: [] },
    ];
    sanitizeDraft(g);
    const tl = (g.approvalRequirements as Record<string, unknown>[])[0].timeline as Record<string, unknown>;
    expect(tl.value).toBe(14);
    expect(tl.unit).toBe("days");
  });

  it("backfills a missing rationale on a nested estimate", () => {
    const g = base();
    g.approvalRequirements = [
      { id: "a1", title: "App review", description: "Scope review", kind: "provider-review",
        timeline: { kind: "estimate", value: 2, unit: "days" }, evidenceIds: [], findingIds: [] },
    ];
    sanitizeDraft(g);
    const tl = (g.approvalRequirements as Record<string, unknown>[])[0].timeline as Record<string, unknown>;
    expect(typeof tl.rationale).toBe("string");
    expect((tl.rationale as string).length).toBeGreaterThan(0);
  });

  it("produces a Strava-shaped draft that validates end-to-end", () => {
    const g = base();
    g.implementation = {
      developerPortalUrl: "https://www.strava.com/settings/api", authorizeUrl: "https://www.strava.com/oauth/authorize",
      tokenUrl: "https://www.strava.com/oauth/token", refreshUrl: "https://www.strava.com/oauth/token", revokeUrl: null,
      scopes: [{ name: "activity:read_all", description: "", required: true, evidenceIds: [], findingIds: [] }],
      redirectUriRule: "Must match the callback domain.", pkce: "unknown",
      tokenLifetime: { kind: "verified", value: 21600, unit: "seconds", rationale: "6h." },
      rateLimits: [], testMode: "", evidenceIds: [], findingIds: [],
    };
    g.approvalRequirements = [
      { id: "a1", title: "Review", description: "Scope review", kind: "provider-review",
        timeline: { kind: "estimate", value: 2, unit: "weeks" }, evidenceIds: [], findingIds: [] },
    ];
    sanitizeDraft(g);
    expect(GeneratedGuide.safeParse(g).success).toBe(true);
  });

  it("leaves already-valid units untouched", () => {
    const g = base();
    (g.activeEffort as Record<string, unknown>).unit = "hours";
    (g.activeEffort as Record<string, unknown>).value = 3;
    sanitizeDraft(g);
    expect((g.activeEffort as Record<string, unknown>).unit).toBe("hours");
    expect((g.activeEffort as Record<string, unknown>).value).toBe(3);
  });
});
