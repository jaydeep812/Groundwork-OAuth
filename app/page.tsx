import Link from "next/link";
import { listGuides } from "@/lib/db/guides";
import { LibrarySearch } from "./library-search";

export const dynamic = "force-dynamic"; // always read the latest guides from SQLite

export default function HomePage() {
  const guides = listGuides();

  return (
    <div className="space-y-20">
      {/* Hero: one bold claim, one quiet line, two actions. Nothing else. */}
      <section className="max-w-[40rem] space-y-7 pb-4 pt-12 sm:pt-20">
        <h1 className="text-[2.6rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[color:var(--ink)] sm:text-[3rem]">
          Every OAuth claim, traced to what we checked.
        </h1>
        <p className="max-w-[32rem] text-[1.0625rem] leading-relaxed text-[color:var(--slate)]">
          Setup guides for any OAuth provider — endpoints, scopes, and code, with a source behind
          every claim.
        </p>
        <div className="flex flex-wrap items-center gap-6 pt-2">
          <Link
            href="/investigate"
            className="rounded-lg bg-[color:var(--ink)] px-5 py-2.5 text-[15px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
          >
            Investigate a provider
          </Link>
          <Link
            href="#library"
            className="text-[15px] text-[color:var(--slate)] transition-colors hover:text-[color:var(--ink)]"
          >
            Browse the library
          </Link>
        </div>
      </section>

      <section id="library" className="space-y-6">
        <div className="flex items-baseline justify-between border-b border-[color:var(--rule)] pb-3">
          <h2 className="text-[1.5rem] font-semibold tracking-tight text-[color:var(--ink)]">
            Library
          </h2>
          <span className="text-[14px] text-[color:var(--faint)]">
            {guides.length} {guides.length === 1 ? "provider" : "providers"} researched
          </span>
        </div>
        {guides.length === 0 ? <EmptyLibrary /> : <LibrarySearch guides={guides} />}
      </section>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="rounded-lg border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-10">
      <p className="text-[1.15rem] font-semibold text-[color:var(--ink)]">No guides yet.</p>
      <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--slate)]">
        Run <code className="rounded bg-[color:var(--paper)] px-1.5 py-0.5 text-[13px]">npm run seed</code> to
        load the curated set, or{" "}
        <Link href="/investigate" className="text-[color:var(--verified)] underline underline-offset-2">
          investigate a provider
        </Link>{" "}
        to research a new one.
      </p>
    </div>
  );
}
