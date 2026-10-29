"use client";

import { useEffect, useState } from "react";
import type {
  ExecutionMode,
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

/** Ownership derived from the step's executionMode. Compact label + who-acts,
 * so responsibility is clear without another paragraph per step. */
const OWNERSHIP: Record<ExecutionMode, { label: string; help: string }> = {
  manual: { label: "You do this", help: "A human must complete this in the provider's portal or console." },
  "agent-assisted": { label: "Agent can help", help: "A coding agent can draft or implement this with you in the loop." },
  automatable: { label: "Agent can help", help: "This can be generated or automated — review before shipping." },
};

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

  // Required, user-supplied fields are the one piece of config a developer must
  // see before acting — surface them compactly in the default view. Everything
  // else (optional fields, provider-issued values) stays in Details.
  const essentialFields = step.fields.filter((f) => f.required && f.provenance !== "provider-issued");

  // Progressive disclosure. The first actionable step opens by default; the rest
  // start collapsed to a scannable summary. "View code" actions also open the
  // panel (and we scroll the reader to the code within it).
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  // Detail content that lives behind the toggle. Code and the essential-field
  // Keep only the free-text notes a fluent developer actually benefits from.
  // Rationale is the first to go: it's almost always generic OAuth restatement,
  // so it shows ONLY when it names something provider-specific. Troubleshooting
  // likewise survives only when it names a real error/location, not "re-check
  // your values". Verification is the one light scaffold we keep unconditionally
  // (as a terse one-liner), since a completion criterion helps every reader.
  const showRationale = isWorthShowing(step.rationale, true);
  const showRecovery = isWorthShowing(step.recovery);
  const verificationLine = step.verification || step.expectedOutcome;
  const extraFields = step.fields.filter((f) => !essentialFields.includes(f));

  // Detail content that lives behind the toggle — only what survived the filter.
  const hasDetail =
    showRationale ||
    showRecovery ||
    extraFields.length > 0 ||
    snippets.length > 0 ||
    findingIds.length > 0;

  const own = OWNERSHIP[step.executionMode];

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
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="text-[11px] font-medium text-[color:var(--faint)]" title={own.help}>
                {own.label}
              </span>
              {!step.required && <Badge tone="neutral">optional</Badge>}
              {step.appliesWhen && <Badge tone="amber">conditional</Badge>}
            </div>
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

      {/* The one-line task. Concise by construction (seed instructions are short);
          the full step-by-step lives under Details. */}
      <div className="mt-2.5 pl-9">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[color:var(--ink)]">
          {step.instructions}
        </p>

        {/* Conditional applicability is a gate on the action — show it inline. */}
        {step.appliesWhen && (
          <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--open)]">
            <span className="font-medium">Applies when:</span> {step.appliesWhen}
          </p>
        )}

        {/* Primary action + essential config live right under the instruction. */}
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
          {action?.kind === "reveal-code" && snippets.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ink)] px-3.5 py-2 text-[13px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--verified)]"
              aria-expanded={open}
            >
              {action.label}
              <span aria-hidden>↓</span>
            </button>
          )}
          {hasDetail && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-[color:var(--rule-strong)] px-3 py-2 text-[13px] text-[color:var(--slate)] transition-colors hover:border-[color:var(--faint)] hover:text-[color:var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--verified)]"
              aria-expanded={open}
            >
              {open ? "Hide details" : "Details"}
              <span aria-hidden>{open ? "▴" : "▾"}</span>
            </button>
          )}
        </div>

        {/* Essential, user-provided config — compact rows, always visible. */}
        {essentialFields.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[12px] font-semibold text-[color:var(--slate)]">
              Required configuration
            </div>
            <div className="space-y-1.5">
              {essentialFields.map((f) => (
                <FieldRow key={f.id} field={f} compact />
              ))}
            </div>
          </div>
        )}

        {/* The one light scaffold we keep for every reader: a terse "done when"
            criterion. No section header, no essay — one quiet line with a check. */}
        {verificationLine && (
          <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-relaxed text-[color:var(--slate)]">
            <span className="mt-px shrink-0 text-[color:var(--verified)]" aria-hidden>
              ✓
            </span>
            <span>
              <span className="sr-only">Done when: </span>
              {verificationLine}
            </span>
          </p>
        )}
      </div>

      {/* Progressive disclosure: only the depth that survived the "would a
          developer who knows OAuth actually need this?" filter. */}
      {open && hasDetail && (
        <div className="mt-4 space-y-4 border-t border-[color:var(--rule)] pl-9 pt-4 text-sm">
          {/* Remaining config fields (optional / provider-issued). */}
          {extraFields.length > 0 && (
            <Detail label="Configuration">
              <div className="space-y-1.5">
                {extraFields.map((f) => (
                  <FieldRow key={f.id} field={f} />
                ))}
              </div>
            </Detail>
          )}

          {snippets.length > 0 && (
            <Detail label="Code for this step">
              <SnippetTabs snippets={snippets} />
            </Detail>
          )}

          {/* Troubleshooting — ONLY when it names a real error/location, not
              generic "re-check your values" advice. */}
          {showRecovery && (
            <Detail label="Troubleshooting" tone="alert">
              {step.recovery}
            </Detail>
          )}

          {/* Rationale — kept ONLY when provider-specific; generic "why OAuth
              works" restatement is dropped entirely. */}
          {showRationale && <Detail label="Why this matters">{step.rationale}</Detail>}

          {/* Evidence provenance — unobtrusive, below a rule of its own. */}
          {findingIds.length > 0 && (
            <div className="border-t border-[color:var(--rule)] pt-3">
              <WhyWeKnow findings={findings} findingIds={findingIds} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** A labelled block inside the Details disclosure. Small, quiet label; readable
 * near-ink body. `tone="alert"` tints the label for troubleshooting. */
function Detail({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "alert";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`text-[12px] font-semibold ${
          tone === "alert" ? "text-[color:var(--alert)]" : "text-[color:var(--slate)]"
        }`}
      >
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap leading-relaxed text-[color:var(--ink)]">{children}</div>
    </div>
  );
}

const PROVENANCE_LABEL: Record<ValueProvenance, string> = {
  "developer-input": "You provide",
  "environment-derived": "From your app",
  "provider-issued": "Provider issues",
};

const PROVENANCE_HELP: Record<ValueProvenance, string> = {
  "developer-input": "You choose this value (e.g. app name).",
  "environment-derived": "Comes from your own app (e.g. redirect URI = where your app serves OAuth callbacks).",
  "provider-issued": "The provider issues this after registration (e.g. client ID). Never store secrets in this guide.",
};

/**
 * A single configuration field as a compact row — not a bordered table cell.
 * Shows name, who supplies it, required/optional, a one-line expected value,
 * and a copy action ONLY when a real value exists. When no value is supplied,
 * the placeholder is unmistakable ("you provide this") — never fabricated.
 */
function FieldRow({ field: f, compact }: { field: SetupField; compact?: boolean }) {
  const provenanceTone = f.provenance === "provider-issued" ? "amber" : "slate";
  return (
    <div className="rounded-md border border-[color:var(--rule)] bg-[color:var(--paper-raised)]/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <code className="font-mono text-[13px] font-medium text-[color:var(--ink)]">{f.label}</code>
        <Badge tone={provenanceTone} title={PROVENANCE_HELP[f.provenance]}>
          {PROVENANCE_LABEL[f.provenance]}
        </Badge>
        {!f.required && <Badge tone="neutral">optional</Badge>}
      </div>

      {/* One-line expected value — only in the fuller (non-compact) rows, or when
          there's a copyable value to anchor. */}
      {f.description && !compact && (
        <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--slate)]">{f.description}</p>
      )}

      {f.suggestedValue ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="min-w-0 truncate rounded bg-[color:var(--paper-raised)] px-2 py-1 font-mono text-xs text-[color:var(--ink)]">
            {f.suggestedValue}
          </code>
          <CopyButton value={f.suggestedValue} label="Copy value" />
          <span className="text-[11px] text-[color:var(--faint)]">verify before use</span>
        </div>
      ) : (
        // No fabricated value. The badge already says who supplies it; add an
        // explicit placeholder only for environment-derived fields, where "you
        // supply this from your own app" isn't self-evident.
        f.provenance === "environment-derived" && (
          <p className="mt-1 text-[11px] italic text-[color:var(--faint)]">
            No value yet — you supply this from your app configuration.
          </p>
        )
      )}

      {f.validation && !compact && (
        <p className="mt-1 text-[11px] text-[color:var(--faint)]">Validation: {f.validation}</p>
      )}
    </div>
  );
}
