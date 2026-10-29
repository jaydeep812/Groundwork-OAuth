import { tavilySearch } from "@/lib/search/tavily";
import type { Finding } from "@/lib/schema/guide";
import { classifySource, hostIsOnDomain } from "@/lib/search/classify";
import type { AgentContext } from "@/lib/investigation/agents/_shared";
import { excerpt, makeFinding } from "@/lib/investigation/agents/_shared";

/**
 * Runs a small set of focused searches aimed at the "operational constraints"
 * a developer must know before starting: pricing/subscription, approval or
 * verification, rate limits, token lifetime, mandatory 2FA/TOTP, regulatory
 * requirements.
 *
 * Produces one Finding per topic. If the search returns no authoritative
 * source for a topic, the Finding is "insufficient" — never a guess.
 */
export async function constraintsAgent(ctx: AgentContext): Promise<Finding[]> {
  // Topics tagged `offDomainOk` are those whose evidence genuinely lives OFF the
  // provider's own domain — approval turnaround times are discussed in community
  // forums (Stack Overflow, Reddit, dev blogs), rarely published by the provider.
  // For those we admit community/third-party sources but the synthesis layer
  // marks any resulting figure as an estimate/inference (never "verified"), so a
  // community-reported duration informs the guide without being laundered as
  // authoritative. All other topics keep the provider-domain-only rule.
  const topics: Array<{
    key: string;
    query: string;
    question: string;
    offDomainOk?: boolean;
  }> = [
    {
      key: "pricing",
      query: `${ctx.providerName} API pricing OR subscription OR free tier`,
      question: `Is there a cost to use the ${ctx.providerName} API?`,
    },
    {
      key: "approval",
      query: `${ctx.providerName} OAuth app approval OR verification process requirements`,
      question: `Is an approval or verification process required before launch?`,
    },
    {
      key: "approval-timeline",
      query: `${ctx.providerName} OAuth app verification approval how long review time days weeks`,
      question: `How long does the provider's approval/verification review take?`,
      offDomainOk: true,
    },
    {
      key: "token-lifetime",
      query: `${ctx.providerName} access token lifetime expiry refresh`,
      question: `How long do issued access tokens last?`,
    },
    {
      key: "rate-limits",
      query: `${ctx.providerName} API rate limits throttling quotas`,
      question: `What rate limits apply?`,
    },
  ];

  const findings: Finding[] = [];
  await Promise.all(
    topics.map(async (t) => {
      try {
        const results = await tavilySearch(t.query, { maxResults: 4 });
        const classified = results.map((r) => ({
          ...r,
          sourceType: classifySource(r.url, ctx.providerDomains),
        }));
        const onDomain = classified.filter((r) => {
          try {
            return ctx.providerDomains.some((d) => hostIsOnDomain(new URL(r.url).hostname, d));
          } catch {
            return false;
          }
        });

        // For most topics "authoritative" means on the provider's domain. For
        // off-domain-OK topics (approval timeline), fall back to the best
        // cross-tier results when nothing on-domain exists — community turnaround
        // reports are admissible here, flagged so synthesis treats them as an
        // estimate, not a verified fact.
        const usable = onDomain.length > 0 ? onDomain : t.offDomainOk ? classified : [];
        const fromCommunityOnly = onDomain.length === 0 && t.offDomainOk && classified.length > 0;

        if (usable.length === 0) {
          findings.push(
            makeFinding({
              agent: "constraints-agent",
              question: t.question,
              attempted: `Tavily search: "${t.query}". No results on the provider's own domain(s).`,
              attemptKind: "search",
              outcome: "insufficient",
              conclusion:
                "No authoritative source for this constraint was found. Treat as unknown rather than inferring from third-party content.",
              observation: `queryResults=${results.length} authoritative=0`,
              evidence: results.slice(0, 2).map((r, i) => ({
                id: `constraint-${t.key}-${i + 1}`,
                title: r.title,
                url: r.url,
                snippet: excerpt(r.content, 200),
                sourceType: classifySource(r.url, ctx.providerDomains),
              })),
              uncertainty: t.question,
            }),
          );
          return;
        }

        const top = usable[0];
        findings.push(
          makeFinding({
            agent: "constraints-agent",
            question: t.question,
            attempted: `Tavily search: "${t.query}". Top hit: ${top.url}`,
            attemptKind: "search",
            outcome: "supports",
            conclusion: excerpt(top.content, 220) || `See source: ${top.title}`,
            observation: `usableCount=${usable.length} onDomain=${onDomain.length} top=${top.url}`,
            evidence: usable.slice(0, 3).map((r, i) => ({
              id: `constraint-${t.key}-${i + 1}`,
              title: r.title,
              url: r.url,
              snippet: excerpt(r.content, 200),
              sourceType: r.sourceType,
            })),
            // When the only evidence is community/third-party, say so explicitly
            // so synthesis records any figure as an estimate, never as verified.
            uncertainty: fromCommunityOnly
              ? "Reported only by community/third-party sources, not the provider — treat any duration as a community-reported estimate, not a verified timeline."
              : "",
          }),
        );
      } catch (err) {
        findings.push(
          makeFinding({
            agent: "constraints-agent",
            question: t.question,
            attempted: `Tavily search: "${t.query}"`,
            attemptKind: "search",
            outcome: "failed",
            conclusion: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
            observation: "",
            evidence: [],
            uncertainty: t.question,
          }),
        );
      }
    }),
  );
  return findings;
}
