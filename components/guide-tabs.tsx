"use client";

import { useEffect, useState } from "react";

/**
 * Tab shell for the provider guide. The four panels are rendered server-side and
 * passed in as children; this component only toggles which one is visible, so:
 *  - server rendering of panel content is preserved (panels are plain nodes),
 *  - all panels stay MOUNTED (toggled with `hidden`), so client state inside
 *    them — the setup checklist's localStorage-backed progress, open <details> —
 *    survives tab switches,
 *  - the active tab syncs to the URL hash (#overview/#setup/#technical/#evidence)
 *    so links, sharing, and the "Start setup" button deep-link correctly.
 */

export type GuideTabKey = "overview" | "setup" | "technical" | "evidence";

const TABS: { key: GuideTabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "setup", label: "Setup" },
  { key: "technical", label: "Technical" },
  { key: "evidence", label: "Evidence" },
];

const KEYS = new Set(TABS.map((t) => t.key));

function hashTab(): GuideTabKey | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "");
  return KEYS.has(h as GuideTabKey) ? (h as GuideTabKey) : null;
}

export function GuideTabs({
  overview,
  setup,
  technical,
  evidence,
}: {
  overview: React.ReactNode;
  setup: React.ReactNode;
  technical: React.ReactNode;
  evidence: React.ReactNode;
}) {
  const [active, setActive] = useState<GuideTabKey>("overview");

  // Adopt the hash on mount and follow hash changes (deep links, back/forward,
  // and the in-page "Start setup →" anchor which sets #setup).
  useEffect(() => {
    const sync = () => {
      const t = hashTab();
      if (t) setActive(t);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const select = (key: GuideTabKey) => {
    setActive(key);
    // Update the hash without scrolling the page (replaceState keeps history clean).
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${key}`);
    }
  };

  const panels: Record<GuideTabKey, React.ReactNode> = {
    overview,
    setup,
    technical,
    evidence,
  };

  return (
    <div className="space-y-8">
      {/* Persistent, sticky tab bar. Stays reachable on long guide pages;
          horizontal-scrollable on narrow screens so labels never overflow. The
          paper background keeps content from showing through when pinned. */}
      <div
        role="tablist"
        aria-label="Guide sections"
        className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto border-b border-[color:var(--rule)] bg-[color:var(--paper)]/95 px-1 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--paper)]/80"
      >
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(t.key)}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-[15px] font-medium transition-colors ${
                isActive
                  ? "border-[color:var(--verified)] text-[color:var(--ink)]"
                  : "border-transparent text-[color:var(--faint)] hover:text-[color:var(--slate)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {TABS.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          hidden={t.key !== active}
          className={t.key === active ? "space-y-10" : ""}
        >
          {panels[t.key]}
        </div>
      ))}
    </div>
  );
}
