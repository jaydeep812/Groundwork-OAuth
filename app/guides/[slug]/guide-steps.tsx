"use client";

import { useEffect, useState } from "react";
import type {
  Finding,
  Guide,
  ProgressStatus,
  SetupStep,
  SetupStepCategory,
} from "@/lib/schema/guide";
import { CopyButton } from "@/components/ui/copy-button";
import { Badge, categoryLabel } from "@/components/ui/badges";
import { WhyWeKnow } from "@/components/why-we-know";

/**
 * Setup-step rendering + per-step progress tracking.
 *
 * Steps are grouped by category (register-provider-app → configure-integration →
 * authorize-user → verify-data-access → provider-approval) so the developer sees
 * phases, not just a flat list.
 *
 * Progress is stored in localStorage only — NOT shared across devices.
 */

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
  let runningIndex = 0;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between border-b border-neutral-200 pb-3">
        <h2 className="text-xl font-bold tracking-tight text-neutral-900">Setup checklist</h2>
        <span className="shrink-0 font-mono text-xs text-neutral-500">
          {loaded ? `${completed} / ${guide.setupSteps.length} done` : "…"}
        </span>
      </div>

      {runs.map((run, ri) => (
        <section key={`${run.category}-${ri}`} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            <span>{categoryLabel(run.category)}</span>
          </h3>
          <ol className="space-y-3">
            {run.steps.map((step) => {
              runningIndex += 1;
              return (
                <StepCard
                  key={step.id}
                  step={step}
                  index={runningIndex}
                  status={statusOf(step)}
                  onAdvance={() => advance(step)}
                  findings={guide.findings}
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
}: {
  step: SetupStep;
  index: number;
  status: ProgressStatus;
  onAdvance: () => void;
  findings: Finding[];
}) {
  const findingIds = step.findingIds ?? [];
  const done = status === "completed";
  // Progressive disclosure: steps start collapsed to a scannable summary; the
  // developer expands the one they're working on. Completed steps stay collapsed.
  const [open, setOpen] = useState(false);
  const hasDetail =
    Boolean(step.rationale) ||
    step.fields.length > 0 ||
    Boolean(step.expectedOutcome) ||
    Boolean(step.verification) ||
    Boolean(step.recovery) ||
    findingIds.length > 0;

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              done ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {done ? "✓" : index}
          </span>
          <div>
            <h4 className="font-medium text-neutral-900">{step.title}</h4>
            {(!step.required || step.appliesWhen) && (
              <div className="mt-1 flex flex-wrap gap-2">
                {!step.required && <Badge tone="neutral">optional</Badge>}
                {step.appliesWhen && <Badge tone="amber">conditional</Badge>}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onAdvance}
          className="shrink-0"
          aria-label={`Change status for ${step.title}. Current: ${STATUS_LABEL[status]}`}
        >
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]} ↻</Badge>
        </button>
      </div>

      {/* Always-visible action summary — the one line the developer needs to
          scan. Provider link sits right beside it. */}
      <div className="mt-3 pl-9 text-sm">
        <p className="whitespace-pre-wrap text-neutral-700">{step.instructions}</p>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-700"
            aria-expanded={open}
          >
            {open ? "Hide detail" : "Show detail"}
          </button>
        )}
      </div>

      {open && hasDetail && (
        <div className="mt-3 space-y-3 pl-9 text-sm">
          {step.appliesWhen && <Field label="Applies when">{step.appliesWhen}</Field>}
          {step.rationale && <Field label="Why it matters">{step.rationale}</Field>}

          {step.fields.length > 0 && <FieldsTable step={step} />}

          {step.expectedOutcome && <Field label="Expected result">{step.expectedOutcome}</Field>}
          {step.verification && <Field label="How to verify">{step.verification}</Field>}
          {step.recovery && <Field label="If it fails">{step.recovery}</Field>}

          {findingIds.length > 0 && (
            <div>
              <WhyWeKnow findings={findings} findingIds={findingIds} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-neutral-700">{children}</div>
    </div>
  );
}

const PROVENANCE_LABEL = {
  "developer-input": "You provide",
  "environment-derived": "From your app/environment",
  "provider-issued": "Issued by provider",
} as const;

const PROVENANCE_HELP: Record<keyof typeof PROVENANCE_LABEL, string> = {
  "developer-input": "You choose this value (e.g. app name).",
  "environment-derived": "This comes from your own app (e.g. redirect URI = where your app serves OAuth callbacks).",
  "provider-issued": "The provider issues this after registration (e.g. client ID). Never store secrets in this guide.",
};

function FieldsTable({ step }: { step: SetupStep }) {
  return (
    <div className="rounded-md border border-neutral-200">
      <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Configuration fields
      </div>
      <ul className="divide-y divide-neutral-100">
        {step.fields.map((f) => (
          <li key={f.id} className="px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-neutral-900">{f.label}</span>
              {f.required ? (
                <Badge tone="red">required</Badge>
              ) : (
                <Badge tone="neutral">optional</Badge>
              )}
              <Badge tone="slate" title={PROVENANCE_HELP[f.provenance]}>
                {PROVENANCE_LABEL[f.provenance]}
              </Badge>
              {f.missingInfo && <Badge tone="slate">value not determined</Badge>}
            </div>
            {f.description && <p className="mt-1 text-neutral-600">{f.description}</p>}
            {f.suggestedValue ? (
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-800">
                  {f.suggestedValue}
                </code>
                <CopyButton value={f.suggestedValue} label="Copy value" />
                <span className="text-xs text-neutral-400">verify before use</span>
              </div>
            ) : (
              // Only show the "you supply this" message for developer- or
              // environment-provided fields; provider-issued fields come later
              // and don't belong on the shareable guide anyway.
              f.provenance !== "provider-issued" && (
                <p className="mt-1 text-xs text-neutral-400">
                  Fill in your own value based on the guidance above.
                </p>
              )
            )}
            {f.validation && (
              <p className="mt-1 text-xs text-neutral-500">Validation: {f.validation}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
