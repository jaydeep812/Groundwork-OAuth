import type { GeneratedGuide, EvidenceRef } from "@/lib/schema/guide";
import type { TavilyResult } from "@/lib/search/tavily";
import type { Finding } from "@/lib/schema/guide";

/**
 * Grounding / scrub logic shared by the research graph, consolidated from the
 * two former pipelines which each carried a near-identical copy.
 *
 * Responsibilities:
 *  - Drop evidence entries whose URL was never actually retrieved.
 *  - Fall back to the real retrieved sources when the model cited none.
 *  - Overwrite each evidence sourceType from our own classifier (ignore the
 *    model's self-reported type).
 *  - Recursively drop dangling evidenceIds AND findingIds on every claim.
 */

export type EvidenceOut = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  sourceType: EvidenceRef["sourceType"];
};

export type GroundResult = {
  evidence: EvidenceOut[];
  droppedEvidenceIds: number;
  droppedFindingIds: number;
  warnings: string[];
};

/**
 * Ground a parsed guide against the evidence that was actually retrieved and
 * the findings that were actually produced. Mutates `guide` in place (scrubs
 * dangling id references) and returns the cleaned evidence list + counts.
 */
export function groundGuide(
  guide: GeneratedGuide & { evidence: EvidenceOut[] },
  retrievedEvidence: TavilyResult[],
  findings: Finding[],
): GroundResult {
  const warnings: string[] = [];

  // URLs considered "actually retrieved": base/ranked evidence plus anything a
  // Finding fetched directly.
  const retrievedUrls = new Set<string>([
    ...retrievedEvidence.map((r) => r.url),
    ...findings.flatMap((f) => f.evidence.map((e) => e.url)),
  ]);

  // (a) Drop evidence the model invented.
  const cleanEvidence = guide.evidence.filter((e) => {
    const kept = retrievedUrls.has(e.url);
    if (!kept) warnings.push(`Dropped fabricated/unretrieved source: ${e.url}`);
    return kept;
  });

  const finalEvidence: EvidenceOut[] =
    cleanEvidence.length > 0
      ? cleanEvidence
      : retrievedEvidence.slice(0, 8).map((r, i) => ({
          id: `ev-${i + 1}`,
          title: r.title,
          url: r.url,
          snippet: r.content.slice(0, 300),
          sourceType: r.sourceType,
        }));
  if (cleanEvidence.length === 0 && retrievedEvidence.length > 0) {
    warnings.push("Model cited no retrieved sources; attaching retrieved sources directly.");
  }

  // (b) Overwrite sourceType from our own classifier (model self-reports are
  // unreliable). Seed from base evidence, then from finding evidence (coercing
  // the legacy "third-party" value).
  const srcByUrl = new Map<string, EvidenceRef["sourceType"]>();
  for (const r of retrievedEvidence) srcByUrl.set(r.url, r.sourceType);
  for (const f of findings) {
    for (const e of f.evidence) {
      const t = e.sourceType === "third-party" ? "third-party-integration" : e.sourceType;
      srcByUrl.set(e.url, t);
    }
  }
  for (const e of finalEvidence) {
    const authoritative = srcByUrl.get(e.url);
    if (authoritative) e.sourceType = authoritative;
  }

  // (c) Scrub dangling id references.
  const validEvidenceIds = new Set(finalEvidence.map((e) => e.id));
  const validFindingIds = new Set(findings.map((f) => f.id));
  const { evidenceIds, findingIds } = scrubIds(
    guide as unknown as Record<string, unknown>,
    validEvidenceIds,
    validFindingIds,
  );
  if (evidenceIds + findingIds > 0) {
    warnings.push(
      `Dropped ${evidenceIds} dangling evidenceId and ${findingIds} dangling findingId reference(s).`,
    );
  }

  return { evidence: finalEvidence, droppedEvidenceIds: evidenceIds, droppedFindingIds: findingIds, warnings };
}

/**
 * Walk any nested object/array and drop evidenceIds / findingIds entries that
 * don't resolve to a valid id. Returns the count of each kind removed.
 */
export function scrubIds(
  root: Record<string, unknown>,
  validEvidenceIds: Set<string>,
  validFindingIds: Set<string>,
): { evidenceIds: number; findingIds: number } {
  let evDropped = 0;
  let fnDropped = 0;
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.evidenceIds)) {
      const before = obj.evidenceIds.length;
      obj.evidenceIds = (obj.evidenceIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && validEvidenceIds.has(id),
      );
      evDropped += before - (obj.evidenceIds as string[]).length;
    }
    if (Array.isArray(obj.findingIds)) {
      const before = obj.findingIds.length;
      obj.findingIds = (obj.findingIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && validFindingIds.has(id),
      );
      fnDropped += before - (obj.findingIds as string[]).length;
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(root);
  return { evidenceIds: evDropped, findingIds: fnDropped };
}
