import { getProbe, stripHtml } from "@/lib/investigation/safe-fetch";
import { hostIsOnDomain } from "@/lib/search/classify";
import { githubRawUrl } from "@/lib/research/provider-registry";
import type { TavilyResult } from "@/lib/search/tavily";

/**
 * Deep endpoint extraction (quick-win).
 *
 * Tavily snippets rarely quote the literal OAuth endpoint URLs
 * (e.g. https://slack.com/oauth/v2/authorize), so the Implementation Pack often
 * showed honest nulls for authorize/token/revoke. This helper fetches the body
 * of the single highest-ranked page on the provider's OWN domain and regexes
 * well-known OAuth endpoint URLs out of its full text.
 *
 * It is deliberately conservative:
 *   - only fetches ONE page, and only one on the provider's domain (via the
 *     SSRF-guarded safe-fetch getProbe — never an arbitrary URL);
 *   - only reports URLs it literally found in that page's text (no invention);
 *   - returns a synthetic TavilyResult so the found URLs flow into synthesis as
 *     real, citable evidence rather than model recall.
 */

export type EndpointHit = {
  kind: "authorize" | "token" | "revoke";
  url: string;
};

// Match an OAuth endpoint by its keyword appearing ANYWHERE in the URL path,
// regardless of prefix (/oauth/, /v2/, /-/, /connect/, …). Order matters: the
// revoke and token patterns are checked before the broad authorize one, and
// extractEndpoints assigns each URL to the first kind it matches.
//   - revoke:    .../revoke, .../oauth_revoke, .../auth.revoke, .../token/revoke
//   - token:     .../token, .../access_token, .../oauth_token, .../oauth.v2.access
//   - authorize: .../authorize, .../authorise, .../oauth_authorize
const ENDPOINT_PATTERNS: { kind: EndpointHit["kind"]; re: RegExp }[] = [
  { kind: "revoke", re: /https?:\/\/[^\s"'<>)(\][`]+\/[^\s"'<>)(\][`]*(?:revoke|auth\.revoke)[^\s"'<>)(\][`]*/gi },
  { kind: "token", re: /https?:\/\/[^\s"'<>)(\][`]+\/[^\s"'<>)(\][`]*(?:access[_-]?token|oauth[._-]?token|oauth\.v2\.access|oauth\.access|[/_-]token)[^\s"'<>)(\][`]*/gi },
  { kind: "authorize", re: /https?:\/\/[^\s"'<>)(\][`]+\/[^\s"'<>)(\][`]*authoriz[es]?[^\s"'<>)(\][`]*/gi },
];

/** Pick the best pages to deep-fetch: the top-ranked AUTHORITATIVE pages. A page
 * qualifies when its host is on a provider domain OR it's already classified as
 * official-docs/developer-portal (which now includes a provider's own GitHub
 * docs repo, whose host isn't the registrable provider domain).
 *
 * Returns up to `limit` pages, best first. We try more than one because search
 * often ranks a sibling doc page (e.g. "creating an app") above the page that
 * actually lists the OAuth endpoints ("authorizing apps"); extraction stops at
 * the first page that yields endpoints, so this is bounded work. Pages whose
 * URL/title hints at auth/oauth are nudged up so we usually hit paydirt first. */
export function pickEndpointDocPages(
  evidence: TavilyResult[],
  providerDomains: string[],
  limit = 4,
): TavilyResult[] {
  const eligible = evidence.filter((r) => {
    if (r.sourceType === "official-docs" || r.sourceType === "developer-portal") return true;
    try {
      return providerDomains.some((d) => hostIsOnDomain(new URL(r.url).hostname, d));
    } catch {
      return false;
    }
  });
  if (eligible.length === 0) return [];
  // Prefer official-docs, then pages whose URL/title looks auth-related, then by
  // Tavily score. A doc page is far more likely to list endpoints than a home page.
  const authHint = (r: TavilyResult) =>
    /oauth|authoriz|\btoken\b|\bauth\b/i.test(`${r.url} ${r.title}`) ? 1 : 0;
  const score = (r: TavilyResult) =>
    (r.sourceType === "official-docs" ? 2 : r.sourceType === "developer-portal" ? 1 : 0) * 10 +
    authHint(r) * 5 +
    (r.score ?? 0);
  return [...eligible].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/** Back-compat single-page picker (highest-ranked eligible page), used by tests
 * and callers that only want the top pick. */
export function pickEndpointDocPage(
  evidence: TavilyResult[],
  providerDomains: string[],
): TavilyResult | null {
  return pickEndpointDocPages(evidence, providerDomains, 1)[0] ?? null;
}

/** Extract OAuth endpoint URLs from a block of (already de-HTML'd) text. */
export function extractEndpoints(text: string, providerDomains: string[]): EndpointHit[] {
  const hits = new Map<string, EndpointHit>(); // dedup by url
  for (const { kind, re } of ENDPOINT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Trim trailing punctuation AND markdown wrappers. Docs in Markdown wrap
      // URLs in backticks/brackets (`url`, [text](url)), and a literal or
      // percent-encoded backtick (%60) must not become part of the endpoint.
      const raw = m[0]
        .replace(/%60/gi, "")
        .replace(/[.,;:)\]`'">*]+$/, "");
      // The endpoint is the scheme+host+path; strip any query/fragment the docs
      // show inline (e.g. ".../authorize?response_type=code&client_id=...").
      // Those params belong in the request, not in the copyable endpoint.
      let url: string;
      let host: string;
      try {
        const u = new URL(raw);
        host = u.hostname;
        url = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, "");
      } catch {
        continue;
      }
      // Only trust endpoints on the provider's own domain — never a third party's.
      if (!providerDomains.some((d) => hostIsOnDomain(host, d))) continue;
      // Reject documentation-PAGE URLs that merely contain an endpoint keyword in
      // their path (e.g. ".../personal-access-tokens.md", ".../oauth-guide.html").
      // A real OAuth endpoint is not a doc page: drop URLs ending in a doc/markup
      // file extension. This matters for the `.md` doc-variant rung, whose source
      // text is full of links to sibling doc pages.
      if (/\.(?:md|markdown|html?|txt|pdf)$/i.test(url)) continue;
      if (!hits.has(url)) hits.set(url, { kind, url });
    }
  }
  return [...hits.values()];
}

/**
 * Candidate machine-readable representations of a documentation page, in
 * priority order. Modern developer-doc platforms (ReadMe, and the emerging
 * "LLM-friendly docs" convention) serve a clean Markdown twin of any doc page
 * when you append `.md`, and advertise a project index at `/llms.txt`. The
 * rendered HTML is often a JS shell with the real endpoints only in that twin.
 *
 * These are FORMAT conventions — they work by URL shape across arbitrary
 * providers, never by hardcoded host. Each is best-effort: a 404 or non-text
 * response simply falls through to the next candidate, and finally to the raw
 * page. We never invent a representation that isn't actually served.
 */
export function docVariantUrls(pageUrl: string): string[] {
  const variants: string[] = [];
  const push = (u: string | null) => {
    if (u && !variants.includes(u)) variants.push(u);
  };

  // 1. A provider's GitHub docs repo → raw Markdown source (existing behavior).
  push(githubRawUrl(pageUrl));

  // 2. The `.md` twin of the page (ReadMe / llms-docs convention), unless the
  //    URL already points at a file with an extension.
  try {
    const u = new URL(pageUrl);
    const last = u.pathname.split("/").pop() ?? "";
    const hasExt = /\.[a-z0-9]{1,5}$/i.test(last);
    if (!hasExt) {
      const trimmed = u.pathname.replace(/\/$/, "");
      push(`${u.protocol}//${u.host}${trimmed}.md${u.search}`);
    }
  } catch {
    /* not a URL — skip */
  }

  // 3. The page itself (HTML), always last.
  push(pageUrl);
  return variants;
}

/** True when a fetched body looks like machine-readable text we can extract from
 * (markdown/plain/json), as opposed to a rendered HTML shell. */
function isMachineReadable(contentType: string | null | undefined, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("markdown") || ct.includes("plain") || ct.includes("json")) return true;
  if (ct.includes("html")) return false;
  // No/ambiguous content-type: treat a body that doesn't start like HTML as text.
  return !body.trimStart().toLowerCase().startsWith("<!doctype") &&
    !body.trimStart().toLowerCase().startsWith("<html");
}

/**
 * Fetch the best authoritative doc page and extract endpoint URLs + a documented
 * token lifetime (expires_in). Returns the structured hits plus a synthetic
 * TavilyResult (official-docs) carrying them, or null if nothing was found / the
 * page could not be fetched. Never throws.
 *
 * Tries each machine-readable representation of the page in priority order
 * (GitHub raw → `.md` twin → HTML), keeping the FIRST that yields endpoints.
 * The canonical page URL stays the evidence link regardless of which
 * representation we actually parsed. Browser retrieval is NOT used; these are
 * bounded, convention-based fallbacks.
 */
export async function fetchEndpointEvidence(
  evidence: TavilyResult[],
  providerDomains: string[],
): Promise<{ hits: EndpointHit[]; tokenLifetimeSeconds: number | null; evidence: TavilyResult } | null> {
  const pages = pickEndpointDocPages(evidence, providerDomains);
  if (pages.length === 0) return null;

  let bestHits: EndpointHit[] = [];
  let bestLifetime: number | null = null;
  let bestPage: TavilyResult | null = null;

  // Try each candidate page (search's top pick is often a sibling, not the auth
  // page). For each page, try its machine-readable representations in order.
  // Stop as soon as a page yields endpoints — bounded work, first hit wins.
  outer: for (const page of pages) {
    for (const fetchUrl of docVariantUrls(page.url)) {
      let bodyText: string;
      try {
        const probe = await getProbe(fetchUrl);
        if (!probe.ok || !probe.body) continue;
        bodyText = isMachineReadable(probe.contentType, probe.body)
          ? probe.body
          : stripHtml(probe.body);
      } catch {
        continue;
      }

      const h = extractEndpoints(bodyText, providerDomains);
      const t = extractExpiresIn(bodyText);
      if (h.length > bestHits.length) {
        bestHits = h;
        bestPage = page;
        bestLifetime = t ?? bestLifetime;
      } else if (bestHits.length === 0 && t !== null && bestLifetime === null) {
        bestLifetime = t;
        bestPage = bestPage ?? page;
      }
      if (bestHits.length > 0) break outer; // clean hit — stop
    }
  }

  if (bestHits.length === 0 && bestLifetime === null) return null;
  const page = bestPage ?? pages[0];

  const lines = [
    ...bestHits.map((h) => `${h.kind} endpoint: ${h.url}`),
    bestLifetime !== null ? `access token expires_in: ${bestLifetime} seconds` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const synthetic: TavilyResult = {
    title: `OAuth facts extracted from ${page.title || page.url}`,
    url: page.url, // canonical evidence link, even when a variant was fetched
    content: `The following OAuth facts were found in the documentation at ${page.url}:\n${lines}`,
    score: 1,
    sourceType: "official-docs",
  };
  return { hits: bestHits, tokenLifetimeSeconds: bestLifetime, evidence: synthetic };
}

/**
 * Parse a documented access-token lifetime from a token-response example, e.g.
 * `"expires_in": 1209600` or `expires_in=3600`. Returns seconds, or null.
 * Only matches the standard OAuth field name so we don't grab an unrelated number.
 */
export function extractExpiresIn(text: string): number | null {
  const m = text.match(/["']?expires_in["']?\s*[:=]\s*["']?(\d{2,8})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
