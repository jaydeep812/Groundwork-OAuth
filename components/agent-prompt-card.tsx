"use client";

import { useState } from "react";

/**
 * The coding-agent handoff — the "Copy setup brief" action that sits at the top
 * of the setup checklist. A developer copies a single, self-contained,
 * fact-grounded brief and pastes it into Claude Code, Cursor, or another coding
 * agent to implement the integration. The brief is computed deterministically
 * server-side (never model-written), so it is safe to render verbatim. Only
 * shown when the guide produced one.
 */
export function AgentPromptCard({ prompt, providerName }: { prompt: string; providerName: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — fail quietly */
    }
  }

  return (
    <section className="rounded-lg border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[1.15rem] font-semibold tracking-tight text-[color:var(--ink)]">
            Hand off to a coding agent
          </h3>
          <p className="mt-1.5 max-w-[42rem] text-[14px] leading-relaxed text-[color:var(--slate)]">
            A self-contained brief with {providerName}&apos;s verified endpoints, scopes, callback
            rules, env placeholders, steps, and tests — grounded in the evidence, not guessed. Paste
            it into Claude Code, Cursor, or Copilot to start the integration.
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-[color:var(--ink)] px-4 py-2 text-[14px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
        >
          {copied ? "Copied" : "Copy setup brief"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-[14px] text-[color:var(--slate)] underline decoration-[color:var(--rule-strong)] underline-offset-4 hover:text-[color:var(--ink)]"
        aria-expanded={open}
      >
        {open ? "Hide brief" : "Preview brief"}
      </button>

      {open && (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[color:var(--rule)] bg-[color:var(--paper)] p-4 font-mono text-[12.5px] leading-relaxed text-[color:var(--ink)]">
          {prompt}
        </pre>
      )}
    </section>
  );
}
