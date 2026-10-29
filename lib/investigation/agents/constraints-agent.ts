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
  const topics: Array<{ key: string; query: string; question: string }> = [
    {
      key: "pricing",
      query: `${ctx.providerName} API pricing OR subscription OR free tier`,
      question: `Is there a cost to use the ${ctx.providerName} API?`,
    },
    {
      key: "approval",
      query: `${ctx.providerName} OAuth app approval OR verification process`,
      question: `Is an approval or verification process required before launch?`,
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
        // Filter to results that are plausibly authoritative for this provider.
        const authoritative = results
          .map((r) => ({ ...r, sourceType: classifySource(r.url, ctx.providerDomains) }))
          .filter((r) => {
            try {
              return ctx.providerDomains.some((d) =>
                hostIsOnDomain(new URL(r.url).hostname, d),
              );
            } catch {
              return false;
            }
          });

        if (authoritative.length === 0) {
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

        const top = authoritative[0];
        findings.push(
          makeFinding({
            agent: "constraints-agent",
            question: t.question,
            attempted: `Tavily search: "${t.query}". Top authoritative hit: ${top.url}`,
            attemptKind: "search",
            outcome: "supports",
            conclusion: excerpt(top.content, 220) || `See source: ${top.title}`,
            observation: `authoritativeCount=${authoritative.length} top=${top.url}`,
            evidence: authoritative.slice(0, 3).map((r, i) => ({
              id: `constraint-${t.key}-${i + 1}`,
              title: r.title,
              url: r.url,
              snippet: excerpt(r.content, 200),
              sourceType: r.sourceType,
            })),
            uncertainty: "",
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
