import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TavilyResult } from "@/lib/search/tavily";

// Mock the safe-fetch module so the catalog-agent test runs offline.
vi.mock("@/lib/investigation/safe-fetch", () => ({
  headProbe: vi.fn(),
  getProbe: vi.fn(),
  errorProbePost: vi.fn(),
  stripHtml: (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
}));
vi.mock("@/lib/search/tavily", async (orig) => {
  const actual = await orig<typeof import("@/lib/search/tavily")>();
  return { ...actual, tavilySearch: vi.fn() };
});

import { catalogAgent } from "@/lib/investigation/agents/catalog-agent";
import { constraintsAgent } from "@/lib/investigation/agents/constraints-agent";
import { docsAgent } from "@/lib/investigation/agents/docs-agent";
import { headProbe, getProbe } from "@/lib/investigation/safe-fetch";
import { tavilySearch } from "@/lib/search/tavily";

const makeCtx = (overrides: Partial<Parameters<typeof catalogAgent>[0]> = {}) => ({
  providerName: "Testo",
  providerDomains: ["testo.com"],
  useCase: "",
  tavily: [] as TavilyResult[],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("catalog-agent", () => {
  it("reports insufficient when no candidate URL resolves", async () => {
    vi.mocked(headProbe).mockResolvedValue({
      url: "x",
      finalUrl: null,
      ok: false,
      status: 404,
      contentType: null,
      error: null,
    });
    const [f] = await catalogAgent(makeCtx());
    expect(f.outcome).toBe("insufficient");
    expect(f.agent).toBe("catalog-agent");
  });

  it("reports confirmed when a toolkit page resolves AND mentions the provider", async () => {
    vi.mocked(headProbe).mockResolvedValue({
      url: "https://composio.dev/toolkits/testo",
      finalUrl: "https://composio.dev/toolkits/testo",
      ok: true,
      status: 200,
      contentType: "text/html",
      error: null,
    });
    vi.mocked(getProbe).mockResolvedValue({
      url: "https://composio.dev/toolkits/testo",
      finalUrl: "https://composio.dev/toolkits/testo",
      ok: true,
      status: 200,
      contentType: "text/html",
      error: null,
      body: "<html>Testo managed OAuth toolkit for Composio</html>",
      truncated: false,
    });
    const [f] = await catalogAgent(makeCtx());
    expect(f.outcome).toBe("confirmed");
    expect(f.evidence[0]?.sourceType).toBe("composio-docs");
  });

  it("reports insufficient when the page loads but doesn't mention the provider (false positive guard)", async () => {
    vi.mocked(headProbe).mockResolvedValue({
      url: "https://composio.dev/toolkits/testo",
      finalUrl: "https://composio.dev/toolkits/testo",
      ok: true,
      status: 200,
      contentType: "text/html",
      error: null,
    });
    vi.mocked(getProbe).mockResolvedValue({
      url: "https://composio.dev/toolkits/testo",
      finalUrl: "https://composio.dev/toolkits/testo",
      ok: true,
      status: 200,
      contentType: "text/html",
      error: null,
      body: "<html>Page not found</html>",
      truncated: false,
    });
    const [f] = await catalogAgent(makeCtx());
    expect(f.outcome).toBe("insufficient");
  });
});

describe("docs-agent", () => {
  it("is honest about empty authoritative evidence", async () => {
    const [f] = await docsAgent(makeCtx({ tavily: [] }));
    expect(f.outcome).toBe("insufficient");
    expect(f.uncertainty).toMatch(/authoritative/i);
  });

  it("fetches and reports from authoritative URLs", async () => {
    vi.mocked(getProbe).mockResolvedValue({
      url: "https://testo.com/docs",
      finalUrl: "https://testo.com/docs",
      ok: true,
      status: 200,
      contentType: "text/html",
      error: null,
      body: "<p>Hello</p>",
      truncated: false,
    });
    const findings = await docsAgent(
      makeCtx({
        tavily: [
          {
            title: "Docs",
            url: "https://testo.com/docs",
            content: "",
            score: 1,
            sourceType: "official-docs",
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].outcome).toBe("confirmed");
    expect(findings[0].evidence[0].sourceType).toBe("official-docs");
  });
});

describe("constraints-agent", () => {
  it("records insufficient for on-domain-only topics when only community hits exist, but admits community evidence for the approval-timeline topic (marked as community-reported)", async () => {
    vi.mocked(tavilySearch).mockResolvedValue([
      { title: "x", url: "https://blog.io/x", content: "Developers report verification takes 2-3 weeks.", score: 1, sourceType: "community" },
    ]);
    const findings = await constraintsAgent(makeCtx());
    expect(findings.length).toBeGreaterThan(0);

    // Approval turnaround lives off-domain (forums), so its topic admits the
    // community hit as "supports" and flags it as community-reported — never
    // dropping the one datum the product cares most about.
    const timeline = findings.find((f) => /approval\/verification review take/i.test(f.question));
    expect(timeline).toBeDefined();
    expect(timeline!.outcome).toBe("supports");
    expect(timeline!.uncertainty).toMatch(/community/i);

    // Every other topic stays strict: community-only evidence is insufficient.
    for (const f of findings) {
      if (f === timeline) continue;
      expect(f.outcome).toBe("insufficient");
    }
  });

  it("records supports when at least one authoritative source is found", async () => {
    vi.mocked(tavilySearch).mockResolvedValue([
      {
        title: "Pricing",
        url: "https://testo.com/pricing",
        content: "The API is free up to 1000 requests/day.",
        score: 1,
        sourceType: "official-docs",
      },
    ]);
    const findings = await constraintsAgent(makeCtx());
    // At least one topic should have been "supports" against the stubbed result.
    expect(findings.some((f) => f.outcome === "supports")).toBe(true);
  });
});
