import { listGuides } from "@/lib/db/guides";
import { FindGuide } from "./find-guide";

export const dynamic = "force-dynamic"; // always read the latest guides from SQLite

export default async function HomePage() {
  const guides = await listGuides();

  return (
    <div className="space-y-12">
      {/* Hero + the single search-to-guide interaction. A soft sage wash (see
          .hero-wash in globals.css) sits behind the headline, description, and
          search, fading into the paper before the Library grid below. */}
      <section className="hero-wash pt-10 sm:pt-16">
        <div className="mb-8 max-w-[40rem] space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--verified-soft)] px-2.5 py-1 text-[length:var(--text-secondary)] font-medium text-[color:var(--verified)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[color:var(--verified)]" />
            Evidence-backed
          </span>
          <h1 className="text-[length:var(--text-title)] font-semibold leading-[1.08] tracking-[-0.02em] text-[color:var(--ink)]">
            Get your OAuth integration ready.
          </h1>
          <p className="text-[length:var(--text-card)] leading-relaxed text-[color:var(--slate)]">
            Look up any provider for a setup guide — effort, approval steps, endpoints, scopes, and
            code — with a source behind every claim.
          </p>
        </div>
        <FindGuide guides={guides} />
      </section>

      {guides.length === 0 && <EmptyLibrary />}
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="rounded-lg border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-8">
      <p className="text-[length:var(--text-card)] font-semibold text-[color:var(--ink)]">
        No guides yet.
      </p>
      <p className="mt-2 text-[length:var(--text-body)] leading-relaxed text-[color:var(--slate)]">
        Search for a provider above to generate the first guide, or run{" "}
        <code className="rounded bg-[color:var(--paper)] px-1.5 py-0.5 text-[length:var(--text-secondary)]">
          npm run seed
        </code>{" "}
        to load the curated set.
      </p>
    </div>
  );
}
