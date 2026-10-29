import Link from "next/link";
import { notFound } from "next/navigation";
import { getGuideBySlug } from "@/lib/db/guides";
import type { Guide } from "@/lib/schema/guide";
import {
  Badge,
  ClaimKindBadge,
  DifficultyBadge,
  PathBadge,
  SourceBadge,
  formatEstimate,
} from "@/components/ui/badges";
import { AuditLog, WhyWeKnow } from "@/components/why-we-know";
import { ImplementationPack } from "@/components/implementation-pack";
import { AgentPromptCard } from "@/components/agent-prompt-card";
import { ManagedAuthCallout } from "@/components/managed-auth-callout";
import { OAuthJourney } from "@/components/oauth-journey";
import { Capabilities } from "@/components/capabilities";
import { GuideTabs } from "@/components/guide-tabs";
import { Linkify } from "@/components/ui/linkify";
import { findToolkitUrl } from "@/lib/guide/backfill";
import { CopyShareButton } from "./share-button";
import { GuideSteps } from "./guide-steps";

export const dynamic = "force-dynamic";

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuideBySlug(slug);
  if (!guide) notFound();

  const evidenceById = new Map(guide.evidence.map((e) => [e.id, e]));
  // Surface the single most-impactful blocker (if any) in the hero summary.
  const mainBlocker = guide.knownBlockers[0] ?? null;
  // Composio managed-auth is supplementary metadata: if a verified toolkit URL
  // is present in the evidence, we show a small optional shortcut. It never
  // changes the guide's content, which is always the full custom OAuth guide.
  const composioToolkitUrl = findToolkitUrl(guide.evidence);

  // The guide reads as four tabs sharing one persistent header. Each panel's
  // content is rendered server-side here and handed to the client tab shell,
  // which keeps every panel mounted so setup-checklist progress and open
  // <details> survive tab switches. Blockers stay visible in Overview even
  // though their full detail lives in Setup (spec requirement).
  return (
    <article className="space-y-8">
      <Header guide={guide} />
      <GuideTabs
        overview={
          <OverviewPanel
            guide={guide}
            mainBlocker={mainBlocker}
            composioToolkitUrl={composioToolkitUrl}
            evidenceById={evidenceById}
          />
        }
        setup={<SetupPanel guide={guide} evidenceById={evidenceById} />}
        technical={<TechnicalPanel guide={guide} />}
        evidence={<EvidencePanel guide={guide} />}
      />
    </article>
  );
}

/**
 * OVERVIEW — understand the integration and decide whether to proceed: the
 * decision + effort/waiting/blocker facts, a concise "What can you build?"
 * capabilities preview, and the primary Start-setup action. The optional
 * managed-auth shortcut lives here too (supplementary).
 */
function OverviewPanel({
  guide,
  mainBlocker,
  composioToolkitUrl,
  evidenceById,
}: {
  guide: Guide;
  mainBlocker: Guide["knownBlockers"][number] | null;
  composioToolkitUrl: string | null;
  evidenceById: Map<string, Guide["evidence"][number]>;
}) {
  return (
    <>
      <HeroSummary guide={guide} mainBlocker={mainBlocker} />
      {composioToolkitUrl && (
        <ManagedAuthCallout providerName={guide.providerName} toolkitUrl={composioToolkitUrl} />
      )}
      {guide.capabilities.length > 0 && (
        <Capabilities
          capabilities={guide.capabilities}
          findings={guide.findings}
          evidenceById={evidenceById}
          useCase={guide.useCase}
        />
      )}
    </>
  );
}

/**
 * SETUP — follow the OAuth registration + implementation process. The coding-
 * agent handoff sits at the top, then the one canonical ordered checklist, the
 * agent/human split, approval requirements, and blocker detail.
 */
function SetupPanel({
  guide,
  evidenceById,
}: {
  guide: Guide;
  evidenceById: Map<string, Guide["evidence"][number]>;
}) {
  return (
    <>
      <section id="setup" className="space-y-5 scroll-mt-6">
        {guide.agentPrompt && (
          <AgentPromptCard prompt={guide.agentPrompt} providerName={guide.providerName} />
        )}

        {guide.prerequisites.length > 0 && (
          <Section title="Prerequisites">
            <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
              {guide.prerequisites.map((p) => (
                <li key={p.id}>
                  {p.description}
                  <EvidenceLinks ids={p.evidenceIds} map={evidenceById} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {guide.setupSteps.length > 0 ? (
          <GuideSteps guide={guide} />
        ) : (
          <p className="rounded-md border border-[color:var(--rule)] bg-[color:var(--paper-raised)] px-4 py-3 text-sm text-[color:var(--slate)]">
            No setup steps were established for this provider yet. Use the Technical tab and the
            provider&apos;s own docs to proceed.
          </p>
        )}
      </section>

      {/* Agent-vs-human split — only when there's content. */}
      {(guide.agentCapabilities.length > 0 || guide.humanHandoff.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {guide.agentCapabilities.length > 0 && (
            <Section title="What an agent can help with">
              <List items={guide.agentCapabilities} />
            </Section>
          )}
          {guide.humanHandoff.length > 0 && (
            <Section title="What needs a human">
              <List items={guide.humanHandoff} />
            </Section>
          )}
        </div>
      )}

      {guide.approvalRequirements.length > 0 && (
        <Section title="Approval & production requirements">
          <div className="space-y-3">
            {guide.approvalRequirements.map((a) => (
              <div key={a.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-900">{a.title}</span>
                  {a.required ? <Badge tone="red">required</Badge> : <Badge tone="neutral">conditional</Badge>}
                  {a.timeline && <ClaimKindBadge kind={a.timeline.kind} />}
                </div>
                <p className="mt-1 text-sm text-neutral-700">{a.description}</p>
                {a.timeline && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Timeline: {formatEstimate(a.timeline)} — {a.timeline.rationale}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  <EvidenceLinks ids={a.evidenceIds} map={evidenceById} />
                  {a.findingIds && a.findingIds.length > 0 && (
                    <WhyWeKnow findings={guide.findings} findingIds={a.findingIds} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {guide.knownBlockers.length > 0 && (
        <Section title="Known blockers">
          <div className="space-y-3">
            {guide.knownBlockers.map((b) => (
              <div key={b.id} className="rounded-md border-l-2 border-[color:var(--alert)] bg-[color:var(--alert-soft)] px-4 py-3">
                <div className="font-medium text-[color:var(--alert)]">{b.title}</div>
                <p className="mt-1 text-sm text-[color:var(--ink)]">{b.description}</p>
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  <EvidenceLinks ids={b.evidenceIds} map={evidenceById} />
                  {b.findingIds && b.findingIds.length > 0 && (
                    <WhyWeKnow findings={guide.findings} findingIds={b.findingIds} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/**
 * TECHNICAL — implementation details for developers who need them, without
 * crowding the main setup path. The implementation pack (endpoints, flows,
 * scopes, redirect rule, PKCE, token lifecycle, rate limits) plus the
 * deterministic OAuth code walkthrough. Confirmed/estimate/unknown are
 * visually distinguished within each.
 */
function TechnicalPanel({ guide }: { guide: Guide }) {
  const hasJourney =
    guide.journey.length > 0 &&
    Boolean(guide.implementation?.authorizeUrl || guide.implementation?.tokenUrl);

  if (!guide.implementation && !hasJourney) {
    return (
      <p className="rounded-md border border-[color:var(--rule)] bg-[color:var(--paper-raised)] px-4 py-3 text-sm text-[color:var(--slate)]">
        No technical OAuth facts established yet. See the Evidence tab for what the research
        covered.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {guide.implementation && (
        <ImplementationPack implementation={guide.implementation} findings={guide.findings} />
      )}
      {hasJourney && (
        <OAuthJourney
          steps={guide.journey}
          title="Implementation walkthrough"
          subtitle="The code behind the setup checklist — the OAuth flow with real values for this provider."
        />
      )}
    </div>
  );
}

/**
 * EVIDENCE — verify the guidance and understand its limits: open questions,
 * the sources consulted (trust-tiered), and the investigation trace. Source
 * excerpts and the raw audit log stay behind expandable disclosure.
 */
function EvidencePanel({ guide }: { guide: Guide }) {
  const hasAny =
    guide.evidence.length > 0 || guide.uncertainties.length > 0 || guide.findings.length > 0;
  if (!hasAny) {
    return (
      <p className="rounded-md border border-[color:var(--rule)] bg-[color:var(--paper-raised)] px-4 py-3 text-sm text-[color:var(--slate)]">
        No sources or investigation trace were recorded for this guide.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {guide.uncertainties.length > 0 && (
        <Section title="Open questions & uncertainty" level="muted">
          <div className="space-y-2">
            {guide.uncertainties.map((u) => (
              <div key={u.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <ClaimKindBadge kind={u.kind} />
                  <span className="text-sm font-medium text-neutral-800">{u.question}</span>
                </div>
                {u.resolution && (
                  <p className="mt-1 text-sm text-neutral-600">How to resolve: {u.resolution}</p>
                )}
                {u.findingIds && u.findingIds.length > 0 && (
                  <div className="mt-2">
                    <WhyWeKnow findings={guide.findings} findingIds={u.findingIds} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Sources" level="muted">
        {guide.evidence.length === 0 ? (
          <p className="text-sm text-neutral-500">No sources recorded.</p>
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              Green = provider&apos;s own domain. Amber = third-party platforms (context, not the
              final word).
            </p>
            <ul className="space-y-2">
              {guide.evidence.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <SourceBadge sourceType={e.sourceType} />
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-700 underline underline-offset-2 hover:text-indigo-500"
                  >
                    {e.title}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {guide.findings.length > 0 && <AuditLog findings={guide.findings} />}
    </div>
  );
}

function Header({ guide }: { guide: Guide }) {
  const isSearchUrl = guide.providerUrl.startsWith("https://www.google.com/search");
  return (
    <header className="space-y-4 border-b border-[color:var(--rule)] pb-7">
      <Link
        href="/"
        className="text-[14px] text-[color:var(--slate)] underline decoration-[color:var(--rule-strong)] underline-offset-4 hover:text-[color:var(--ink)]"
      >
        Back to library
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-[2.4rem] font-semibold leading-none tracking-tight text-[color:var(--ink)]">
            {guide.providerName}
          </h1>
          {isSearchUrl ? (
            <p className="text-[14px] text-[color:var(--faint)]">
              Provider website not established from the evidence —{" "}
              <a
                href={guide.providerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--verified)] underline underline-offset-2"
              >
                search the web
              </a>
              .
            </p>
          ) : (
            <a
              href={guide.providerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] text-[color:var(--verified)] underline underline-offset-2"
            >
              {guide.providerUrl}
            </a>
          )}
        </div>
        <CopyShareButton />
      </div>
      <p className="max-w-[46rem] text-[1.0625rem] leading-relaxed text-[color:var(--slate)]">
        {guide.description}
      </p>
      <div className="flex flex-wrap gap-2">
        <PathBadge path={guide.recommendedPath} />
        <DifficultyBadge rating={guide.difficulty.rating} />
        <Badge tone="neutral">
          Last researched {new Date(guide.lastResearchedAt).toLocaleDateString()}
        </Badge>
      </div>
    </header>
  );
}

function HeroSummary({
  guide,
  mainBlocker,
}: {
  guide: Guide;
  mainBlocker: Guide["knownBlockers"][number] | null;
}) {
  return (
    <section className="space-y-6">
      {/* The decision card — the focal point. The verdict as a sentence. */}
      <div className="rounded-lg border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-7">
        <p className="text-[13px] text-[color:var(--faint)]">Recommended path</p>
        <span className="mt-1.5 block text-[1.9rem] font-semibold leading-tight tracking-tight text-[color:var(--ink)]">
          {pathTitle(guide.recommendedPath)}
        </span>
        <p className="mt-3 max-w-[44rem] text-[1.0625rem] leading-relaxed text-[color:var(--slate)]">
          <Linkify text={guide.pathRationale} />
        </p>
      </div>

      {/* Facts as a definition list — not three identical stat cards. */}
      <dl className="divide-y divide-[color:var(--rule)] border-y border-[color:var(--rule)]">
        <FactRow
          term="What this takes"
          value={formatEstimate(guide.activeEffort)}
          detail={guide.activeEffort.rationale}
          findings={guide.findings}
          findingIds={guide.activeEffort.findingIds ?? []}
        />
        <FactRow
          term="Waiting on the provider"
          value={formatEstimate(guide.externalWaiting)}
          detail={guide.externalWaiting.rationale}
          findings={guide.findings}
          findingIds={guide.externalWaiting.findingIds ?? []}
        />
        <FactRow
          term="Watch out for"
          value={
            mainBlocker
              ? mainBlocker.title
              : guide.blockerAssessment === "assessed-none-found"
                ? "Nothing launch-blocking"
                : "Blockers not fully assessed"
          }
          detail={
            mainBlocker
              ? mainBlocker.description
              : guide.blockerAssessment === "assessed-none-found"
                ? "None found after assessment."
                : "Not fully assessed — verify in the provider's docs before launch."
          }
          tone={mainBlocker ? "alert" : guide.blockerAssessment === "assessed-none-found" ? "default" : "alert"}
          findings={guide.findings}
          findingIds={mainBlocker?.findingIds ?? []}
        />
      </dl>

      {guide.nextAction && (
        <div className="rounded-md border-l-2 border-[color:var(--verified)] bg-[color:var(--verified-soft)] px-4 py-3">
          <p className="text-[13px] text-[color:var(--verified)]">Start here</p>
          <p className="mt-1 text-[15px] leading-relaxed text-[color:var(--ink)]">
            <Linkify text={guide.nextAction} />
          </p>
        </div>
      )}

      {/* Primary action — jumps to the setup checklist. */}
      <div>
        <a
          href="#setup"
          className="inline-flex items-center rounded-md bg-[color:var(--ink)] px-5 py-2.5 text-[15px] font-medium text-[color:var(--paper)] transition-colors hover:bg-black"
        >
          Start setup →
        </a>
      </div>
    </section>
  );
}

function FactRow({
  term,
  value,
  detail,
  tone = "default",
  findings,
  findingIds,
}: {
  term: string;
  value: string;
  detail: string;
  tone?: "default" | "alert";
  findings: Guide["findings"];
  findingIds: string[];
}) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-x-6 gap-y-1 py-3.5 sm:grid-cols-[13rem_1fr]">
      <dt className="text-[14px] text-[color:var(--faint)]">{term}</dt>
      <dd
        className={`text-[15px] font-medium ${
          tone === "alert" ? "text-[color:var(--alert)]" : "text-[color:var(--ink)]"
        }`}
      >
        {value}
      </dd>
      {(detail || findingIds.length > 0) && (
        <dd className="col-start-2 space-y-1.5">
          {detail && <p className="text-[14px] leading-relaxed text-[color:var(--slate)]">{detail}</p>}
          {findingIds.length > 0 && <WhyWeKnow findings={findings} findingIds={findingIds} />}
        </dd>
      )}
    </div>
  );
}

function pathTitle(path: Guide["recommendedPath"]): string {
  return path === "managed-auth"
    ? "Composio Managed Auth"
    : path === "custom-oauth"
      ? "Custom OAuth app"
      : "Custom integration";
}

function Section({
  title,
  level = "secondary",
  children,
}: {
  title: string;
  /** primary = core actionable content; secondary = default; muted = trust/reference. */
  level?: "primary" | "secondary" | "muted";
  children: React.ReactNode;
}) {
  if (level === "primary") {
    return (
      <section className="space-y-4">
        <h2 className="text-[1.5rem] font-semibold tracking-tight text-[color:var(--ink)]">
          {title}
        </h2>
        {children}
      </section>
    );
  }
  if (level === "muted") {
    return (
      <section className="space-y-3">
        <h2 className="text-[1.05rem] font-medium text-[color:var(--slate)]">{title}</h2>
        {children}
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="border-b border-[color:var(--rule)] pb-2 text-[1.3rem] font-semibold tracking-tight text-[color:var(--ink)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function EvidenceLinks({
  ids,
  map,
}: {
  ids: string[];
  map: Map<string, Guide["evidence"][number]>;
}) {
  const refs = ids.map((id) => map.get(id)).filter((e): e is Guide["evidence"][number] => Boolean(e));
  if (refs.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {refs.map((e) => (
        <a
          key={e.id}
          href={e.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-600 underline"
          title={e.title}
        >
          [source]
        </a>
      ))}
    </span>
  );
}
