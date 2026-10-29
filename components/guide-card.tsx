import Link from "next/link";
import type { GuideSummary } from "@/lib/db/guides";
import { formatEstimate } from "@/components/ui/badges";

export function GuideCard({ guide }: { guide: GuideSummary }) {
  return (
    <Link
      href={`/guides/${guide.slug}`}
      className="group flex h-full flex-col gap-2.5 rounded-xl border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-5 transition-colors hover:border-[color:var(--rule-strong)] hover:bg-white"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[1.15rem] font-semibold tracking-tight text-[color:var(--ink)] transition-colors group-hover:text-[color:var(--verified)]">
          {guide.providerName}
        </h3>
        <span className="shrink-0 text-[12.5px] text-[color:var(--faint)]">
          {formatEstimate(guide.activeEffort)}
        </span>
      </div>
      <p className="text-[14px] leading-relaxed text-[color:var(--slate)] line-clamp-3">
        {guide.description}
      </p>
    </Link>
  );
}

