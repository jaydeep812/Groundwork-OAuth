"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context); fail quietly.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-[color:var(--rule-strong)] bg-[color:var(--white)] px-2 py-1 text-xs font-medium text-[color:var(--slate)] transition-colors hover:border-[color:var(--faint)] hover:text-[color:var(--ink)]"
      aria-label={`Copy ${label}`}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
