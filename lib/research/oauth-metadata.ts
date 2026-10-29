import { getProbe } from "@/lib/investigation/safe-fetch";
import { registrableHost } from "@/lib/search/classify";

/**
 * OAuth Authorization Server Metadata probe (RFC 8414 + OpenID Connect Discovery).
 *
 * Modern OAuth/OIDC providers publish a machine-readable metadata document at a
 * well-known URL that lists — authoritatively and in clean JSON — the
 * authorization/token endpoints, supported scopes, and PKCE methods. This is
 * strictly better than scraping JS-rendered HTML docs: one small GET yields
 * structured, spec-defined fields with zero guessing.
 *
 *   /.well-known/oauth-authorization-server   (RFC 8414)
 *   /.well-known/openid-configuration         (OIDC Discovery)
 *
 * Providers that don't publish it simply yield null and the pipeline falls back
 * to its existing evidence-based extraction. We never invent — we only read
 * what the provider itself serves.
 *
 * TRUST (RFC 8414 §3.3): finding a JSON doc that *looks* like OAuth metadata on
 * a plausible subdomain is NOT proof it belongs to the intended authorization
 * server. We validate the document's `issuer` against the host we fetched from
 * and reject on mismatch, so a stray/misconfigured doc can't inject endpoints.
 */

const WELL_KNOWN_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
] as const;

/**
 * Common OAuth/OIDC host prefixes. Many providers publish metadata on a
 * dedicated auth subdomain, not the canonical website (e.g. Asana →
 * app.asana.com, BoldSign → account.boldsign.com). Fixed + bounded; used only
 * as a FALLBACK after source-derived hosts (see metadataCandidateHosts).
 */
const COMMON_OAUTH_PREFIXES = [
  "auth",
  "login",
  "accounts",
  "account",
  "app",
  "api",
  "oauth",
  "id",
  "identity",
] as const;

/** Hard cap on hosts probed, so discovery stays bounded regardless of input. */
const MAX_CANDIDATE_HOSTS = 16;

/** Normalized subset we care about, mapped toward the Implementation pack. */
export type OAuthMetadata = {
  /** The well-known URL this came from (becomes the evidence source). */
  sourceUrl: string;
  /** The validated `issuer` identifier from the document. */
  issuer: string | null;
  authorizeUrl: string | null;
  tokenUrl: string | null;
  registrationUrl: string | null;
  revokeUrl: string | null;
  /**
   * Scopes the AUTHORIZATION SERVER supports (RFC 8414 `scopes_supported`).
   * This is NOT the set of scopes a given integration needs. `null` means the
   * field was ABSENT (undetermined); `[]` means it was explicitly empty.
   */
  supportedScopes: string[] | null;
  /** PKCE methods advertised (`code_challenge_methods_supported`), or null if absent. */
  pkceMethods: string[] | null;
  /** "supported" when methods are advertised; "unknown" otherwise. Support does
   * NOT imply PKCE is required — requirement is tracked independently elsewhere. */
  pkce: "supported" | "unknown";
};

/** The outcome of probing one candidate URL — recorded for honest Findings. */
export type ProbeAttempt = {
  url: string;
  ok: boolean;
  /** Machine-readable outcome: "metadata" | "http-<code>" | "non-json" |
   * "issuer-mismatch" | "no-endpoints" | "network-error". */
  reason: string;
};

export type ProbeResult = {
  meta: OAuthMetadata | null;
  attempts: ProbeAttempt[];
};

type RawMetadata = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  registration_endpoint?: unknown;
  revocation_endpoint?: unknown;
  scopes_supported?: unknown;
  code_challenge_methods_supported?: unknown;
};

function asHttpsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const p = new URL(v).protocol;
    return p === "http:" || p === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** Return a string[] when the property is a string array, or null when the
 * property is ABSENT/not an array — preserving "omitted" vs "explicitly empty". */
function asStringArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * RFC 8414 §3.3: the issuer in the metadata must match the host used to locate
 * it. We compare registrable hosts (so `app.asana.com` metadata with
 * issuer `https://app.asana.com` validates, but a doc claiming a different
 * provider's issuer is rejected). A missing issuer on an oauth-authorization-
 * server doc is tolerated only for the OIDC path where some providers omit it;
 * we still require the endpoints to be absolute https URLs.
 */
function issuerMatchesHost(issuer: string | null, fetchedFromUrl: string): boolean {
  if (!issuer) return true; // tolerated; endpoint host checks still apply below
  try {
    const issuerHost = registrableHost(new URL(issuer).hostname);
    const fetchedHost = registrableHost(new URL(fetchedFromUrl).hostname);
    return issuerHost === fetchedHost;
  } catch {
    return false;
  }
}

/** Parse one metadata JSON body into our normalized shape, or null if unusable.
 * `sourceUrl` is both the evidence link and the host we validate `issuer` against. */
export function parseOAuthMetadata(
  body: string,
  sourceUrl: string,
): { meta: OAuthMetadata | null; reason: string } {
  let json: RawMetadata;
  try {
    json = JSON.parse(body) as RawMetadata;
  } catch {
    return { meta: null, reason: "non-json" };
  }
  const authorizeUrl = asHttpsUrl(json.authorization_endpoint);
  const tokenUrl = asHttpsUrl(json.token_endpoint);
  // Require at least one real endpoint — otherwise this isn't useful metadata.
  if (!authorizeUrl && !tokenUrl) return { meta: null, reason: "no-endpoints" };

  const issuer = typeof json.issuer === "string" ? json.issuer : null;
  // Trust gate: the document must belong to the server we fetched it from.
  if (!issuerMatchesHost(issuer, sourceUrl)) {
    return { meta: null, reason: "issuer-mismatch" };
  }

  const pkceMethods = asStringArrayOrNull(json.code_challenge_methods_supported);
  // The metadata doc advertises *supported* methods; it can't by itself prove
  // PKCE is mandatory, so we report "supported" (honest) rather than "required".
  const pkce = pkceMethods && pkceMethods.length > 0 ? "supported" : "unknown";

  return {
    meta: {
      sourceUrl,
      issuer,
      authorizeUrl,
      tokenUrl,
      registrationUrl: asHttpsUrl(json.registration_endpoint),
      revokeUrl: asHttpsUrl(json.revocation_endpoint),
      supportedScopes: asStringArrayOrNull(json.scopes_supported),
      pkceMethods,
      pkce,
    },
    reason: "metadata",
  };
}

/**
 * Build the ordered, deduped, bounded set of hosts to probe for metadata.
 *
 * Order (most trustworthy first):
 *   1. the exact provider domains we were given (canonical + source-derived),
 *   2. common OAuth/OIDC subdomains of each registrable base (fallback).
 *
 * Source-derived hosts go first so a doc-discovered auth host is tried before
 * guessed subdomains; the subdomain list is a bounded fallback, not a promise.
 */
export function metadataCandidateHosts(providerDomains: string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (h: string) => {
    const host = h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!host || seen.has(host)) return;
    seen.add(host);
    ordered.push(host);
  };

  // 1. the given hosts verbatim (these include any doc/search-derived auth host).
  for (const d of providerDomains) add(d);

  // 2. common OAuth subdomains of each registrable base, as a fallback.
  const bases = new Set(providerDomains.map((d) => registrableHost(d)).filter(Boolean));
  for (const base of bases) {
    for (const prefix of COMMON_OAUTH_PREFIXES) add(`${prefix}.${base}`);
  }

  return ordered.slice(0, MAX_CANDIDATE_HOSTS);
}

/**
 * Probe a provider's candidate hosts for OAuth/OIDC metadata. Returns the first
 * VALID document found plus a record of every attempt (so callers can emit an
 * honest Finding — including "all candidates exhausted"). Best-effort and
 * side-effect-free; never throws.
 */
export async function probeOAuthMetadata(providerDomains: string[]): Promise<ProbeResult> {
  const attempts: ProbeAttempt[] = [];
  const hosts = metadataCandidateHosts(providerDomains);

  for (const host of hosts) {
    for (const path of WELL_KNOWN_PATHS) {
      const url = `https://${host}${path}`;
      try {
        const probe = await getProbe(url);
        if (!probe.ok) {
          attempts.push({ url, ok: false, reason: `http-${probe.status ?? "error"}` });
          continue;
        }
        if (!probe.body) {
          attempts.push({ url, ok: false, reason: "empty-body" });
          continue;
        }
        // Only bother parsing when it's plausibly JSON (avoid HTML 404 pages).
        if (probe.contentType && !probe.contentType.includes("json")) {
          attempts.push({ url, ok: false, reason: "non-json" });
          continue;
        }
        const { meta, reason } = parseOAuthMetadata(probe.body, url);
        if (meta) {
          attempts.push({ url, ok: true, reason: "metadata" });
          return { meta, attempts };
        }
        attempts.push({ url, ok: false, reason });
      } catch {
        attempts.push({ url, ok: false, reason: "network-error" });
      }
    }
  }
  return { meta: null, attempts };
}
