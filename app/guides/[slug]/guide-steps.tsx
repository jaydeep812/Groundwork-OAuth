"use client";

import { useEffect, useState } from "react";
import type {
  Finding,
  Guide,
  Implementation,
  JourneyStep,
  ProgressStatus,
  SetupField,
  SetupStep,
  SetupStepCategory,
  ValueProvenance,
} from "@/lib/schema/guide";
import { CopyButton } from "@/components/ui/copy-button";
import { Badge, categoryLabel } from "@/components/ui/badges";
import { WhyWeKnow } from "@/components/why-we-know";
import { SnippetTabs } from "@/components/oauth-journey";
import { phaseOf, type WorkflowPhase } from "@/lib/guide/workflow-order";

/**
 * Setup-step rendering + per-step progress tracking.
 *
 * Design goal: each step reads as an ACTIONABLE TASK, not a documentation page.
 * The default (collapsed) view answers the only three questions a developer has
 * before acting — what do I do, where do I do it, how do I know I'm done — and
 * nothing else. Rationale, verification detail, troubleshooting, code, and
 * evidence are all progressively disclosed behind one "Details" toggle.
 *
 * The data model already distinguishes everything we need (executionMode for
 * ownership, field provenance, journey docUrl/snippets, implementation URLs);
 * this component SELECTS and SEQUENCES that data rather than dumping it flat.
 *
 * Progress is stored in localStorage only — NOT shared across devices.
 */

/** Map a journey step's key to the canonical workflow phase it belongs to, so a
 * setup step and its code snippets line up even though they're keyed differently. */
const JOURNEY_KEY_PHASE: Record<string, WorkflowPhase> = {
  register: "register",
  "grant-type": "configure",
  authorize: "authorize",
  exchange: "exchange",
  "store-tokens": "store",
  "api-request": "verify",
  refresh: "store",
};

/** Build phase → snippets, so each setup step can show the code for its phase. */
function snippetsByPhase(journey: JourneyStep[]): Map<WorkflowPhase, JourneyStep["snippets"]> {
  const out = new Map<WorkflowPhase, JourneyStep["snippets"]>();
  for (const j of journey) {
    if (j.snippets.length === 0) continue;
    const phase = JOURNEY_KEY_PHASE[j.key];
    if (!phase) continue;
    const existing = out.get(phase) ?? [];
    out.set(phase, [...existing, ...j.snippets]);
  }
  return out;
}

/** Build phase → best doc URL, so a step can offer "View documentation". */
function docUrlByPhase(journey: JourneyStep[]): Map<WorkflowPhase, string> {
  const out = new Map<WorkflowPhase, string>();
  for (const j of journey) {
    if (!j.docUrl) continue;
    const phase = JOURNEY_KEY_PHASE[j.key];
    if (!phase || out.has(phase)) continue;
    out.set(phase, j.docUrl);
  }
  return out;
}

const STATUS_LABEL: Record<ProgressStatus, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
  blocked: "Blocked",
  unverified: "Unverified",
};

const STATUS_TONE: Record<ProgressStatus, Parameters<typeof Badge>[0]["tone"]> = {
  "not-started": "slate",
  "in-progress": "blue",
  completed: "green",
  blocked: "red",
  unverified: "amber",
};

const CYCLE: ProgressStatus[] = ["not-started", "in-progress", "completed", "unverified", "blocked"];

function storageKey(guideId: string) {
  return `oauth-guide-progress:${guideId}`;
}

/**
 * The reader is a developer who already knows OAuth. Generic prose — "the client
 * ID authenticates your app", "parse the JSON and confirm the access_token",
 * "double-check your values" — is noise to them. We only keep rationale and
 * troubleshooting text that is PROVIDER-SPECIFIC and non-obvious: it names a
 * concrete error string, a specific portal location, a provider quirk, or an
 * honest evidence caveat. Everything else is dropped from the default render.
 *
 * This is a heuristic over free text (the data isn't tagged generic vs.
 * specific), tuned to be conservative: when unsure it KEEPS, because hiding a
 * real gotcha is worse than showing one extra sentence.
 */
const SPECIFIC_SIGNALS: RegExp[] = [
  /[a-z]+_[a-z_]+/, // snake_case error/param tokens: redirect_uri_mismatch, unauthorized_scope_error, access_token
  /\b(tab|screen|page|section|button|console|dashboard|portal|menu|settings)\b/i, // concrete UI locations
  /\berror\b|\bwarning\b|\breturns?\b|\breturned\b|\bHTTP\s*\d|\b\d{3}\b/i, // named errors / status codes
  /\b(must|only|cannot|does not|doesn't|unless|requires?|limited?|not\s+(yet|established|found)|uncertain|missing)\b/i, // constraints / honest caveats
  /\b(exact|exactly|including\s+(the\s+)?(protocol|port|path|scheme))\b/i, // exact-match rules (a classic OAuth footgun that IS provider-specific)
];

/** The STRONG signals — a concrete error token, a specific UI location, a named
 * HTTP status, or an honest evidence caveat. Rationale must clear this higher
 * bar (it's generic ~80% of the time); a mere constraint word like "requires"
 * isn't enough to keep a "why this matters" sentence. */
const STRONG_SIGNALS: RegExp[] = [
  /[a-z]+_[a-z_]{3,}/, // snake_case tokens (error codes, params)
  /\b(tab|screen|console|dashboard|portal|menu|Products?|Auth\b)\b/, // concrete, capitalized-ish UI locations
  /\berror\b|\bwarning\b|\bHTTP\s*\d|\b[45]\d\d\b/i, // named errors / status codes
  /\bnot\s+(yet\s+)?(established|found|documented)\b|\buncertain\b|\bmissing from\b|\bevidence\b/i, // honest caveats
  /\bexact(ly)?\b/i, // exact-match footgun
];

/** Vague OAuth-101 phrasings that, on their own, mark text as generic. */
const GENERIC_MARKERS =
  /\b(standard|typical|usual|generally|simply|just\b|the oauth\s*(2(\.0)?)?\s*(flow|authorization|exchange)|authorization code flow|review the form|fields are filled|double-check|copied correctly|leading\/trailing spaces|obtains?\s+(user\s+)?consent|authenticate your app|allow your application|required for the|necessary for)\b/i;

/** Would this free-text note earn a fluent developer's attention? `strict`
 * (used for rationale) demands a STRONG provider-specific signal; the lenient
 * form (used for troubleshooting) accepts any specific signal, since a recovery
 * note that names a real symptom is almost always worth keeping. */
function isWorthShowing(text: string | undefined | null, strict = false): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0) return false;
  const signals = strict ? STRONG_SIGNALS : SPECIFIC_SIGNALS;
  if (!signals.some((re) => re.test(t))) return false;
  // Generic boilerplate is dropped even when it technically trips a signal.
  if (GENERIC_MARKERS.test(t)) return false;
  return true;
}

/**
 * Decide the ONE primary action for a step and how to surface it.
 *  - register / configure  → open the developer portal (where the work happens)
 *  - a phase doc URL        → view the relevant provider documentation
 *  - authorize / exchange / store with code → reveal the code (NOT an external
 *    link: a browser-redirect authorization is not a cURL call, and we never
 *    imply otherwise)
 *  - otherwise              → no button; the instruction itself is the task
 *
 * External links always open safely in a new tab and signal leaving Groundwork.
 */
type PrimaryAction =
  | { kind: "external"; href: string; label: string }
  | { kind: "reveal-code"; label: string }
  | null;

function primaryActionFor(
  step: SetupStep,
  phase: WorkflowPhase,
  impl: Implementation | undefined,
  providerUrl: string,
  hasSnippets: boolean,
  phaseDocUrl: string | undefined,
): PrimaryAction {
  const portal = impl?.developerPortalUrl ?? null;
  // A real https provider URL we can safely send the developer to. Guard against
  // the "provider website not established" google-search fallback used elsewhere.
  const providerIsSearch = providerUrl.startsWith("https://www.google.com/search");

  if (phase === "register" || phase === "configure") {
    if (portal) return { kind: "external", href: portal, label: "Open developer portal" };
    if (phaseDocUrl) return { kind: "external", href: phaseDocUrl, label: "View documentation" };
    if (!providerIsSearch) return { kind: "external", href: providerUrl, label: "Open provider site" };
    return null;
  }

  if (phase === "approve") {
    if (portal) return { kind: "external", href: portal, label: "Open developer portal" };
    if (phaseDocUrl) return { kind: "external", href: phaseDocUrl, label: "View review requirements" };
    return null;
  }

  // Authorize / exchange / store / verify: code is the actionable artifact.
  if (hasSnippets) return { kind: "reveal-code", label: "View code" };
  if (phaseDocUrl) return { kind: "external", href: phaseDocUrl, label: "View documentation" };
  return null;
}

export function GuideSteps({ guide }: { guide: Guide }) {
  const [progress, setProgress] = useState<Record<string, ProgressStatus>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(guide.id));
      if (raw) setProgress(JSON.parse(raw) as Record<string, ProgressStatus>);
    } catch {
      /* ignore malformed local state */
    }
    setLoaded(true);
  }, [guide.id]);

  function statusOf(step: SetupStep): ProgressStatus {
    return progress[step.id] ?? step.defaultStatus;
  }

  function advance(step: SetupStep) {
    const current = statusOf(step);
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const updated = { ...progress, [step.id]: next };
    setProgress(updated);
    try {
      localStorage.setItem(storageKey(guide.id), JSON.stringify(updated));
    } catch {
      /* storage may be unavailable */
    }
  }

  const completed = guide.setupSteps.filter((s) => statusOf(s) === "completed").length;
  // The stored setupSteps array is already in canonical workflow order (sorted
  // deterministically at build time in persist). Render in that order, emitting
  // a category label whenever the phase changes — never re-sort across steps,
  // which is what previously flipped authorize/exchange out of sequence.
  const runs = groupConsecutive(guide.setupSteps);
  const snippetMap = snippetsByPhase(guide.journey);
  const docMap = docUrlByPhase(guide.journey);

  // The first step that isn't already done is the one the developer is on —
  // expand it by default and keep the rest compact (spec: show the first
  // actionable step expanded). Computed from stored progress once loaded.
  const firstActionableId =
    guide.setupSteps.find((s) => statusOf(s) !== "completed")?.id ?? null;

  let runningIndex = 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b border-[color:var(--rule)] pb-3">
        <h2 className="text-xl font-bold tracking-tight text-[color:var(--ink)]">Setup checklist</h2>
        <span className="shrink-0 font-mono text-xs text-[color:var(--faint)]">
          {loaded ? `${completed} / ${guide.setupSteps.length} done` : "…"}
        </span>
      </div>

      {runs.map((run, ri) => (
        <section key={`${run.category}-${ri}`} className="space-y-2.5">
          <h3 className="text-[12px] font-semibold text-[color:var(--faint)]">
            {categoryLabel(run.category)}
          </h3>
          <ol className="space-y-2">
            {run.steps.map((step) => {
              runningIndex += 1;
              const phase = phaseOf(step);
              const snippets = snippetMap.get(phase) ?? [];
              return (
                <StepCard
                  key={step.id}
                  step={step}
                  index={runningIndex}
                  status={statusOf(step)}
                  onAdvance={() => advance(step)}
                  findings={guide.findings}
                  snippets={snippets}
                  action={primaryActionFor(
                    step,
                    phase,
                    guide.implementation,
                    guide.providerUrl,
                    snippets.length > 0,
                    docMap.get(phase),
                  )}
                  defaultOpen={loaded && step.id === firstActionableId}
                />
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Walk the (canonically ordered) steps and group RUNS of the same category,
 * preserving sequence. Unlike category bucketing, this never reorders steps —
 * it only inserts a label when the phase changes, so a correct authorize→
 * exchange order is rendered exactly as stored. */
function groupConsecutive(
  steps: SetupStep[],
): { category: SetupStepCategory; steps: SetupStep[] }[] {
  const runs: { category: SetupStepCategory; steps: SetupStep[] }[] = [];
  for (const s of steps) {
    const last = runs[runs.length - 1];
    if (last && last.category === s.category) last.steps.push(s);
    else runs.push({ category: s.category, steps: [s] });
  }
  return runs;
}

function StepCard({
  step,
  index,
  status,
  onAdvance,
  findings,
  snippets,
  action,
  defaultOpen,
}: {
  step: SetupStep;
  index: number;
  status: ProgressStatus;
  onAdvance: () => void;
  findings: Finding[];
  snippets: JourneyStep["snippets"];
  action: PrimaryAction;
  defaultOpen: boolean;
}) {
  const findingIds = step.findingIds ?? [];
  const done = status === "completed";
  const blocked = status === "blocked";

  // Progressive disclosure. The first actionable step opens by default; the rest
  // start collapsed to a scannable summary. "View code" actions also open the
  // panel (and we scroll the reader to the code within it).
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const showRationale = isWorthShowing(step.rationale, true);
  const showRecovery = isWorthShowing(step.recovery);
  const verificationLine = step.verification || step.expectedOutcome;

  // Config fields are now lightweight checklist lines shown INLINE — they don't
  // gate a toggle. The toggle exists ONLY for genuinely heavy content: code
  // snippets or provider-specific rationale. Evidence ("Why: …") is a quiet
  // inline affordance, not heavy content, so it never justifies a toggle on its
  // own. If there's nothing heavy, there's no toggle at all.
  const hasHeavyDetail = snippets.length > 0 || showRationale;

  return (
    <li
      className={`rounded-lg border bg-white p-4 transition-colors sm:p-5 ${
        blocked ? "border-[color:var(--alert)]/40" : "border-[color:var(--rule)]"
      }`}
    >
      {/* Header row: number · title · ownership · status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              done
                ? "bg-[color:var(--verified-soft)] text-[color:var(--verified)]"
                : "bg-[color:var(--paper-raised)] text-[color:var(--slate)]"
            }`}
          >
            {done ? "✓" : index}
          </span>
          <div className="min-w-0">
            <h4 className="text-[1.0625rem] font-semibold leading-snug text-[color:var(--ink)]">
              {step.title}
            </h4>
            {(!step.required || step.appliesWhen) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {!step.required && <Badge tone="neutral">optional</Badge>}
                {step.appliesWhen && <Badge tone="amber">conditional</Badge>}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onAdvance}
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--verified)]"
          aria-label={`Change status for ${step.title}. Current: ${STATUS_LABEL[status]}`}
        >
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]} ↻</Badge>
        </button>
      </div>

      {/* One tight block: title, then a single short paragraph that weaves in
          the instruction, how-you-know-it-worked, and any real gotcha — as
          plain sentences, no labeled compartments. Action button + optional
          code follow. Nothing else. */}
      <div className="mt-2.5 pl-9">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[color:var(--ink)]">
          {step.instructions}
          {verificationLine ? ` You're done when ${lowerFirst(verificationLine)}` : ""}
          {showRecovery ? ` If it fails: ${lowerFirst(step.recovery)}` : ""}
        </p>

        {step.appliesWhen && (
          <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--open)]">
            Only if {lowerFirst(step.appliesWhen)}
          </p>
        )}

        {/* Config the developer needs — inline checklist lines, always visible
            (they're short; no toggle, no box). */}
        {step.fields.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {step.fields.map((f) => (
              <FieldRow key={f.id} field={f} compact />
            ))}
          </div>
        )}

        {/* Action + optional code/details toggle. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {action?.kind === "external" && (
            <a
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ink)] px-3.5 py-2 text-[13px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--verified)]"
            >
              {action.label}
              <span aria-hidden>↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {/* One toggle, only when there's genuinely heavy content behind it
              (code or provider-specific rationale). "View code" when code is the
              payload, else "Details". No toggle for thin steps. */}
          {hasHeavyDetail && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={
                snippets.length > 0
                  ? "inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ink)] px-3.5 py-2 text-[13px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--verified)]"
                  : "inline-flex items-center gap-1 rounded-md border border-[color:var(--rule-strong)] px-3 py-2 text-[13px] text-[color:var(--slate)] transition-colors hover:border-[color:var(--faint)] hover:text-[color:var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--verified)]"
              }
              aria-expanded={open}
            >
              {snippets.length > 0 ? (open ? "Hide code" : "View code") : open ? "Less" : "Details"}
              <span aria-hidden>{open ? "▴" : snippets.length > 0 ? "↓" : "▾"}</span>
            </button>
          )}
        </div>

        {/* Provenance — a quiet inline affordance, always available, never
            gating a toggle. */}
        {findingIds.length > 0 && (
          <div className="mt-2.5">
            <WhyWeKnow findings={findings} findingIds={findingIds} />
          </div>
        )}
      </div>

      {/* Heavy detail on demand — no section headers, just the content. */}
      {open && hasHeavyDetail && (
        <div className="mt-4 space-y-3 border-t border-[color:var(--rule)] pl-9 pt-4 text-sm">
          {snippets.length > 0 && <SnippetTabs snippets={snippets} />}

          {showRationale && (
            <p className="leading-relaxed text-[color:var(--slate)]">{step.rationale}</p>
          )}
        </div>
      )}
    </li>
  );
}

/** Lowercase the first character so a sentence reads naturally when spliced
 * after "You're done when" / "If it fails:" / "Only if". Leaves ALL-CAPS words
 * (acronyms, error codes like PKCE / redirect_uri) untouched. */
function lowerFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  // Don't lowercase if the first token is an acronym/identifier (2+ caps).
  if (/^[A-Z]{2,}/.test(t) || /^[a-z_]+_[a-z_]+/.test(t)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

const PROVENANCE_LABEL: Record<ValueProvenance, string> = {
  "developer-input": "You provide",
  "environment-derived": "From your app",
  "provider-issued": "Provider issues",
};

/**
 * A single configuration field as a checklist line — a quiet mark + the field
 * name + who supplies it, inline. Not a bordered code box. The copyable value
 * appears only when one genuinely exists; otherwise the provenance says who
 * supplies it, never a fabricated value.
 */
function FieldRow({ field: f, compact }: { field: SetupField; compact?: boolean }) {
  const who = PROVENANCE_LABEL[f.provenance].toLowerCase();
  return (
    <div className="flex items-start gap-2 text-[13px] leading-relaxed">
      <span className="mt-[3px] shrink-0 text-[color:var(--faint)]" aria-hidden>
        ◦
      </span>
      <div className="min-w-0">
        <span>
          <code className="font-mono font-medium text-[color:var(--ink)]">{f.label}</code>
          <span className="text-[color:var(--faint)]">
            {" — "}
            {who}
            {!f.required ? ", optional" : ""}
          </span>
        </span>
        {f.description && !compact && (
          <span className="text-[color:var(--slate)]"> · {f.description}</span>
        )}
        {f.suggestedValue ? (
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <code className="min-w-0 truncate rounded bg-[color:var(--paper-raised)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink)]">
              {f.suggestedValue}
            </code>
            <CopyButton value={f.suggestedValue} label="Copy" />
            <span className="text-[11px] text-[color:var(--faint)]">verify before use</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
