"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Phase = "idle" | "researching" | "error";

// Honest, approximate progress labels. These describe real pipeline stages but
// are shown on a timer — we do not stream fake per-tool activity.
const PROGRESS_STEPS = [
  "Reading the official docs…",
  "Confirming the provider's domain…",
  "Checking the developer portal…",
  "Looking for managed-auth support…",
  "Testing the auth endpoints (read-only)…",
  "Researching approval, limits, and token lifetime…",
  "Writing your guide…",
  "Saving…",
];

export function InvestigateForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressIdx, setProgressIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchErrors, setSearchErrors] = useState<string[]>([]);

  const [providerNameOrUrl, setProvider] = useState("");
  const [useCase, setUseCase] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSearchErrors([]);

    if (!providerNameOrUrl.trim()) {
      setError("Enter a provider name or website.");
      return;
    }

    setPhase("researching");
    setProgressIdx(0);
    const timer = setInterval(() => {
      setProgressIdx((i) => Math.min(i + 1, PROGRESS_STEPS.length - 1));
    }, 4500);

    try {
      const res = await fetch("/api/investigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerNameOrUrl: providerNameOrUrl.trim(),
          useCase: useCase.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setPhase("error");
        setError(data.error ?? "Couldn't finish researching this provider. Try again, or check the name and URL.");
        if (Array.isArray(data.searchErrors)) setSearchErrors(data.searchErrors);
        return;
      }
      router.push(`/guides/${data.slug}`);
    } catch (err) {
      setPhase("error");
      setError((err as Error).message || "Lost connection. Check your network and try again.");
    } finally {
      clearInterval(timer);
    }
  }

  if (phase === "researching") {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span className="font-medium text-neutral-900">Investigating {providerNameOrUrl}…</span>
        </div>
        <ol className="mt-5 space-y-2 text-sm">
          {PROGRESS_STEPS.map((label, i) => (
            <li
              key={i}
              className={`flex items-center gap-2 ${
                i < progressIdx ? "text-neutral-400" : i === progressIdx ? "text-neutral-900" : "text-neutral-300"
              }`}
            >
              <span>{i < progressIdx ? "✓" : i === progressIdx ? "→" : "•"}</span>
              {label}
            </li>
          ))}
        </ol>
        <p className="mt-5 text-xs text-neutral-400">
          This takes about 90–180 seconds. Keep this tab open.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6">
      {phase === "error" && error && (
        <div className="rounded-md border border-red-900 bg-[#211313] p-4 text-sm text-red-300">
          <p className="font-medium">Research did not complete</p>
          <p className="mt-1">{error}</p>
          {searchErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-red-400">
              {searchErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-red-400">No guide was created. Adjust your input and retry.</p>
        </div>
      )}

      <Labeled label="Provider name or website" required hint="e.g. “Notion” or “https://notion.so”">
        <input
          value={providerNameOrUrl}
          onChange={(e) => setProvider(e.target.value)}
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          placeholder="Notion"
        />
      </Labeled>

      <Labeled label="What are you building?">
        <textarea
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          placeholder="An agent that reads and creates pages in a user's Notion workspace."
        />
      </Labeled>

      <button
        type="submit"
        className="w-full rounded-md bg-[color:var(--ink)] px-4 py-2.5 text-sm font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
      >
        Generate guide
      </button>
    </form>
  );
}

function Labeled({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-neutral-800">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
      {children}
    </label>
  );
}
