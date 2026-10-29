import type { SetupStep, SetupStepCategory } from "@/lib/schema/guide";

/**
 * The ONE canonical ordering for a custom OAuth (authorization-code) setup.
 *
 * Both the Setup checklist and the Technical walkthrough must present steps in
 * this sequence so the two tabs never contradict each other. The root cause of
 * the Zoho Desk bug was that the checklist ordered steps by category, and the
 * category enum places `configure-integration` BEFORE `authorize-user` — but the
 * model files "exchange the authorization code" under `configure-integration`,
 * so code exchange was rendered before authorization. Category is too coarse to
 * encode the authorize→exchange dependency; this phase model fixes that.
 *
 * Phases mirror the deterministic journey (register → authorize → exchange →
 * store → api/verify) plus the setup-only phases (configure at registration,
 * provider approval). Lower rank comes first.
 */
export const WORKFLOW_PHASES = [
  "register", // create the app, obtain client credentials
  "configure", // redirect URI, scopes, app settings (done at/after registration, BEFORE authorize)
  "authorize", // send the user to the authorization endpoint
  "exchange", // handle the callback, exchange the code for tokens
  "store", // store tokens, implement refresh / reauthorization
  "verify", // make an authenticated request, confirm access
  "approve", // provider review / verification / distribution
] as const;
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

const RANK: Record<WorkflowPhase, number> = Object.fromEntries(
  WORKFLOW_PHASES.map((p, i) => [p, i]),
) as Record<WorkflowPhase, number>;

/** Default phase for each setup-step category. Note `configure-integration`
 * maps to `configure` (pre-authorize) by DEFAULT — the title classifier below
 * overrides it to `exchange` when the step is actually the code exchange. */
const CATEGORY_PHASE: Record<SetupStepCategory, WorkflowPhase> = {
  "register-provider-app": "register",
  "configure-integration": "configure",
  "authorize-user": "authorize",
  "verify-data-access": "verify",
  "provider-approval": "approve",
};

/** Keyword cues that pin a step to a phase regardless of its (sometimes
 * mis-assigned) category. Checked in order; first match wins. The exchange cue
 * is what rescues the Zoho case: an "exchange the authorization code" step
 * tagged `configure-integration` is recognized as the `exchange` phase. */
const TITLE_CUES: { phase: WorkflowPhase; re: RegExp }[] = [
  { phase: "exchange", re: /\b(exchange|callback|redirect\s*back|code\s*for\s*(a\s*)?token|token\s*exchange)\b/i },
  { phase: "store", re: /\b(store|persist|save|refresh|rotate|revoke)\b.*\btoken|token.*\b(store|persist|refresh|rotat|revok)/i },
  { phase: "authorize", re: /\b(authoriz|consent|grant\s*access|redirect\s*the\s*user|authorization\s*request)\b/i },
  { phase: "verify", re: /\b(verify|test|first\s*(api\s*)?request|confirm\s*access|make\s*an?\s*(authenticated|api))\b/i },
  { phase: "approve", re: /\b(approv|review|verification|distribut|publish|submit\s*for)\b/i },
  { phase: "register", re: /\b(register|create\s*(an?\s*)?(oauth\s*)?app|developer\s*console|api\s*console)\b/i },
  { phase: "configure", re: /\b(redirect\s*uri|callback\s*url|scopes?|permissions?|configure|settings)\b/i },
];

/**
 * Classify a setup step into its canonical workflow phase. Title cues win over
 * the category (categories are coarse and sometimes mis-assigned by the model);
 * the category is the fallback. A conditional/alternative step keeps its phase
 * but is ordered after primary steps of the same phase (see `canonicalRank`).
 */
export function phaseOf(step: Pick<SetupStep, "category" | "title">): WorkflowPhase {
  for (const cue of TITLE_CUES) {
    if (cue.re.test(step.title)) return cue.phase;
  }
  return CATEGORY_PHASE[step.category] ?? "configure";
}

/** A step is an "alternative" (conditional, non-required) — ordered after the
 * primary steps so the recommended path reads straight through. */
function isAlternative(s: Pick<SetupStep, "appliesWhen" | "required">): boolean {
  return Boolean(s.appliesWhen) && s.required === false;
}

/** Sort key for a step in the canonical workflow: phase rank, then alternatives
 * after primaries within the same phase. Stable for equal keys (preserves the
 * model's intra-phase order). */
export function canonicalRank(step: SetupStep): number {
  const phaseRank = RANK[phaseOf(step)] ?? RANK.configure;
  // Multiply so the alternative tiebreak never crosses a phase boundary.
  return phaseRank * 10 + (isAlternative(step) ? 1 : 0);
}

/**
 * Return the setup steps in canonical workflow order. Deterministic and stable:
 * equal-rank steps keep their original relative order, so provider-specific
 * sub-steps the model emitted in a sensible order are preserved within a phase.
 */
export function orderSetupSteps(steps: SetupStep[]): SetupStep[] {
  return steps
    .map((s, i) => ({ s, i, k: canonicalRank(s) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.s);
}

/** A workflow problem found by deterministic validation. */
export type WorkflowIssue = {
  code:
    | "exchange-before-authorize"
    | "prereq-after-dependent"
    | "refresh-without-support"
    | "dangling-step-reference"
    | "journey-checklist-order-mismatch";
  fieldPath: string;
  message: string;
};

type WorkflowGuide = {
  setupSteps: SetupStep[];
  findings?: { id: string }[];
  evidence?: { id: string }[];
  implementation?: {
    tokenLifecycle?: { refreshTokenIssued?: string } | undefined;
    refreshUrl?: string | null;
  };
  journey?: { key: string; order: number }[];
};

const PHASE_SEQUENCE = WORKFLOW_PHASES.reduce<Record<WorkflowPhase, number>>(
  (acc, p, i) => ((acc[p] = i), acc),
  {} as Record<WorkflowPhase, number>,
);

/**
 * Deterministically validate meaningful workflow dependencies. These are the
 * dependency rules that actually matter for OAuth correctness — NOT a demand
 * that every provider use an identical checklist. Returns an empty array for a
 * well-formed workflow.
 */
export function validateWorkflow(guide: WorkflowGuide): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const steps = guide.setupSteps ?? [];

  // (1) The authorize→exchange dependency: the code exchange must not appear
  // before the authorization request. This is the Zoho Desk bug.
  const authorizeIdx = steps.findIndex((s) => phaseOf(s) === "authorize");
  const exchangeIdx = steps.findIndex((s) => phaseOf(s) === "exchange");
  if (authorizeIdx !== -1 && exchangeIdx !== -1 && exchangeIdx < authorizeIdx) {
    issues.push({
      code: "exchange-before-authorize",
      fieldPath: `setupSteps[${exchangeIdx}]`,
      message:
        "The authorization-code exchange step appears before the authorization request step.",
    });
  }

  // (2) Registration must precede any step that consumes its credentials
  // (authorize/exchange need the client id/secret from registration).
  const registerIdx = steps.findIndex((s) => phaseOf(s) === "register");
  const firstDependent = steps.findIndex((s) =>
    (["authorize", "exchange"] as WorkflowPhase[]).includes(phaseOf(s)),
  );
  if (registerIdx !== -1 && firstDependent !== -1 && firstDependent < registerIdx) {
    issues.push({
      code: "prereq-after-dependent",
      fieldPath: `setupSteps[${registerIdx}]`,
      message: "A registration prerequisite appears after a step that depends on its credentials.",
    });
  }

  // (3) A refresh-token step must not be present when refresh tokens are not
  // established/supported — that would tell the developer to build a flow the
  // provider doesn't offer.
  const refreshStep = steps.find((s) => /\brefresh\b/i.test(s.title));
  const refreshIssued = guide.implementation?.tokenLifecycle?.refreshTokenIssued;
  const refreshUrl = guide.implementation?.refreshUrl;
  if (refreshStep && refreshIssued === "no" && !refreshUrl) {
    issues.push({
      code: "refresh-without-support",
      fieldPath: "setupSteps",
      message:
        "A refresh-token step is present but refresh tokens are not issued by this provider.",
    });
  }

  // (4) Dangling references: every evidenceId / findingId on a step must resolve.
  const evidenceIds = new Set((guide.evidence ?? []).map((e) => e.id));
  const findingIds = new Set((guide.findings ?? []).map((f) => f.id));
  steps.forEach((s, i) => {
    const badEv = (s.evidenceIds ?? []).some((id) => !evidenceIds.has(id));
    const badFind = (s.findingIds ?? []).some((id) => !findingIds.has(id));
    if (badEv || badFind) {
      issues.push({
        code: "dangling-step-reference",
        fieldPath: `setupSteps[${i}]`,
        message: `Step "${s.title}" references evidence/findings that don't exist.`,
      });
    }
  });

  // (5) The deterministic journey and the checklist must tell the same story:
  // the journey's authorize stage must precede its exchange stage (it is built
  // in canonical order, so this guards against a regression in the builder),
  // and must agree with the checklist's relative order.
  const j = guide.journey ?? [];
  const jAuth = j.find((x) => x.key === "authorize")?.order;
  const jExch = j.find((x) => x.key === "exchange")?.order;
  if (jAuth != null && jExch != null && jExch < jAuth) {
    issues.push({
      code: "journey-checklist-order-mismatch",
      fieldPath: "journey",
      message: "The walkthrough places token exchange before authorization.",
    });
  }

  return issues;
}

/** Null-safe phase-sequence lookup, exported for tests/consumers. */
export function phaseSequence(phase: WorkflowPhase): number {
  return PHASE_SEQUENCE[phase];
}
