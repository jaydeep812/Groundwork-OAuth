import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external boundaries. The deep graph fans out to five agents; we mock
// each agent module to return a single Finding, and mock the LLM so synthesis
// is deterministic. The critic will never be "complete" (the synthesized guide
// has no implementation endpoints), so deep mode must loop until MAX_LOOPS.
vi.mock("@/lib/search/tavily", async (orig) => {
  const actual = await orig<typeof import("@/lib/search/tavily")>();
  return { ...actual, tavilySearchMany: vi.fn(), tavilySearch: vi.fn() };
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
  authEndpointAgent: vi.fn().mockResolvedValue([
    {
      id: "find_auth",
      agent: "auth-endpoint-agent",
      question: "q",
      attempted: "a",
      attemptKind: "api-error-probe",
      outcome: "insufficient",
      conclusion: "c",
      observation: "",
      evidence: [],
      uncertainty: "",
      at: new Date().toISOString(),
    },
  ]),
}));
vi.mock("@/lib/investigation/agents/constraints-agent", () => findingModule("constraints"));

import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(tmpdir(), `oauth-guide-deep-${process.pid}-${Date.now()}.db`);

import { runGraph } from "@/lib/graph/run";
import { tavilySearchMany, tavilySearch } from "@/lib/search/tavily";
import { generateJsonLC, generateObjectLC } from "@/lib/graph/llm";
import { MAX_LOOPS } from "@/lib/graph/state";

const REAL_URL = "https://docs.example.com/oauth";

// A guide with NO implementation endpoints — the critic always flags gaps.
const incompleteGuide = JSON.stringify({
  providerName: "Example",
  providerUrl: "https://example.com",
  description: "d",
  recommendedPath: "other",
  pathRationale: "non-oauth",
  difficulty: { rating: "hard", rationale: "r" },
  activeEffort: { kind: "unknown", value: null, unit: null, rationale: "r" },
  externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "r" },
  setupSteps: [],
  evidence: [{ id: "ev-1", title: "t", url: REAL_URL, snippet: "", sourceType: "official-docs" }],
  nextAction: "go",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tavilySearch).mockResolvedValue([]);
  vi.mocked(tavilySearchMany).mockResolvedValue({
    results: [{ title: "t", url: REAL_URL, content: "x", score: 1, sourceType: "official-docs" }],
    errors: [],
    queriesRun: ["q"],
  });
  vi.mocked(generateJsonLC).mockResolvedValue(incompleteGuide);
  vi.mocked(generateObjectLC).mockResolvedValue({ queries: ["Example token endpoint url"] });
});

describe("research graph (deep mode)", () => {
  it("runs the five agents and embeds findings", async () => {
    const res = await runGraph({ providerNameOrUrl: "Example" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Five investigator agents + two deterministic retrieval probes
      // (oauth-metadata-probe, endpoint-extract) each contribute one finding.
      expect(res.guide.findings.length).toBe(7);
      expect(res.guide.status).toBe("generated");
    }
  });

  it("re-plans and re-searches, terminating at MAX_LOOPS", async () => {
    const res = await runGraph({ providerNameOrUrl: "Example" });
    expect(res.ok).toBe(true);
    // Synthesis runs once per loop → exactly MAX_LOOPS times (never infinite).
    expect(vi.mocked(generateJsonLC).mock.calls.length).toBe(MAX_LOOPS);
    // The re-plan loop fired: search ran more than once (loop 0 + re-search).
    // Recovery is now deterministic-first (reason-driven queries), so it does
    // NOT require the model re-plan call — but it must re-search.
    expect(vi.mocked(tavilySearchMany).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
