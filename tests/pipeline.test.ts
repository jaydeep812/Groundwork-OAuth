import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external boundaries so the graph runs without network or API keys. The
// graph fans out to five investigator agents; we mock each to return a single
// Finding, and mock the LLM so synthesis is deterministic.
vi.mock("@/lib/search/tavily", async (orig) => {
  const actual = await orig<typeof import("@/lib/search/tavily")>();
  return {
    ...actual,
    tavilySearchMany: vi.fn(),
    tavilySearch: vi.fn(),
  };
});
vi.mock("@/lib/graph/llm", () => ({
  generateJsonLC: vi.fn(),
  generateObjectLC: vi.fn(),
  GraphLlmError: class extends Error {},
}));

function findingModule(agent: string) {
  return {
    [`${agent}Agent`]: vi.fn().mockResolvedValue([
      {
        id: `find_${agent}`,
        agent,
        question: "q",
        attempted: "a",
        attemptKind: "search",
        outcome: "insufficient",
        conclusion: "c",
        observation: "",
        evidence: [],
        uncertainty: "",
        at: new Date().toISOString(),
      },
    ]),
  };
}
vi.mock("@/lib/investigation/agents/docs-agent", () => findingModule("docs"));
vi.mock("@/lib/investigation/agents/portal-agent", () => findingModule("portal"));
vi.mock("@/lib/investigation/agents/catalog-agent", () => findingModule("catalog"));
vi.mock("@/lib/investigation/agents/auth-endpoint-agent", () => ({
  authEndpointAgent: findingModule("authEndpoint")["authEndpointAgent"],
}));
vi.mock("@/lib/investigation/agents/constraints-agent", () => findingModule("constraints"));

// Use an isolated per-run DB so tests don't pollute the dev database.
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(tmpdir(), `oauth-guide-test-${process.pid}-${Date.now()}.db`);

import { runGraph } from "@/lib/graph/run";
import { tavilySearchMany, tavilySearch } from "@/lib/search/tavily";
import { generateJsonLC, generateObjectLC } from "@/lib/graph/llm";

const REAL_URL = "https://docs.example.com/oauth";

const validModelJson = JSON.stringify({
  providerName: "Example",
  providerUrl: "https://example.com",
  description: "An example provider.",
  recommendedPath: "custom-oauth",
  pathRationale: "Needs its own app.",
  difficulty: { rating: "moderate", rationale: "Some steps." },
  activeEffort: { kind: "estimate", value: 1, unit: "hours", rationale: "r", evidenceIds: ["ev-1"] },
  externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "no published timeline", evidenceIds: [] },
  implementation: {
    developerPortalUrl: null,
    authorizeUrl: "https://example.com/oauth/authorize",
    tokenUrl: "https://example.com/oauth/token",
    refreshUrl: null,
    revokeUrl: null,
    scopes: [{ name: "read", description: "Read access", required: true }],
    redirectUriRule: "Must be https and exactly match a registered value.",
    pkce: "supported",
    tokenLifetime: { kind: "unknown", value: null, unit: null, rationale: "not stated" },
    rateLimits: [],
    testMode: "",
  },
  prerequisites: [],
  setupSteps: [
    {
      id: "step-register",
      title: "Register app",
      category: "register-provider-app",
      instructions: "Do it in the dashboard.",
      rationale: "Needed for credentials.",
      required: true,
      appliesWhen: null,
      fields: [],
      expectedOutcome: "You get a client id.",
      verification: "See the id.",
      recovery: "Retry.",
      executionMode: "manual",
      evidenceIds: ["ev-1"],
    },
  ],
  approvalRequirements: [],
  knownBlockers: [],
  agentCapabilities: ["explain scopes"],
  humanHandoff: ["create the app"],
  evidence: [
    { id: "ev-1", title: "Example OAuth docs", url: REAL_URL, snippet: "set up oauth", sourceType: "official-docs" },
    // A fabricated source the graph must drop:
    { id: "ev-2", title: "Made up", url: "https://fabricated.example/none", snippet: "", sourceType: "unknown" },
  ],
  uncertainties: [],
  nextAction: "Register the app.",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tavilySearch).mockResolvedValue([]);
  vi.mocked(generateObjectLC).mockResolvedValue({ queries: ["Example token endpoint url"] });
});

describe("research graph", () => {
  it("fails validation when provider input is empty", async () => {
    const res = await runGraph({ providerNameOrUrl: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("validate");
  });

  it("fails honestly when no evidence is retrieved (no fabricated guide)", async () => {
    vi.mocked(tavilySearchMany).mockResolvedValue({ results: [], errors: [], queriesRun: [] });
    const res = await runGraph({ providerNameOrUrl: "Example" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("search");
    expect(generateJsonLC).not.toHaveBeenCalled();
  });

  it("generates, validates, grounds evidence, and persists on success", async () => {
    vi.mocked(tavilySearchMany).mockResolvedValue({
      results: [
        { title: "Example OAuth docs", url: REAL_URL, content: "set up oauth", score: 0.9, sourceType: "official-docs" },
      ],
      errors: [],
      queriesRun: ["q"],
    });
    vi.mocked(generateJsonLC).mockResolvedValue(validModelJson);

    const res = await runGraph({ providerNameOrUrl: "Example" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const urls = res.guide.evidence.map((e) => e.url);
      expect(urls).toContain(REAL_URL);
      expect(urls).not.toContain("https://fabricated.example/none");
      expect(res.warnings.some((w) => w.includes("fabricated.example"))).toBe(true);
      expect(res.guide.status).toBe("generated");
      expect(res.guide.slug).toMatch(/^[a-z0-9-]+$/);
      expect(res.guide.id).toBeTruthy();
      // Implementation pack survives round-trip.
      expect(res.guide.implementation?.authorizeUrl).toBe("https://example.com/oauth/authorize");
      expect(res.guide.implementation?.scopes[0]?.name).toBe("read");
      // The five investigator agents each contributed a finding, plus the two
      // deterministic retrieval probes (oauth-metadata-probe + endpoint-extract)
      // each leave an honest note (confirmed, or insufficient when offline).
      expect(res.guide.findings.length).toBe(7);
      expect(res.guide.findings.some((f) => f.agent === "oauth-metadata-probe")).toBe(true);
      expect(res.guide.findings.some((f) => f.agent === "endpoint-extract")).toBe(true);
    }
  });

  it("fails at validation when the model returns invalid JSON", async () => {
    vi.mocked(tavilySearchMany).mockResolvedValue({
      results: [{ title: "t", url: REAL_URL, content: "", score: 1, sourceType: "official-docs" }],
      errors: [],
      queriesRun: ["q"],
    });
    vi.mocked(generateJsonLC).mockResolvedValue("not json{");
    const res = await runGraph({ providerNameOrUrl: "Example" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("validation");
  });
});
