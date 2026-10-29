import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeResults, reclassifyResults, tavilySearch, tavilySearchMany, TavilyError } from "@/lib/search/tavily";
import {
  rankEvidence,
  buildQueries,
  determineProviderDomain,
} from "@/lib/research/helpers";
import type { TavilyResult } from "@/lib/search/tavily";

describe("Tavily result normalization", () => {
  it("drops malformed entries and dedups by URL", () => {
    const raw = [
      { title: "A", url: "https://docs.example.com/oauth", content: "x", score: 0.9 },
      { title: "A dup", url: "https://docs.example.com/oauth", content: "y", score: 0.5 }, // dup URL
      { title: "", url: "https://example.com/empty-title" }, // no title
      { url: "https://example.com/no-title" }, // no title
      { title: "No URL" }, // no url
      "garbage",
      null,
      { title: "Bad URL", url: "not a url" },
    ];
    const out = normalizeResults(raw);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://docs.example.com/oauth");
  });

  it("classifies without a provider domain (initial pass)", () => {
    // Initial classification runs with no provider-domain hint.
    // Developer-portal / official-docs can only be credited later after
    // the pipeline reclassifies against the established provider domain.
    const out = normalizeResults([
      { title: "docs", url: "https://developers.google.com/identity", content: "" },
      { title: "composio", url: "https://docs.composio.dev/toolkits/github", content: "" },
      { title: "blog", url: "https://medium.com/some-post", content: "" },
      { title: "nango", url: "https://nango.dev/x", content: "" },
    ]);
    const byUrl = Object.fromEntries(out.map((r) => [r.url, r.sourceType]));
    // Without a provider domain, "developers.google.com" cannot yet be credited
    // as developer-portal — the pipeline earns that during reclassification.
    expect(byUrl["https://developers.google.com/identity"]).toBe("unknown");
    expect(byUrl["https://docs.composio.dev/toolkits/github"]).toBe("composio-docs");
    expect(byUrl["https://medium.com/some-post"]).toBe("community");
    expect(byUrl["https://nango.dev/x"]).toBe("third-party-integration");
  });

  it("returns [] for non-array input", () => {
    expect(normalizeResults(undefined)).toEqual([]);
    expect(normalizeResults({})).toEqual([]);
  });
});

describe("tavilySearch retry", () => {
  const prevKey = process.env.TAVILY_API_KEY;
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.TAVILY_API_KEY = prevKey;
  });

  function okResponse() {
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: "A", url: "https://docs.x.com/a", content: "", score: 1 }] }),
    } as unknown as Response;
  }
  function errResponse(status: number, headers: Record<string, string> = {}) {
    return {
      ok: false,
      status,
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
      text: async () => "rate limited",
    } as unknown as Response;
  }

  it("retries a 429 then succeeds, honoring Retry-After", async () => {
    process.env.TAVILY_API_KEY = "test";
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(errResponse(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(okResponse());
    const out = await tavilySearch("q", { maxAttempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
  });

  it("does not retry a non-retryable 4xx (e.g. 400) and throws", async () => {
    process.env.TAVILY_API_KEY = "test";
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(errResponse(400));
    await expect(tavilySearch("q", { maxAttempts: 3 })).rejects.toBeInstanceOf(TavilyError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on a client error
  });

  it("collects per-query errors in tavilySearchMany without failing the batch", async () => {
    process.env.TAVILY_API_KEY = "test";
    // First query always 400s (non-retryable); second always succeeds.
    vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      return Promise.resolve(body.query === "bad" ? errResponse(400) : okResponse());
    });
    const { results, errors } = await tavilySearchMany(["bad", "good"], { maxAttempts: 1 });
    expect(results).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bad");
  });
});

describe("Evidence ranking", () => {
  it("prefers official/developer sources over third-party integrations and community", () => {
    const results: TavilyResult[] = [
      { title: "community", url: "https://medium.com/a", content: "", score: 0.99, sourceType: "community" },
      { title: "official", url: "https://docs.x.com/a", content: "", score: 0.1, sourceType: "official-docs" },
      { title: "composio", url: "https://docs.composio.dev/x", content: "", score: 0.1, sourceType: "composio-docs" },
      { title: "3p", url: "https://nango.dev/a", content: "", score: 0.5, sourceType: "third-party-integration" },
    ];
    const ranked = rankEvidence(results);
    expect(ranked[0].sourceType).toBe("official-docs");
    expect(ranked[ranked.length - 1].sourceType).toBe("community");
  });
});

describe("Query construction", () => {
  it("builds bounded, targeted queries including the provider and Composio", () => {
    const qs = buildQueries("Notion");
    expect(qs.length).toBeLessThanOrEqual(6);
    expect(qs.every((q) => q.includes("Notion"))).toBe(true);
    expect(qs.some((q) => /verification|approval/i.test(q))).toBe(true);
  });
});

describe("reclassifyResults", () => {
  it("promotes provider-domain hosts to official-docs/developer-portal", () => {
    const input: TavilyResult[] = [
      { title: "api", url: "https://kite.trade/docs/connect/v3", content: "", score: 1, sourceType: "unknown" },
      { title: "portal", url: "https://developers.kite.trade/login", content: "", score: 1, sourceType: "unknown" },
      { title: "third", url: "https://docs.openalgo.in/x", content: "", score: 1, sourceType: "third-party-integration" },
    ];
    const out = reclassifyResults(input, ["kite.trade"]);
    const byUrl = Object.fromEntries(out.map((r) => [r.url, r.sourceType]));
    expect(byUrl["https://kite.trade/docs/connect/v3"]).toBe("official-docs");
    expect(byUrl["https://developers.kite.trade/login"]).toBe("developer-portal");
    // Third-party stays third-party even when a domain is supplied.
    expect(byUrl["https://docs.openalgo.in/x"]).toBe("third-party-integration");
  });

  it("is a no-op when no provider domains are supplied", () => {
    const input: TavilyResult[] = [
      { title: "a", url: "https://x.com/a", content: "", score: 1, sourceType: "unknown" },
    ];
    expect(reclassifyResults(input, [])).toEqual(input);
  });
});

describe("determineProviderDomain", () => {
  const base: Pick<TavilyResult, "content" | "score"> = { content: "", score: 1 };

  it("uses the input URL's registrable host when provided", () => {
    expect(
      determineProviderDomain(
        "Kite",
        "https://developers.kite.trade/login",
        [],
        true,
      ),
    ).toBe("kite.trade");
  });

  it("picks the provider-name-matching host from retrieved evidence", () => {
    expect(
      determineProviderDomain(
        "Kite",
        "https://www.google.com/search?q=Kite",
        [
          { ...base, title: "x", url: "https://kite.trade/docs/x", sourceType: "unknown" },
          { ...base, title: "x", url: "https://docs.openalgo.in/zerodha", sourceType: "third-party-integration" },
        ],
        false,
      ),
    ).toBe("kite.trade");
  });

  it("ignores third-party-integration and community hosts even if the name matches", () => {
    // Hypothetical case: a third-party integration platform's host happens to
    // contain the provider name — we must NOT establish it as the provider domain.
    const r = determineProviderDomain(
      "Nango",
      "https://www.google.com/search?q=Nango",
      [
        { ...base, title: "x", url: "https://nango.dev/docs", sourceType: "third-party-integration" },
      ],
      false,
    );
    expect(r).toBeNull();
  });

  it("returns null when no retrieved host matches the provider name", () => {
    expect(
      determineProviderDomain(
        "Linear",
        "https://www.google.com/search?q=Linear",
        [
          { ...base, title: "x", url: "https://nocodb.com/linear", sourceType: "unknown" },
        ],
        false,
      ),
    ).toBeNull();
  });

  it("matches a multi-word provider name via its tokens (e.g. 'Kite Connect (Zerodha)' → kite.trade)", () => {
    expect(
      determineProviderDomain(
        "Kite Connect (Zerodha)",
        "https://www.google.com/search?q=Kite",
        [
          { ...base, title: "x", url: "https://kite.trade/docs/connect/v3", sourceType: "unknown" },
          { ...base, title: "x", url: "https://zerodha.com/products", sourceType: "unknown" },
          { ...base, title: "x", url: "https://docs.openalgo.in/x", sourceType: "third-party-integration" },
        ],
        false,
      ),
    ).toMatch(/^(kite\.trade|zerodha\.com)$/);
  });

  it("ignores very short tokens so 'go' doesn't match arbitrary hosts", () => {
    const r = determineProviderDomain(
      "A B Go",
      "https://www.google.com/search?q=A",
      [
        { ...base, title: "x", url: "https://google.com/x", sourceType: "unknown" },
      ],
      false,
    );
    expect(r).toBeNull();
  });
});
