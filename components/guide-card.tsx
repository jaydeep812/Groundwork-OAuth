import Link from "next/link";
import type { GuideSummary } from "@/lib/db/guides";
import { formatEstimate } from "@/components/ui/badges";

/** Compact readiness glance for the library card: difficulty + whether approval
 * waiting is in play. Uses only fields already on GuideSummary. Color maps to
 * the same semantic scale as the guide verdict (green=easy, amber=moderate,
 * rust=hard). */
function readiness(guide: GuideSummary): { label: string; color: string } {
  const r = guide.difficulty.rating;
  const color =
    r === "easy"
      ? "var(--verified)"
      : r === "hard"
        ? "var(--alert)"
        : r === "moderate"
          ? "var(--open)"
          : "var(--faint)";
  const label = r === "unknown" ? "Difficulty not established" : r.charAt(0).toUpperCase() + r.slice(1);
  return { label, color };
}

export function GuideCard({ guide }: { guide: GuideSummary }) {
  const r = readiness(guide);
  const waiting = guide.externalWaiting;
  const waitKnown = !(waiting.kind === "unknown" || waiting.value == null);
  return (
    <Link
      href={`/guides/${guide.slug}`}
      className="group flex h-full flex-col gap-2.5 rounded-xl border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-5 transition-colors hover:border-[color:var(--verified)] hover:bg-white"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[1.15rem] font-semibold tracking-tight text-[color:var(--ink)] transition-colors group-hover:text-[color:var(--verified)]">
          {guide.providerName}
        </h3>
        <span className="shrink-0 text-[12.5px] text-[color:var(--faint)]">
          {formatEstimate(guide.activeEffort)} hands-on
        </span>
      </div>
      <p className="text-[14px] leading-relaxed text-[color:var(--slate)] line-clamp-2">
        {guide.description}
      </p>
      {/* Readiness glance — difficulty + approval signal, the two things that
          tell a developer "is this a quick job or a slog" before they open it. */}
      <div className="mt-auto flex items-center gap-2 pt-1 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: r.color }}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} />
          {r.label}
        </span>
        <span className="text-[color:var(--rule-strong)]">·</span>
        <span className="text-[color:var(--faint)]">
          {waitKnown ? `${formatEstimate(waiting)} approval wait` : "no approval wait found"}
        </span>
      </div>
    </Link>
  );
}

