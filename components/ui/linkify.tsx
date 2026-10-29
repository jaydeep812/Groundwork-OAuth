import type { ReactNode } from "react";

/**
 * Renders free text, turning any bare http(s) URL into a real clickable link.
 * Used for model-written prose (nextAction, rationales) that frequently embeds
 * a URL the developer should be able to click rather than copy by hand.
 */
const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const isUrl = (s: string) => /^https?:\/\//.test(s);

export function Linkify({ text, className }: { text: string; className?: string }): ReactNode {
  if (!text) return null;
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        isUrl(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={className ?? "text-[color:var(--verified)] underline underline-offset-2 hover:opacity-80"}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
