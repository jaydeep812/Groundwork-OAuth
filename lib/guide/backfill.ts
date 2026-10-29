import type { GeneratedGuide, EvidenceRef, Implementation } from "@/lib/schema/guide";
import { hostIsOnDomain } from "@/lib/search/classify";

/**
 * Deterministic source-to-field backfill, run at persist time against the
 * grounded evidence. The model emits the implementation pack, but it often
 * leaves `developerPortalUrl` null even when the evidence clearly contains the
 * provider's own docs/portal links. This maps that evidence into the field
 * rather than leaving it "not established" (the reported bug). It never invents
 * a URL — it only promotes a URL that is already in the retrieved evidence and
 * sits on the provider's own domain.
 */

/** Find the verified Composio toolkit URL from evidence (never a guessed slug). */
export function findToolkitUrl(evidence: EvidenceRef[]): string | null {
  const hit = evidence.find(
    (e) => e.sourceType === "composio-docs" && /composio\.dev\/toolkits\//i.test(e.url),
  );
  return hit?.url ?? null;
}

/** The best on-provider-domain evidence URL to use as a developer portal. */
function bestPortalUrl(evidence: EvidenceRef[], providerDomains: string[]): string | null {
  if (providerDomains.length === 0) return null;
  const onDomain = evidence.filter((e) => {
    try {
      return providerDomains.some((d) => hostIsOnDomain(new URL(e.url).hostname, d));
    } catch {
      return false;
    }
  });
  if (onDomain.length === 0) return null;
  // Prefer an explicit developer-portal classification, then official docs.
  const score = (e: EvidenceRef) =>
    (e.sourceType === "developer-portal" ? 2 : e.sourceType === "official-docs" ? 1 : 0);
  return [...onDomain].sort((a, b) => score(b) - score(a))[0]?.url ?? null;
}

/**
 * Return an implementation block with `developerPortalUrl` backfilled from
 * evidence when the model left it null. Pure; returns the same object when
 * there's nothing to fill. Also returns a note for warnings/provenance.
 */
export function backfillImplementation(
  implementation: Implementation | undefined,
  evidence: EvidenceRef[],
  providerDomains: string[],
): { implementation: Implementation | undefined; filled: string[] } {
  if (!implementation) return { implementation, filled: [] };
  const filled: string[] = [];
  let next = implementation;

  if (!next.developerPortalUrl) {
    const portal = bestPortalUrl(evidence, providerDomains);
    if (portal) {
      next = { ...next, developerPortalUrl: portal };
      filled.push("developerPortalUrl");
    }
  }

  return { implementation: next, filled };
}

/** Convenience: apply backfill to a full draft guide. */
export function backfillGuide(
  draft: GeneratedGuide,
  evidence: EvidenceRef[],
  providerDomains: string[],
): { draft: GeneratedGuide; filled: string[] } {
  const { implementation, filled } = backfillImplementation(
    draft.implementation,
    evidence,
    providerDomains,
  );
  return { draft: { ...draft, implementation }, filled };
}
