"use client";

import { useState } from "react";

/** Copies the current page URL — the stable shareable link for this guide. */
export function CopyShareButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
    >
      {copied ? "Link copied!" : "Share this guide"}
    </button>
  );
}
