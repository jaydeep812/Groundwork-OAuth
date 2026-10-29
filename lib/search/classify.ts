/**
 * Source classification for retrieved search results.
 *
 * The previous classifier matched URL *keywords* ("docs" in the path,
 * "developer" in the host) and over-credited third-party integrators as
 * "developer-portal" or "official-docs". It also had no way to represent
 * community forums or third-party integration platforms separately.
 *
 * This classifier takes an optional `providerDomains` list (the provider's own
 * registrable host, e.g. "kite.trade" for Zerodha Kite) and credits
 * "official-docs" ONLY when the retrieved URL's registrable host matches.
 * Everything else is categorized honestly:
 *
 *   official-docs           Host matches the provider's own domain.
 *   composio-docs           Host is a Composio-owned domain.
 *   third-party-integration Known integration platforms (Nango, Clerk, Pipedream,
 *                           Zapier, NocoDB, Apideck, OpenAlgo, LangChain, etc.)
 *                           that document someone else's provider.
 *   community               Forums/Q&A/community-authored (StackOverflow,
 *                           Reddit, Medium, Dev.to, Hashnode, GitHub Discussions).
 *   unknown                 Anything we can't confidently place.
 *
 * The "developer-portal" category from the earlier version is kept as an alias
 * for provider-hosted developer sub-sites (e.g. developers.kite.trade), which
 * are a special case of official-docs that is useful to label distinctly in
 * the UI. If the provider domain is known, developer-portal only matches when
 * the host is a `developers.<provider>` subdomain of the provider domain.
 */

export type SourceType =
  | "official-docs"
  | "developer-portal"
  | "composio-docs"
  | "third-party-integration"
  | "community"
  | "unknown";

// Imported lazily-safe (function-level use only) to recognize a provider's own
// GitHub docs repo. provider-registry imports registrableHost from here; the
// cycle is safe because both are functions called at runtime, not module init.
import { isOfficialProviderRepo } from "@/lib/research/provider-registry";

// Known third-party integration platforms that document OTHER providers' OAuth.
// Keep conservative; false negatives are fine (they fall through to "unknown"
// or get placed by other rules), false positives are not.
const THIRD_PARTY_INTEGRATION_HOSTS = new Set([
  "nango.dev",
  "clerk.com",
  "clerk.dev",
  "pipedream.com",
  "zapier.com",
  "nocodb.com",
  "apideck.com",
  "openalgo.in",
  "merge.dev",
  "paragon.com",
  "unified.to",
  "cobalt.io",
  "finch.com",
  "integration.app",
  "frontegg.com",
  "workos.com",
  "pangea.cloud",
  "arcade.dev",
]);

// Community / Q&A / blog platforms. Not authoritative for OAuth requirements.
const COMMUNITY_HOSTS = new Set([
  "stackoverflow.com",
  "stackexchange.com",
  "serverfault.com",
  "superuser.com",
  "reddit.com",
  "medium.com",
  "dev.to",
  "hashnode.com",
  "hashnode.dev",
  "quora.com",
  "ycombinator.com",
  "news.ycombinator.com",
  "news.ycombinator.org",
]);

// Composio-owned hosts.
const COMPOSIO_HOSTS = new Set([
  "composio.dev",
  "docs.composio.dev",
  "composio.ai",
]);

/**
 * Reduce a hostname to its "registrable" root: last two labels for common
 * public suffixes, last three for well-known 2-level TLDs (co.uk, co.in, etc.).
 *
 * This is deliberately a small built-in rather than pulling in `psl`. It's
 * conservative — unusual TLDs may yield more than the registrable domain, but
 * the comparison function below handles that by also checking "endsWith".
 */
export function registrableHost(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelTlds = new Set([
    "co.uk",
    "co.in",
    "co.jp",
    "co.nz",
    "co.za",
    "com.au",
    "com.br",
    "com.sg",
    "com.hk",
    "ac.uk",
    "org.uk",
    "gov.uk",
    "or.jp",
    "ne.jp",
  ]);
  const last2 = parts.slice(-2).join(".");
  if (twoLevelTlds.has(last2)) return parts.slice(-3).join(".");
  return last2;
}

/** True if `host` is on the provider's domain (same registrable root or subdomain). */
export function hostIsOnDomain(host: string, providerDomain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = providerDomain.toLowerCase().replace(/^www\./, "");
  if (h === d) return true;
  if (h.endsWith(`.${d}`)) return true;
  // Also accept same registrable root (e.g. kite.trade vs kite.zerodha.com for
  // Kite is NOT the same root; this handles sibling TLD subdomains like
  // "developers.foo.com" vs "foo.com").
  return registrableHost(h) === registrableHost(d);
}

function isDeveloperSubdomain(host: string): boolean {
  return /^(developers?|dev)\./.test(host.toLowerCase().replace(/^www\./, ""));
}

/** A provider-hosted COMMUNITY surface (user forum / discussion), e.g.
 * devforum.zoom.us or community.foo.com. These sit on the provider's own
 * registrable domain but are user-generated, NOT authoritative documentation —
 * so they must be tagged "community", never "official-docs", even on-domain. */
function isCommunitySubdomain(host: string): boolean {
  return /^(devforum|community|forum|forums|discuss|answers|support-community)\./.test(
    host.toLowerCase().replace(/^www\./, ""),
  );
}

/**
 * Classify a URL. When `providerDomains` is supplied, only hosts matching one
 * of those domains can be "official-docs" or "developer-portal".
 *
 * Without a provider domain (early in the pipeline, or for Composio-only
 * checks), the classifier plays it safe: it only credits Composio and
 * recognised third-party / community hosts, and marks everything else
 * "unknown" rather than guessing.
 */
export function classifySource(
  url: string,
  providerDomains: string[] = [],
  providerName = "",
): SourceType {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
  const root = registrableHost(host);

  if (COMPOSIO_HOSTS.has(host) || COMPOSIO_HOSTS.has(root)) return "composio-docs";

  for (const d of providerDomains) {
    if (!d) continue;
    if (hostIsOnDomain(host, d)) {
      // A provider-hosted user forum is community content, not official docs —
      // check this BEFORE crediting the on-domain host as authoritative.
      if (isCommunitySubdomain(host)) return "community";
      return isDeveloperSubdomain(host) ? "developer-portal" : "official-docs";
    }
  }

  if (THIRD_PARTY_INTEGRATION_HOSTS.has(root) || THIRD_PARTY_INTEGRATION_HOSTS.has(host)) {
    return "third-party-integration";
  }
  if (COMMUNITY_HOSTS.has(root) || COMMUNITY_HOSTS.has(host)) {
    return "community";
  }

  // GitHub is tricky: ComposioHQ/* is Composio-owned; a provider's OWN repo
  // (established via the trusted registry or a repo-owner match — never "all
  // GitHub") is official docs; everything else is "unknown" (the UI still links
  // it). Classification stays separate from provider-website identity: crediting
  // a repo as official does NOT make github.com the provider's canonical site.
  if (root === "github.com") {
    const path = (() => {
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    if (path.startsWith("/composiohq") || path.startsWith("/composio-hq")) {
      return "composio-docs";
    }
    if (providerName && isOfficialProviderRepo(url, providerName, providerDomains)) {
      return "official-docs";
    }
    return "unknown";
  }

  return "unknown";
}

/** True if the source type represents an authoritative provider source. */
export function isAuthoritative(t: SourceType): boolean {
  return t === "official-docs" || t === "developer-portal";
}

/** Human-friendly label for UI badges. */
export function sourceTypeLabel(t: SourceType): string {
  switch (t) {
    case "official-docs":
      return "Official docs";
    case "developer-portal":
      return "Developer portal";
    case "composio-docs":
      return "Composio docs";
    case "third-party-integration":
      return "Third-party integration";
    case "community":
      return "Community";
    case "unknown":
      return "Unknown source";
  }
}
