import { describe, it, expect } from "vitest";
import { extractEndpoints, pickEndpointDocPage, docVariantUrls } from "@/lib/research/endpoint-extract";
import type { TavilyResult } from "@/lib/search/tavily";

describe("extractEndpoints", () => {
  it("pulls authorize/token/revoke URLs on the provider domain from page text", () => {
    const text = `
      To start, redirect the user to https://slack.com/oauth/v2/authorize?client_id=123.
      Exchange the code at https://slack.com/api/oauth.v2.access for a token.
      Revoke with https://slack.com/api/auth.revoke when done.
    `;
    const hits = extractEndpoints(text, ["slack.com"]);
    const byKind = Object.fromEntries(hits.map((h) => [h.kind, h.url]));
    expect(byKind.authorize).toContain("slack.com/oauth/v2/authorize");
    expect(byKind.token).toContain("oauth.v2.access");
    expect(byKind.revoke).toContain("auth.revoke");
  });

  it("ignores endpoint-looking URLs on OTHER domains (never trust third parties)", () => {
    const text = `See https://nango.dev/oauth/authorize and https://blog.example.com/token for context.`;
    expect(extractEndpoints(text, ["slack.com"])).toHaveLength(0);
  });

  it("trims trailing punctuation and dedups", () => {
    const text = `Use https://slack.com/oauth/v2/authorize. Again: https://slack.com/oauth/v2/authorize).`;
    const hits = extractEndpoints(text, ["slack.com"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].url.endsWith("authorize")).toBe(true);
  });

  it("returns nothing when there are no provider domains", () => {
    expect(extractEndpoints("https://slack.com/oauth/v2/authorize", [])).toHaveLength(0);
  });

  it("strips inline query params/fragment → the bare endpoint (regression)", () => {
    // Docs often show the authorize endpoint as a full example URL. The stored
    // endpoint must be copyable, not ".../authorize?response_type=code&...".
    const text =
      "Redirect to https://account.boldsign.com/connect/authorize?response_type=code&client_id=X&code_challenge=C#frag then exchange at https://account.boldsign.com/connect/token.";
    const hits = extractEndpoints(text, ["boldsign.com"]);
    const auth = hits.find((h) => h.kind === "authorize")!;
    expect(auth.url).toBe("https://account.boldsign.com/connect/authorize");
    expect(auth.url).not.toMatch(/[?#]/);
  });

  it("strips markdown backtick wrappers and %60 from endpoint URLs (regression)", () => {
    // The `.md` doc-variant rung feeds Markdown, which wraps URLs in backticks:
    // `https://miro.com/oauth/authorize`. The trailing backtick (literal or
    // percent-encoded as %60) must NOT become part of the stored endpoint.
    const md = "Authorize at `https://miro.com/oauth/authorize` then POST to `https://api.miro.com/v1/oauth/token`.";
    const hits = extractEndpoints(md, ["miro.com", "api.miro.com"]);
    const byKind = Object.fromEntries(hits.map((h) => [h.kind, h.url]));
    expect(byKind.authorize).toBe("https://miro.com/oauth/authorize");
    expect(byKind.token).toBe("https://api.miro.com/v1/oauth/token");
    expect(byKind.authorize).not.toMatch(/%60|`/);
  });

  it("does not glue two URLs across a markdown link ](  (regression)", () => {
    // Markdown links [label](url) previously made the regex swallow "](" and
    // concatenate two copies of the URL. The endpoint must be the clean URL once.
    const md = "Exchange the code at [the token endpoint](https://api.notion.com/v1/oauth/token).";
    const hits = extractEndpoints(md, ["api.notion.com"]);
    const token = hits.find((h) => h.kind === "token")!;
    expect(token.url).toBe("https://api.notion.com/v1/oauth/token");
    expect(token.url).not.toMatch(/\]\(|token.*token/);
  });

  it("rejects documentation-PAGE URLs that merely contain an endpoint keyword (regression)", () => {
    // The `.md` rung feeds Markdown full of links to sibling doc pages. A page
    // like ".../personal-access-tokens.md" contains "token" but is NOT the token
    // endpoint — the real endpoint (api.notion.com/v1/oauth/token) must win.
    const md = `
      Authorize at https://api.notion.com/v1/oauth/authorize and exchange at
      https://api.notion.com/v1/oauth/token. See also
      [personal access tokens](https://developers.notion.com/guides/get-started/personal-access-tokens.md).
    `;
    const hits = extractEndpoints(md, ["notion.com", "api.notion.com"]);
    const byKind = Object.fromEntries(hits.map((h) => [h.kind, h.url]));
    expect(byKind.token).toBe("https://api.notion.com/v1/oauth/token");
    expect(byKind.token).not.toMatch(/\.md$/);
  });

  it("matches endpoint keywords under ANY path prefix (/-/, oauth_*) (regression)", () => {
    // Asana-style paths: https://app.asana.com/-/oauth_authorize, /-/oauth_token,
    // /-/oauth_revoke — the keyword isn't directly after /oauth/ or /vN/.
    const text = `
      Authorize at https://app.asana.com/-/oauth_authorize and exchange at
      https://app.asana.com/-/oauth_token. Revoke via https://app.asana.com/-/oauth_revoke.
    `;
    const hits = extractEndpoints(text, ["asana.com"]);
    const byKind = Object.fromEntries(hits.map((h) => [h.kind, h.url]));
    expect(byKind.authorize).toBe("https://app.asana.com/-/oauth_authorize");
    expect(byKind.token).toBe("https://app.asana.com/-/oauth_token");
    expect(byKind.revoke).toBe("https://app.asana.com/-/oauth_revoke");
  });
});

describe("pickEndpointDocPage", () => {
  const base: Pick<TavilyResult, "content"> = { content: "" };
  const mk = (url: string, sourceType: TavilyResult["sourceType"], score: number): TavilyResult => ({
    ...base,
    title: url,
    url,
    score,
    sourceType,
  });

  it("prefers an official-docs page on the provider domain over a higher-scored off-domain one", () => {
    const evidence = [
      mk("https://medium.com/high-score", "community", 0.99),
      mk("https://docs.slack.dev/oauth", "official-docs", 0.4),
    ];
    const pick = pickEndpointDocPage(evidence, ["slack.dev", "slack.com"]);
    expect(pick?.url).toBe("https://docs.slack.dev/oauth");
  });

  it("returns null when no evidence is on the provider domain and nothing is official", () => {
    const evidence = [mk("https://nango.dev/x", "third-party-integration", 1)];
    expect(pickEndpointDocPage(evidence, ["slack.com"])).toBeNull();
  });

  it("accepts an already-official page even when it's off the registrable domain", () => {
    // A provider's own GitHub docs repo is classified official-docs (via the
    // trusted registry / verified repo-owner match) yet its host is github.com,
    // not the provider domain. Such pages MUST be eligible for extraction —
    // this is the Basecamp fix. Classification is the corroboration here; a
    // bare sourceType is only "official-docs" when evidence established it.
    const evidence = [mk("https://github.com/basecamp/api/blob/master/sections/authentication.md", "official-docs", 0.5)];
    expect(pickEndpointDocPage(evidence, ["basecamp.com"])?.url).toContain("github.com/basecamp/api");
  });
});

describe("docVariantUrls — format-generic machine-readable fallbacks", () => {
  it("tries the .md twin of a doc page before the raw HTML (ReadMe/llms convention)", () => {
    // Miro-style: the rendered page is a JS shell; the endpoints live in the
    // `.md` twin the portal advertises. Generic by URL shape, no hardcoded host.
    const variants = docVariantUrls("https://developers.miro.com/docs/getting-started-with-oauth");
    expect(variants).toContain("https://developers.miro.com/docs/getting-started-with-oauth.md");
    // The raw page is still there as the final fallback.
    expect(variants[variants.length - 1]).toBe("https://developers.miro.com/docs/getting-started-with-oauth");
    // .md is tried before the HTML page.
    expect(variants.indexOf("https://developers.miro.com/docs/getting-started-with-oauth.md"))
      .toBeLessThan(variants.indexOf("https://developers.miro.com/docs/getting-started-with-oauth"));
  });

  it("prefers a GitHub repo's raw Markdown first", () => {
    const variants = docVariantUrls("https://github.com/basecamp/api/blob/master/sections/authentication.md");
    expect(variants[0]).toBe("https://raw.githubusercontent.com/basecamp/api/master/sections/authentication.md");
  });

  it("does NOT append .md to a URL that already names a file with an extension", () => {
    const variants = docVariantUrls("https://api.example.com/openapi.json");
    expect(variants).not.toContain("https://api.example.com/openapi.json.md");
    expect(variants).toContain("https://api.example.com/openapi.json");
  });

  it("works across arbitrary providers (no provider-specific logic)", () => {
    expect(docVariantUrls("https://developers.notion.com/docs/authorization")).toContain(
      "https://developers.notion.com/docs/authorization.md",
    );
    expect(docVariantUrls("https://developers.zoom.us/docs/integrations/oauth")).toContain(
      "https://developers.zoom.us/docs/integrations/oauth.md",
    );
  });
});
