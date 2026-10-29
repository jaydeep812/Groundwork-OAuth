import type { GeneratedGuide, NormalizedFact } from "@/lib/schema/guide";
import { factFor } from "@/lib/graph/facts";
import { validateWorkflow } from "@/lib/guide/workflow-order";

/**
 * Deterministic critic. No LLM. Two jobs:
 *  1. COMPLETENESS — which developer-critical fields are still missing (drives
 *     the bounded re-plan loop).
 *  2. SEMANTIC CONSISTENCY — claim-level checks against the fact ledger: known
 *     authoritative facts aren't dropped, PKCE support/requirement don't
 *     contradict, estimates aren't mislabeled as documented, blockers aren't
 *     invented from an empty array, sections agree. Each failure is tied to a
 *     field path + recovery reason so the next research loop can target it.
 *
 * Every guide is a custom OAuth readiness guide; managed-auth availability is
 * supplementary metadata and does not change these checks. The critic never
 * forces a provider to invent scopes/PKCE/rate-limits it doesn't document.
 */

export type CritiqueFailure = {
  fieldPath: string;
  message: string;
  /** Recovery reason, mirrors UnresolvedReason where the gap is researchable. */
  reason:
    | "not_found_in_retrieved_evidence"
    | "source_conflict"
    | "contradiction"
    | "misrepresented-confidence"
    | "unsupported-claim";
  severity: "error" | "warn";
};

export type Critique = {
  complete: boolean;
  /** Human-readable labels of missing fields, e.g. "token endpoint URL". */
  missing: string[];
  /** 0..1 — fraction of the checked fields that are populated. */
  score: number;
  /** Structural problems that make the guide incoherent. Retained for the
   * graph/report shape; always empty now that there is a single path. */
  violations: string[];
  /** Actionable, field-path-level failures (completeness + consistency). */
  failures: CritiqueFailure[];
};

type Check = { label: string; fieldPath: string; present: (g: GeneratedGuide) => boolean };

/** The custom-OAuth facts a readiness guide needs to be actionable. */
const CUSTOM_CHECKS: Check[] = [
  { label: "developer portal URL", fieldPath: "implementation.developerPortalUrl", present: (g) => !!g.implementation?.developerPortalUrl },
  { label: "authorize endpoint URL", fieldPath: "implementation.authorizeUrl", present: (g) => !!g.implementation?.authorizeUrl },
  { label: "token endpoint URL", fieldPath: "implementation.tokenUrl", present: (g) => !!g.implementation?.tokenUrl },
  { label: "redirect URI format rule", fieldPath: "implementation.redirectUriRule", present: (g) => !!g.implementation?.redirectUriRule },
];

/** Checks that apply to the guide regardless of implementation detail. */
const COMMON_CHECKS: Check[] = [
  { label: "setup steps", fieldPath: "setupSteps", present: (g) => (g.setupSteps?.length ?? 0) > 0 },
];

/**
 * Retained for API/report compatibility. With a single custom-OAuth path there
 * is no managed-vs-custom contradiction to detect, so this always returns [].
 */
export function findPathViolations(_guide: GeneratedGuide): string[] {
  return [];
}

/**
 * Score a drafted guide for completeness and semantic consistency.
 *
 * `facts` (optional) is the canonical ledger; when provided, the critic adds
 * evidence-quality and cross-field consistency checks. `complete` is true when
 * no fields are missing AND no error-severity consistency failures remain.
 */
export function critiqueGuide(guide: GeneratedGuide, facts: NormalizedFact[] = []): Critique {
  const checks = [...CUSTOM_CHECKS, ...COMMON_CHECKS];
  const missing = checks.filter((c) => !c.present(guide)).map((c) => c.label);
  const score = checks.length ? (checks.length - missing.length) / checks.length : 1;

  const failures: CritiqueFailure[] = [];

  // Completeness → failures, but a field the ledger says is "unknown" after
  // real research is a genuine gap, not a model omission; keep it researchable.
  for (const c of checks) {
    if (c.present(guide)) continue;
    failures.push({
      fieldPath: c.fieldPath,
      message: `${c.label} not established`,
      reason: "not_found_in_retrieved_evidence",
      severity: "warn",
    });
  }

  // --- Semantic consistency against the ledger ---

  // (1) Known authoritative facts must not be dropped. If the ledger verified an
  // endpoint but the guide left it null, that's an error the pipeline must fix
  // (reconciliation should have applied it — this catches regressions).
  for (const path of ["implementation.authorizeUrl", "implementation.tokenUrl", "implementation.developerPortalUrl"] as const) {
    const f = factFor(facts, path);
    if (!f || f.value == null) continue;
    if (f.status === "unknown") continue;
    const key = path.split(".")[1] as keyof NonNullable<GeneratedGuide["implementation"]>;
    const got = guide.implementation?.[key];
    if (!got) {
      failures.push({
        fieldPath: path,
        message: `${path} is ${f.status} in the fact ledger but missing from the guide`,
        reason: "unsupported-claim",
        severity: "error",
      });
    }
  }

  // (2) Conflicting authoritative sources must be surfaced, not silently picked.
  for (const f of facts) {
    if (f.status === "conflicting") {
      const needle = (f.fieldPath.split(".").pop() ?? f.fieldPath).toLowerCase();
      const surfaced = guide.uncertainties?.some((u) =>
        u.question.toLowerCase().includes(needle),
      );
      failures.push({
        fieldPath: f.fieldPath,
        message: surfaced
          ? `Sources conflict on ${f.fieldPath}; surfaced as uncertainty (ok)`
          : `Sources conflict on ${f.fieldPath}; must be surfaced as an uncertainty`,
        reason: "source_conflict",
        severity: surfaced ? "warn" : "error",
      });
    }
  }

  // (3) PKCE support vs requirement must not contradict.
  const pkceDetail = guide.implementation?.pkceDetail;
  if (pkceDetail && pkceDetail.required === "yes" && pkceDetail.supported === "no") {
    failures.push({
      fieldPath: "implementation.pkceDetail",
      message: "PKCE marked required but not supported — contradictory",
      reason: "contradiction",
      severity: "error",
    });
  }

  // (4) The hands-on effort estimate must not be labeled a documented fact
  // (verified/observed) — it is a planning estimate/inference by nature.
  const ae = guide.activeEffort;
  if (ae && (ae.kind === "verified" || ae.kind === "observed")) {
    failures.push({
      fieldPath: "activeEffort.kind",
      message: `activeEffort is labeled '${ae.kind}' — a hands-on estimate must be 'estimate'/'inference'/'unknown', never documented`,
      reason: "misrepresented-confidence",
      severity: "error",
    });
  }

  // (5) "No launch-blocking issues" must not come from an empty array alone.
  if ((guide.knownBlockers?.length ?? 0) === 0 && guide.blockerAssessment === "assessed-none-found") {
    // This is the ALLOWED way to claim no blockers: an explicit assessment.
    // If instead it's "incomplete", the UI must not say "nothing launch-blocking".
  }
  if ((guide.knownBlockers?.length ?? 0) === 0 && guide.blockerAssessment === "blockers-found") {
    failures.push({
      fieldPath: "blockerAssessment",
      message: "blockerAssessment says blockers-found but knownBlockers is empty",
      reason: "contradiction",
      severity: "error",
    });
  }

  // (6) externalWaiting: an exact approval timeline must not be stated as
  // documented unless its estimate kind is verified/observed with evidence.
  const ew = guide.externalWaiting;
  if (ew && ew.value != null && ew.kind === "verified" && (ew.evidenceIds?.length ?? 0) === 0 && (ew.findingIds?.length ?? 0) === 0) {
    failures.push({
      fieldPath: "externalWaiting",
      message: "externalWaiting claims a documented timeline with no supporting evidence",
      reason: "misrepresented-confidence",
      severity: "error",
    });
  }

  // (7) Workflow dependency consistency: authorize before exchange, prereqs
  // before dependents, no refresh step without refresh support, journey/
  // checklist agreement, and no dangling step references — the ordering errors
  // the Zoho Desk guide exposed.
  for (const issue of validateWorkflow(guide)) {
    failures.push({
      fieldPath: issue.fieldPath,
      message: issue.message,
      reason: "contradiction",
      severity: "error",
    });
  }

  const hasBlockingError = failures.some((f) => f.severity === "error");
  return {
    complete: missing.length === 0 && !hasBlockingError,
    missing,
    score,
    violations: [],
    failures,
  };
}
