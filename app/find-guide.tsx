"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GuideSummary } from "@/lib/db/guides";
import { GuideCard } from "@/components/guide-card";

/**
 * Unified search-to-guide entry. One field + one "Find guide" button:
 *  - as you type, matching existing guides filter live (free, local — this is
 *    also how you browse the library);
 *  - on submit, Groundwork decides what to do, so the user never has to pick
 *    "search" vs "generate":
 *      · exact match  → open that guide
 *      · some matches → leave them shown to pick from (no extra screen)
 *      · no match     → offer to research & generate (the only path that spends
 *                       the expensive live research, and only after submit —
 *                       never on a keystroke).
 *
 * Reuses the existing generation endpoint (/api/investigation) and routing; no
 * backend change. Provider identity resolution stays server-side in the graph.
 */

type Phase = "idle" | "generating" | "error";

/** Normalize for matching: lowercase, strip scheme/www, drop a TLD-ish tail and
 * non-alphanumerics, so "Notion", "notion.so", "https://www.notion.so" all align.
 * Deliberately conservative — a shared root does NOT prove the same OAuth
 * provider, so this only drives *display* matches; the server resolves identity. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.[a-z]{2,}$/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function FindGuide({ guides }: { guides: GuideSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressIdx, setProgressIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const q = query.trim();
  const nq = normalize(q);

  const matches = useMemo(() => {
    if (!q) return guides;
    const ql = q.toLowerCase();
    return guides.filter(
      (g) =>
        g.providerName.toLowerCase().includes(ql) ||
        normalize(g.providerName).includes(nq) ||
        normalize(g.providerUrl).includes(nq) ||
        g.description.toLowerCase().includes(ql),
    );
  }, [guides, q, nq]);

  const exact = useMemo(
    () => (nq ? guides.find((g) => normalize(g.providerName) === nq || normalize(g.providerUrl) === nq) : undefined),
    [guides, nq],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    // Exact existing guide → open it directly, no intermediate screen.
    if (exact) {
      router.push(`/guides/${exact.slug}`);
      return;
    }
    // Some matches but no exact hit → let the user pick from the shown cards.
    if (matches.length > 0) return;
    // No match → research & generate (only now do we spend live research).
    await generate();
  }

  async function generate() {
    setPhase("generating");
    setError(null);
    setProgressIdx(0);
    timer.current = setInterval(
      () => setProgressIdx((i) => Math.min(i + 1, GENERATION_STEPS.length - 1)),
      Math.round((120 * 1000) / GENERATION_STEPS.length),
    );
    try {
      const res = await fetch("/api/investigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerNameOrUrl: q }),
      });
      const data = await res.json();
      stop();
      if (!res.ok || !data.ok) {
        setPhase("error");
        setError(data.error ?? "Couldn't finish researching this provider. Try again, or check the name and URL.");
        return;
      }
      router.push(`/guides/${data.slug}`);
    } catch {
      stop();
      setPhase("error");
      setError("Lost connection. Check your network and try again.");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  if (phase === "generating") {
    return <GeneratingState query={q} stepIdx={progressIdx} />;
  }

  return (
    <div className="space-y-12">
      {/* Search + its states stay in a readable, hero-width column. */}
      <div className="max-w-[40rem] space-y-4">
        <form onSubmit={onSubmit} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Provider name or website — e.g. Notion or notion.so"
              aria-label="Find or generate an OAuth guide by provider name or website"
              className="min-w-0 flex-1 rounded-md border border-[color:var(--rule-strong)] bg-[color:var(--paper)] px-4 py-3 text-[length:var(--text-body)] text-[color:var(--ink)] outline-none transition-colors placeholder:text-[color:var(--faint)] focus:border-[color:var(--verified)]"
            />
            <button
              type="submit"
              disabled={!q}
              className="shrink-0 rounded-md bg-[color:var(--ink)] px-5 py-3 text-[length:var(--text-body)] font-medium text-[color:var(--paper)] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              Find guide
            </button>
          </div>
          <p className="text-[length:var(--text-secondary)] text-[color:var(--slate)]">
            Find an existing guide or generate one for a new provider.
          </p>
        </form>

        {phase === "error" && (
          <div className="rounded-md border-l-2 border-[color:var(--alert)] bg-[color:var(--alert-soft)] px-4 py-3" role="alert">
            <p className="text-[length:var(--text-body)] text-[color:var(--ink)]">{error}</p>
            <button
              type="button"
              onClick={generate}
              className="mt-2 text-[length:var(--text-secondary)] font-medium text-[color:var(--alert)] underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}

        {/* No existing match → explicit generate affordance (research on submit). */}
        {q && matches.length === 0 && phase !== "error" && (
          <div className="rounded-lg border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-6">
            <p className="text-[length:var(--text-body)] text-[color:var(--ink)]">
              No guide for “{q}” yet.
            </p>
            <p className="mt-1 text-[length:var(--text-secondary)] text-[color:var(--slate)]">
              Research its OAuth setup live — documentation, configuration, requirements, and
              blockers. Takes about 90–180 seconds.
            </p>
            <button
              type="button"
              onClick={generate}
              className="mt-3 rounded-md bg-[color:var(--ink)] px-4 py-2 text-[length:var(--text-body)] font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
            >
              Generate guide for “{q}”
            </button>
          </div>
        )}
      </div>

      {/* Library grid — full width, with a heading so it reads as the browsable
          library (not search results). Shown whenever there are matches. */}
      {matches.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-[color:var(--rule)] pb-3">
            <h2 className="text-[length:var(--text-section)] font-semibold tracking-tight text-[color:var(--ink)]">
              {q ? "Matches" : "Library"}
            </h2>
            <span className="text-[length:var(--text-secondary)] text-[color:var(--faint)]">
              {matches.length} {matches.length === 1 ? "guide" : "guides"}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((g) => (
              <GuideCard key={g.slug} guide={g} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Honest, sequential progress — real pipeline stages on a timer, never faked
 * per-tool success. */
const GENERATION_STEPS = [
  "Reading the official docs…",
  "Checking OAuth configuration and endpoints…",
  "Researching setup requirements…",
  "Looking for approval steps and blockers…",
  "Writing your guide…",
];

function GeneratingState({ query, stepIdx }: { query: string; stepIdx: number }) {
  return (
    <div className="rounded-lg border border-[color:var(--rule)] bg-[color:var(--white)] p-8">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--verified)] border-t-transparent" />
        <span className="text-[length:var(--text-card)] font-medium text-[color:var(--ink)]">
          Researching {query}…
        </span>
      </div>
      <ol className="mt-5 space-y-2 text-[length:var(--text-body)]">
        {GENERATION_STEPS.map((label, i) => (
          <li
            key={i}
            className={`flex items-center gap-2 ${
              i < stepIdx
                ? "text-[color:var(--faint)]"
                : i === stepIdx
                  ? "text-[color:var(--ink)]"
                  : "text-[color:var(--faint)] opacity-60"
            }`}
          >
            <span aria-hidden>{i < stepIdx ? "✓" : i === stepIdx ? "→" : "•"}</span>
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[length:var(--text-secondary)] text-[color:var(--faint)]">
        This takes about 90–180 seconds. Keep this tab open.
      </p>
    </div>
  );
}
