"use client";

import { useState } from "react";
import type { JourneyStep, CodeSnippet } from "@/lib/schema/guide";

/**
 * Renders the implementation walkthrough — the guide's actionable centerpiece.
 * The steps are the staged custom-OAuth flow. Each step shows plain-language
 * guidance plus whatever assist the pipeline could ground: copyable cURL /
 * TypeScript snippets, a per-step "ask your agent" prompt, and a doc link.
 * Everything is computed deterministically server-side
 * (lib/guide/oauth-journey.ts), so snippets never contain a hallucinated
 * endpoint.
 *
 * `title`/`subtitle` let the page override the section label when needed.
 */
export function OAuthJourney({
  steps,
  title,
  subtitle,
}: {
  steps: JourneyStep[];
  title?: string;
  subtitle?: string;
}) {
  if (steps.length === 0) return null;
  const heading = title ?? "Implementation walkthrough";
  const sub =
    subtitle ??
    "The stages of the OAuth flow, with the concrete values, code, and prompts for this provider.";
  return (
    <section className="space-y-4">
      <div className="border-b border-[color:var(--rule)] pb-3">
        <h2 className="text-[1.3rem] font-semibold tracking-tight text-[color:var(--ink)]">{heading}</h2>
        <p className="mt-1 text-sm text-[color:var(--slate)]">{sub}</p>
      </div>
      <ol className="list-none space-y-3 pl-0">
        {steps.map((step) => (
          <JourneyStepCard key={step.key} step={step} />
        ))}
      </ol>
    </section>
  );
}

function JourneyStepCard({ step }: { step: JourneyStep }) {
  const hasAssist = step.snippets.length > 0 || step.agentPrompt || step.docUrl;
  return (
    <li className="rounded-lg border border-[color:var(--rule)] bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color:var(--paper-raised)] text-xs font-semibold text-[color:var(--slate)]">
          {step.order}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[color:var(--ink)]">{step.title}</h3>
            {!step.established && (
              <span
                className="rounded-full border border-[color:var(--rule-strong)] px-2 py-0.5 text-[11px] text-[color:var(--faint)]"
                title="Provider-specific values for this step were not established — confirm in the provider's docs."
              >
                confirm in docs
              </span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--slate)]">
            {step.summary}
          </p>

          {step.snippets.length > 0 && <SnippetTabs snippets={step.snippets} />}

          {hasAssist && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {step.agentPrompt && <CopyChip value={step.agentPrompt} label="Copy agent prompt" />}
              {step.docUrl && (
                <a
                  href={step.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[color:var(--slate)] underline underline-offset-2 hover:text-[color:var(--ink)]"
                >
                  Open provider docs
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function SnippetTabs({ snippets }: { snippets: CodeSnippet[] }) {
  const [active, setActive] = useState(0);
  const current = snippets[active] ?? snippets[0];
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-[color:var(--rule)]">
      <div className="flex items-center justify-between border-b border-[color:var(--rule)] bg-[color:var(--paper-raised)] pr-2">
        <div className="flex">
          {snippets.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setActive(i)}
              className={`px-3 py-1.5 font-mono text-xs ${
                i === active
                  ? "border-b-2 border-[color:var(--verified)] text-[color:var(--ink)]"
                  : "text-[color:var(--faint)] hover:text-[color:var(--slate)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <CopyChip value={current.code} label="Copy" compact />
      </div>
      <pre className="overflow-x-auto bg-[color:var(--ink)] p-3 font-mono text-xs leading-relaxed text-[#e8e6df]">
        {current.code}
      </pre>
    </div>
  );
}

function CopyChip({ value, label, compact }: { value: string; label: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — fail quietly */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1 rounded-full border border-[color:var(--rule-strong)] ${
        compact ? "px-2 py-0.5" : "px-2 py-0.5"
      } text-xs text-[color:var(--slate)] hover:border-[color:var(--faint)] hover:text-[color:var(--ink)]`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
