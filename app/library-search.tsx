"use client";

import { useMemo, useState } from "react";
import type { GuideSummary } from "@/lib/db/guides";
import { GuideCard } from "@/components/guide-card";

export function LibrarySearch({ guides }: { guides: GuideSummary[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guides;
    return guides.filter(
      (g) =>
        g.providerName.toLowerCase().includes(q) || g.description.toLowerCase().includes(q),
    );
  }, [guides, query]);

  return (
    <div className="space-y-5">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search providers…"
        aria-label="Search guides by provider name"
        className="w-full max-w-sm rounded-md border border-[color:var(--rule-strong)] bg-[color:var(--paper)] px-4 py-2.5 text-[15px] text-[color:var(--ink)] outline-none transition-colors placeholder:text-[color:var(--faint)] focus:border-[color:var(--verified)]"
      />
      {filtered.length === 0 ? (
        <p className="border-t border-[color:var(--rule)] pt-6 text-[15px] text-[color:var(--slate)]">
          No providers match “{query}”.{" "}
          <a href="/investigate" className="text-[color:var(--verified)] underline underline-offset-2">
            Investigate it live
          </a>{" "}
          to add it.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g) => (
            <GuideCard key={g.slug} guide={g} />
          ))}
        </div>
      )}
    </div>
  );
}
