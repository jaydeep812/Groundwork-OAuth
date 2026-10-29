"use client";

import { useState } from "react";
import type { AttemptOutcome, Finding } from "@/lib/schema/guide";
import { Badge, SourceBadge } from "@/components/ui/badges";

/**
 * Compact "how we know" affordance rendered next to a claim on the guide
 * page. Shows a small outcome-colored chip; clicking expands a card with
 * the backing Finding(s): what the agent did, the observation, and the
 * evidence URLs.
 *
 * Props:
 *   - findings: the Guide-level findings[] array (so we can resolve ids).
 *   - findingIds: the ids this specific claim references.
 */

const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  confirmed: "confirmed by agent",
  supports: "supported by sources",
  contradicts: "contradicted by sources",
  insufficient: "not fully established",
  failed: "check failed",
  skipped: "check skipped",
};

const OUTCOME_TONE: Record<AttemptOutcome, Parameters<typeof Badge>[0]["tone"]> = {
  confirmed: "green",
  supports: "blue",
  contradicts: "amber",
  insufficient: "slate",
  failed: "red",
  skipped: "slate",
};

export function WhyWeKnow({
  findings,
  findingIds,
}: {
  findings: Finding[];
  findingIds: string[];
}) {
  const [open, setOpen] = useState(false);
  if (findingIds.length === 0) return null;
  const resolved = findingIds
    .map((id) => findings.find((f) => f.id === id))
    .filter((f): f is Finding => Boolean(f));
  if (resolved.length === 0) return null;

  // Summarize across the referenced findings — if ANY is "confirmed", prefer that
  // for the badge; otherwise fall back to the "best" outcome.
  const rank: AttemptOutcome[] = [
    "confirmed",
    "supports",
    "insufficient",
    "contradicts",
    "failed",
    "skipped",
  ];
  const best =
    rank.find((r) => resolved.some((f) => f.outcome === r)) ?? resolved[0].outcome;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-300"
        aria-expanded={open}
        aria-label={open ? "Hide evidence" : "Show how we know"}
      >
        Why: {OUTCOME_LABEL[best]} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-2 w-full space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
          {resolved.map((f) => (
            <FindingBlock key={f.id} finding={f} />
          ))}
        </div>
      )}
    </>
  );
}

function FindingBlock({ finding }: { finding: Finding }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={OUTCOME_TONE[finding.outcome]}>{finding.outcome}</Badge>
        <Badge tone="slate">{finding.attemptKind}</Badge>
        <span className="text-neutral-500">by {finding.agent}</span>
      </div>
      <p className="text-neutral-700">
        <span className="font-semibold text-neutral-500">Did:</span> {finding.attempted}
      </p>
      <p className="text-neutral-800">
        <span className="font-semibold text-neutral-500">Concluded:</span> {finding.conclusion}
      </p>
      {finding.observation && (
        <pre className="overflow-x-auto rounded border border-neutral-200 bg-white p-2 text-[11px] text-neutral-700">
          {finding.observation}
        </pre>
      )}
      {finding.uncertainty && (
        <p className="rounded border border-amber-900 bg-[#211b10] p-2 text-amber-200">
          <span className="font-semibold">Not established:</span> {finding.uncertainty}
        </p>
      )}
      {finding.evidence.length > 0 && (
        <ul className="space-y-1">
          {finding.evidence.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <SourceBadge sourceType={e.sourceType} />
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-indigo-700 underline underline-offset-2 hover:text-indigo-500"
              >
                {e.title || e.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The bottom "What we tested" audit log: a collapsed listing of every
 * Finding grouped by agent, so a developer can scan everything the pipeline
 * did without expanding every per-claim popover.
 */
export function AuditLog({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState(false);
  if (findings.length === 0) return null;

  // Group by agent, preserving the first-seen order.
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = grouped.get(f.agent) ?? [];
    arr.push(f);
    grouped.set(f.agent, arr);
  }
  const outcomeCounts = findings.reduce<Record<string, number>>((a, f) => {
    a[f.outcome] = (a[f.outcome] ?? 0) + 1;
    return a;
  }, {});

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-lg font-semibold text-neutral-900"
      >
        What the agents actually did ({findings.length}) {open ? "▴" : "▾"}
      </button>
      <div className="flex flex-wrap gap-2 text-xs">
        {(["confirmed", "supports", "insufficient", "failed", "skipped", "contradicts"] as const).map(
          (k) =>
            outcomeCounts[k] ? (
              <Badge key={k} tone={OUTCOME_TONE[k]}>
                {k}: {outcomeCounts[k]}
              </Badge>
            ) : null,
        )}
      </div>
      {open && (
        <div className="space-y-6">
          {[...grouped.entries()].map(([agent, fs]) => (
            <div key={agent} className="space-y-3">
              <h3 className="text-sm font-semibold text-neutral-500">
                {agent} ({fs.length})
              </h3>
              <ol className="space-y-3">
                {fs.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-md border border-neutral-200 bg-white p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="font-medium text-neutral-900">{f.question}</div>
                      <div className="flex items-center gap-2">
                        <Badge tone={OUTCOME_TONE[f.outcome]}>{f.outcome}</Badge>
                        <Badge tone="slate">{f.attemptKind}</Badge>
                      </div>
                    </div>
                    <FindingBlock finding={f} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
