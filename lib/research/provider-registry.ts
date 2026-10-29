import { registrableHost } from "@/lib/search/classify";

/**
 * Trusted provider → host mapping.
 *
 * Problem this solves: a provider's OFFICIAL OAuth documentation and its OAuth
 * authorization/token hosts frequently live on domains OTHER than its canonical
 * website (e.g. Basecamp's docs are at github.com/basecamp/api and its OAuth
 * host is launchpad.37signals.com). The domain-gated classifier + endpoint
 * extractor would otherwise reject these as "unknown"/off-domain and lose every
 * documented fact.
 *
 * This registry is deliberately SMALL and conservative. It only encodes
 * relationships that are stable and well-known. It never makes a host the
 * provider's *canonical website* — that identity stays separate (see
 * `canonicalWebsite`). It only marks hosts as AUTHORITATIVE FOR CLAIMS (docs /
 * OAuth hosts) so classification + extraction trust them.
 *
 * Relationships not in this registry can still be established from evidence
 * (see `officialRepoFromEvidence`): a provider-owned GitHub repo is credited
 * only when the repo owner matches the provider identity.
 */

export type ProviderEntry = {
  /** Match keys: lowercased provider-name tokens or canonical domains. */
  match: string[];
  /** The provider's canonical website registrable host (identity, not docs). */
  canonicalWebsite: string;
  /** Additional hosts that are AUTHORITATIVE for this provider's OAuth claims:
   * docs hosts, developer portals, and OAuth authorization/token hosts. These
   * are added to providerDomains so classification + extraction trust them. */
  authoritativeHosts: string[];
  /** Provider-owned GitHub repos (owner/repo) whose docs are official. Used to
   * fetch raw Markdown when the rendered page can't be parsed. */
  githubDocRepos?: string[];
};

const REGISTRY: ProviderEntry[] = [
  {
    match: ["basecamp", "37signals", "basecamp.com"],
    canonicalWebsite: "basecamp.com",
    authoritativeHosts: ["37signals.com", "launchpad.37signals.com", "basecampapi.com"],
    githubDocRepos: ["basecamp/api", "basecamp/bc-api", "basecamp/bcx-api"],
  },
];

/** Normalize a provider name to comparable tokens. */
function nameKeys(providerName: string): string[] {
  const collapsed = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = providerName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  return [collapsed, ...tokens];
}

/** Look up a registry entry for a provider by name and/or known domains. */
export function lookupProvider(providerName: string, domains: string[] = []): ProviderEntry | null {
  const keys = new Set(nameKeys(providerName));
  const domainRoots = new Set(domains.map((d) => registrableHost(d)));
  for (const entry of REGISTRY) {
    for (const m of entry.match) {
      if (keys.has(m)) return entry;
      if (domainRoots.has(registrableHost(m))) return entry;
    }
  }
  return null;
}

/**
 * Given the provider's resolved domains, return any ADDITIONAL authoritative
 * hosts from the trusted registry (docs/OAuth hosts). The caller merges these
 * into providerDomains so classification + extraction trust them — WITHOUT
 * changing which domain is the canonical website.
 */
export function authoritativeHostsFor(providerName: string, domains: string[]): string[] {
  const entry = lookupProvider(providerName, domains);
  if (!entry) return [];
  return [entry.canonicalWebsite, ...entry.authoritativeHosts];
}

/** The canonical website host for a provider, if the registry knows it. */
export function canonicalWebsiteFor(providerName: string, domains: string[] = []): string | null {
  return lookupProvider(providerName, domains)?.canonicalWebsite ?? null;
}

/**
 * Decide whether a GitHub URL is an OFFICIAL docs repo for the provider.
 *
 * Two ways to establish the relationship (never "all GitHub is official"):
 *  1. The repo owner/name is in the trusted registry's githubDocRepos.
 *  2. The repo OWNER matches the provider identity (name token or canonical
 *     domain label) AND the repo looks like an API/docs repo — a conservative
 *     evidence-based association for providers not in the registry.
 */
export function isOfficialProviderRepo(
  url: string,
  providerName: string,
  domains: string[] = [],
): boolean {
  let owner = "";
  let repo = "";
  try {
    const u = new URL(url);
    if (registrableHost(u.hostname) !== "github.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    owner = (parts[0] ?? "").toLowerCase();
    repo = (parts[1] ?? "").toLowerCase();
  } catch {
    return false;
  }
  if (!owner) return false;

  const entry = lookupProvider(providerName, domains);
  if (entry?.githubDocRepos?.some((r) => `${owner}/${repo}` === r.toLowerCase())) return true;

  // Evidence-based: owner matches the provider identity.
  const keys = new Set(nameKeys(providerName));
  const domainLabels = new Set(
    domains.map((d) => registrableHost(d).split(".")[0]).filter(Boolean),
  );
  const ownerMatchesProvider = keys.has(owner) || domainLabels.has(owner);
  if (!ownerMatchesProvider) return false;

  // And the repo looks like official API/docs (avoid crediting a random repo).
  return /(^|[-_])(api|docs|developer|oauth|sdk)([-_]|$)/.test(repo) || repo === "api";
}

/**
 * Convert a GitHub docs URL to its raw Markdown source when possible, so the
 * extractor can parse the source instead of the JS-rendered page. Returns null
 * when the URL isn't a fetchable GitHub doc file. The CANONICAL url (the
 * original) stays the evidence link; this is only for extraction.
 *
 * Examples:
 *   github.com/basecamp/api/blob/master/sections/authentication.md
 *     → raw.githubusercontent.com/basecamp/api/master/sections/authentication.md
 */
export function githubRawUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (registrableHost(u.hostname) !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const [owner, repo, kind, ...rest] = parts;
    if (!owner || !repo) return null;
    if (kind === "blob" && rest.length > 0) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join("/")}`;
    }
    return null;
  } catch {
    return null;
  }
}
