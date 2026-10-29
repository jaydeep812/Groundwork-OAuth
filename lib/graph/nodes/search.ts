import type { GraphStateType } from "@/lib/graph/state";
import { tavilySearchMany, reclassifyResults, type TavilyResult } from "@/lib/search/tavily";
import { determineProviderDomains } from "@/lib/research/helpers";
import { fetchEndpointEvidence, pickEndpointDocPage } from "@/lib/research/endpoint-extract";
import { probeOAuthMetadata, type OAuthMetadata } from "@/lib/research/oauth-metadata";
import { authoritativeHostsFor, canonicalWebsiteFor } from "@/lib/research/provider-registry";
import { registrableHost, hostIsOnDomain } from "@/lib/search/classify";
import { makeFinding, excerpt } from "@/lib/investigation/agents/_shared";
import type { Finding } from "@/lib/schema/guide";

/** True when a domain's leading label matches a token of the provider name
 * (so we pick a canonical website that's actually the provider, not a docs host). */
function domainMatchesName(domain: string, providerName: string): boolean {
  const label = registrableHost(domain).split(".")[0];
  const keys = new Set(
    providerName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3),
  );
  const collapsed = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return keys.has(label) || (collapsed.length > 0 && label.includes(collapsed));
}

const MAX_SEARCHES = 6;

/**
 * Run the planned queries, establish provider domain(s) (loop 0 only), and
 * reclassify. The `evidence` reducer dedupes across loops, so re-plan searches
 * accumulate new material without clobbering what we already have.
 */
export async function searchNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (state.error) return {};
  if (state.plannedQueries.length === 0) return {};

  let results: TavilyResult[] = [];
  let errors: string[] = [];
  try {
    const r = await tavilySearchMany(state.plannedQueries, {
      maxResults: 5,
      maxSearches: MAX_SEARCHES,
    });
    results = r.results;
    errors = r.errors;
  } catch (err) {
    return { error: `Web research failed: ${(err as Error).message}`, stage: "search" };
  }

  // On the first loop, nothing retrieved at all is a hard failure.
  if (state.loopCount === 0 && results.length === 0 && state.evidence.length === 0) {
    return {
      error:
        "No web evidence could be retrieved for this provider, so a trustworthy guide cannot be generated. Please check the provider name/URL and try again.",
      stage: "search",
      searchErrors: errors,
    };
  }

  const patch: Partial<GraphStateType> = { evidence: results, searchErrors: errors };

  // Establish domains and the Composio probe only on the first loop.
  if (state.loopCount === 0) {
    const allEvidence = [...state.evidence, ...results];
    const resolved = determineProviderDomains(
      state.providerName,
      state.providerUrl,
      allEvidence,
      state.providerUrlFromInput,
    );

    // Merge in trusted-registry authoritative hosts (docs/OAuth hosts that live
    // off the canonical domain, e.g. Basecamp's launchpad.37signals.com and its
    // GitHub docs repo). These let classification + extraction trust the
    // provider's real sources WITHOUT changing which host is the website.
    const extraHosts = authoritativeHostsFor(state.providerName, resolved);
    const domains = Array.from(new Set([...resolved, ...extraHosts]));
    patch.providerDomains = domains;

    // The CANONICAL website is a separate identity concern: prefer an explicit
    // registry canonical, else a resolved domain whose label matches the
    // provider name — never a docs/OAuth host we merely found facts on.
    if (!state.providerUrlFromInput) {
      const canonical =
        canonicalWebsiteFor(state.providerName, resolved) ??
        resolved.find((d) => domainMatchesName(d, state.providerName)) ??
        resolved[0];
      if (canonical) patch.providerUrl = `https://${canonical}`;
    }

    // Best source of truth: the provider's own OAuth/OIDC metadata document
    // (RFC 8414 / OpenID discovery). One small GET yields authoritative,
    // structured endpoints + scopes + PKCE methods — far better than scraping
    // JS-rendered HTML docs. We probe source-derived hosts AND the canonical
    // host's common OAuth subdomains (bounded), validate the issuer, and record
    // every attempt so the probe leaves an honest note whether it hit or missed.
    const findings: Finding[] = [];

    // Seed the candidate set with the canonical host too — the resolved docs
    // host (e.g. slack.dev) may differ from where metadata lives (slack.com).
    const canonicalHost = patch.providerUrl
      ? registrableHost(new URL(patch.providerUrl).hostname)
      : undefined;
    const probeDomains = Array.from(
      new Set([...domains, ...(canonicalHost ? [canonicalHost] : [])]),
    );

    try {
      const { meta, attempts } = await probeOAuthMetadata(probeDomains);
      // Trust guard: a .well-known document is only the PROVIDER's metadata if it
      // was served from the provider's own domain. Candidate-host resolution can
      // admit a stray domain (e.g. "Google APIs" → the token "apis" matched the
      // unrelated apis.io), and a foreign authorization server's issuer validates
      // against its OWN host — so the issuer check alone can't catch it. Require
      // the source host to be on a trusted provider domain before we treat its
      // endpoints as verified; otherwise discard it as if nothing was found.
      const trustedDomains = [...domains, ...(canonicalHost ? [canonicalHost] : [])];
      let metaHost: string | null = null;
      try {
        metaHost = meta ? new URL(meta.sourceUrl).hostname : null;
      } catch {
        metaHost = null;
      }
      const metaOnDomain =
        meta != null &&
        metaHost != null &&
        trustedDomains.some((d) => hostIsOnDomain(metaHost as string, d));

      if (meta && metaOnDomain) {
        results = [...results, metadataEvidence(meta)];
        patch.oauthMetadata = meta; // structured — fed into the fact ledger
        const f = makeFinding({
          agent: "oauth-metadata-probe",
          question: "Does the provider publish RFC 8414 / OIDC discovery metadata?",
          attempted: `Probed ${attempts.length} well-known URL(s) across candidate OAuth hosts.`,
          attemptKind: "url-probe",
          outcome: "confirmed",
          conclusion: `Found authoritative OAuth metadata at ${meta.sourceUrl}.`,
          observation: excerpt(metadataEvidence(meta).content, 800),
          evidence: [{ id: "meta-well-known", title: "OAuth Authorization Server Metadata", url: meta.sourceUrl, snippet: excerpt(metadataEvidence(meta).content, 300), sourceType: "official-docs" }],
          uncertainty: "",
        });
        findings.push(f);
      } else {
        // Honest negative note: report the actual outcomes, do NOT manufacture a
        // quote. "Exhausted" is a report of the investigation, not proof of absence.
        // If we DID parse a document but rejected it for being off the provider's
        // domain, say so — that's a meaningful (and reassuring) negative.
        const tried = attempts.map((a) => `${a.url} → ${a.reason}`).join("; ");
        const rejectedForeign = meta != null && !metaOnDomain;
        findings.push(
          makeFinding({
            agent: "oauth-metadata-probe",
            question: "Does the provider publish RFC 8414 / OIDC discovery metadata?",
            attempted: `Probed ${attempts.length} well-known URL(s) across candidate OAuth hosts.`,
            attemptKind: "url-probe",
            outcome: "insufficient",
            conclusion: rejectedForeign
              ? `A metadata document was found at ${metaHost}, but that host is not on the provider's own domain — discarded rather than trusted as the provider's endpoints.`
              : attempts.length === 0
                ? "No candidate hosts were available to probe for metadata."
                : "No valid RFC 8414 / OIDC metadata document was served by the probed hosts.",
            observation: excerpt(tried, 800),
            evidence: [],
            uncertainty:
              "A metadata endpoint may exist on a host not covered by the attempted discovery. Endpoints fall back to documentation extraction.",
          }),
        );
      }
    } catch {
      /* non-fatal — fall through to HTML extraction */
    }

    // Fallback endpoint extraction: when metadata isn't published, deep-fetch
    // the top provider-domain doc page and regex the literal endpoint URLs.
    // Best-effort and SSRF-guarded; never throws, never invents.
    try {
      const pickedPage = pickEndpointDocPage([...allEvidence, ...results], domains);
      const extracted = await fetchEndpointEvidence([...allEvidence, ...results], domains);
      if (extracted) {
        results = [...results, extracted.evidence];
        patch.endpointHits = extracted.hits; // structured — fed into the ledger
        if (extracted.tokenLifetimeSeconds !== null) {
          patch.extractedTokenLifetimeSeconds = extracted.tokenLifetimeSeconds;
        }
        const f = makeFinding({
          agent: "endpoint-extract",
          question: "Which OAuth endpoints are listed in the provider's documentation?",
          attempted: `Fetched ${extracted.evidence.url} and extracted literal endpoint URLs.`,
          attemptKind: "docs-read",
          outcome: "confirmed",
          conclusion: `Extracted ${extracted.hits.length} endpoint URL(s) from the documentation page.`,
          observation: excerpt(extracted.evidence.content, 800),
          evidence: [{ id: "endpoint-extract-src", title: extracted.evidence.title, url: extracted.evidence.url, snippet: excerpt(extracted.evidence.content, 300), sourceType: "official-docs" }],
          uncertainty: "",
        });
        findings.push(f);
      } else {
        findings.push(
          makeFinding({
            agent: "endpoint-extract",
            question: "Which OAuth endpoints are listed in the provider's documentation?",
            attempted: pickedPage
              ? `Fetched the top on-domain doc page (${pickedPage.url}).`
              : "Looked for an on-domain/official documentation page to extract endpoints from.",
            attemptKind: "docs-read",
            outcome: "insufficient",
            conclusion: pickedPage
              ? "No literal OAuth endpoint URLs were found on the fetched documentation page."
              : "No on-domain or official documentation page was available to extract endpoints from.",
            observation: "",
            // No EvidenceRef: nothing was established. The page we tried (if any)
            // is named in `attempted` — we never fabricate a supporting citation.
            evidence: [],
            uncertainty: "Endpoints remain unestablished unless metadata or another source supplies them.",
          }),
        );
      }
    } catch {
      /* non-fatal — the pack simply keeps its honest nulls */
    }
    patch.evidence = results;
    if (findings.length) patch.findings = findings;
  }

  return patch;
}

/**
 * Render OAuth metadata as a single authoritative evidence item the synthesizer
 * can lift endpoints/scopes/PKCE from directly. Lives on the provider's own
 * domain, so it classifies as official-docs.
 */
function metadataEvidence(meta: OAuthMetadata): TavilyResult {
  const lines = [
    meta.authorizeUrl && `authorization_endpoint: ${meta.authorizeUrl}`,
    meta.tokenUrl && `token_endpoint: ${meta.tokenUrl}`,
    meta.registrationUrl && `registration_endpoint (developer portal / dynamic registration): ${meta.registrationUrl}`,
    meta.revokeUrl && `revocation_endpoint: ${meta.revokeUrl}`,
    meta.supportedScopes && meta.supportedScopes.length > 0 && `scopes_supported: ${meta.supportedScopes.join(" ")}`,
    `PKCE code_challenge_methods: ${meta.pkce === "supported" ? `${(meta.pkceMethods ?? []).join(" ")} supported` : "not advertised"}`,
  ].filter(Boolean);
  return {
    title: "OAuth Authorization Server Metadata (provider's own .well-known document)",
    url: meta.sourceUrl,
    content: `Authoritative OAuth metadata published by the provider:\n${lines.join("\n")}`,
    score: 1,
    sourceType: "official-docs",
  };
}

/**
 * Reclassify the accumulated evidence against the (now established) provider
 * domains. Kept as a tiny separate step so it runs AFTER the reducer has
 * merged this loop's results into state.evidence.
 */
export function reclassifyEvidence(evidence: TavilyResult[], domains: string[]): TavilyResult[] {
  return reclassifyResults(evidence, domains);
}
