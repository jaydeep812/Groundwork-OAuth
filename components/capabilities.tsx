import type { Capability, Finding, EvidenceRef } from "@/lib/schema/guide";
import { WhyWeKnow } from "@/components/why-we-know";

/**
 * "What can you build?" — the capabilities overview in the Overview tab.
 *
 * Shows the provider's evidence-backed capabilities in developer language, each
 * expandable for data/actions, required access, and limitations, with a direct
 * link to the official API reference. It deliberately models the three distinct
 * concepts the spec calls for and never conflates them:
 *   1. Provider capability — what the API supports (this list).
 *   2. Application permissions — scopes/permissions you must request
 *      (`requiredAccess`, which points at the Technical tab's scope detail).
 *   3. Effective user access — what a consented connection actually reaches,
 *      which depends on consent, resource selection, and plan/account limits
 *      (the standing caveat below).
 * It never implies an operation is available just because the API exposes it.
 */
export function Capabilities({
  capabilities,
  findings,
  evidenceById,
  useCase,
}: {
  capabilities: Capability[];
  findings: Finding[];
  evidenceById: Map<string, EvidenceRef>;
  useCase?: string;
}) {
  if (capabilities.length === 0) return null;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-[1.5rem] font-semibold tracking-tight text-[color:var(--ink)]">
          What can you build?
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-[color:var(--slate)]">
          {useCase
            ? "Most relevant to your use case. Request only the access each needs."
            : "Request only the access each capability needs."}
        </p>
      </div>

      {/* An editorial list with a left rule — the Overview's focal content, set
          apart from the card stacks elsewhere. Each capability is a row keyed by
          its title, expandable in place. */}
      <ul className="space-y-0 border-l border-[color:var(--rule)]">
        {capabilities.map((c, i) => (
          <CapabilityRow key={i} cap={c} findings={findings} evidenceById={evidenceById} />
        ))}
      </ul>

      {/* The capability ≠ access honesty note — provider support is not the same
          as what a given connection can actually reach. */}
      <p className="text-[13px] leading-relaxed text-[color:var(--slate)]">
        What the API <em>supports</em>. Actual access also depends on the scopes you request (
        <a href="#technical" className="text-[color:var(--ink)] underline underline-offset-2 hover:text-[color:var(--verified)]">
          Technical
        </a>
        ), user consent, and account limits.
      </p>
    </section>
  );
}

function CapabilityRow({
  cap,
  findings,
  evidenceById,
}: {
  cap: Capability;
  findings: Finding[];
  evidenceById: Map<string, EvidenceRef>;
}) {
  const hasDetail =
    Boolean(cap.dataAndActions) ||
    cap.requiredAccess.length > 0 ||
    Boolean(cap.limitations) ||
    Boolean(cap.docUrl) ||
    (cap.findingIds?.length ?? 0) > 0 ||
    cap.evidenceIds.length > 0;

  return (
    <li className="border-b border-[color:var(--rule)] last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-baseline gap-3 py-3.5 pl-4 pr-1 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="text-[1.0625rem] font-medium text-[color:var(--ink)]">{cap.title}</span>
            {cap.summary && (
              <span className="mt-1 block text-[14px] leading-relaxed text-[color:var(--slate)]">
                {cap.summary}
              </span>
            )}
          </span>
          {hasDetail && (
            <span className="shrink-0 text-[13px] text-[color:var(--faint)] transition-transform group-open:rotate-180">
              ▾
            </span>
          )}
        </summary>

        {hasDetail && (
          <div className="space-y-3 pb-4 pl-4 pr-1 text-[14px]">
            {cap.dataAndActions && (
              <DetailRow label="Data & actions">{cap.dataAndActions}</DetailRow>
            )}
            {cap.requiredAccess.length > 0 && (
              <DetailRow label="Required access">
                <span className="flex flex-wrap gap-1.5">
                  {cap.requiredAccess.map((s) => (
                    <code
                      key={s}
                      className="rounded bg-[color:var(--paper-raised)] px-1.5 py-0.5 font-mono text-[12px] text-[color:var(--ink)]"
                    >
                      {s}
                    </code>
                  ))}
                </span>
              </DetailRow>
            )}
            {cap.limitations && (
              <DetailRow label="Limitations">
                <span className="text-[color:var(--open)]">{cap.limitations}</span>
              </DetailRow>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              {cap.docUrl && (
                <a
                  href={cap.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-[color:var(--slate)] underline underline-offset-2 hover:text-[color:var(--ink)]"
                >
                  Open API reference
                </a>
              )}
              <EvidenceLinks ids={cap.evidenceIds} map={evidenceById} />
              {cap.findingIds && cap.findingIds.length > 0 && (
                <WhyWeKnow findings={findings} findingIds={cap.findingIds} />
              )}
            </div>
          </div>
        )}
      </details>
    </li>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-3">
      <span className="text-[13px] text-[color:var(--faint)]">{label}</span>
      <span className="text-[color:var(--slate)]">{children}</span>
    </div>
  );
}

function EvidenceLinks({
  ids,
  map,
}: {
  ids: string[];
  map: Map<string, EvidenceRef>;
}) {
  const refs = ids.map((id) => map.get(id)).filter((e): e is EvidenceRef => Boolean(e));
  if (refs.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((e) => (
        <a
          key={e.id}
          href={e.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-[color:var(--slate)] underline underline-offset-2 hover:text-[color:var(--ink)]"
          title={e.title}
        >
          source
        </a>
      ))}
    </span>
  );
}
