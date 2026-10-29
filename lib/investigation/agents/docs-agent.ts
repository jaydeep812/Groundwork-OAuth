import { getProbe, stripHtml } from "@/lib/investigation/safe-fetch";
import type { Finding } from "@/lib/schema/guide";
import { hostIsOnDomain } from "@/lib/search/classify";
import type { AgentContext } from "@/lib/investigation/agents/_shared";
import { excerpt, makeFinding } from "@/lib/investigation/agents/_shared";

/**
 * Reads up to 3 authoritative docs pages (host on the provider's domain)
 * and emits one Finding per successful fetch, capturing an excerpt that
 * the synthesizer can quote. If no authoritative URL was in the evidence,
 * emits a single "insufficient" Finding — honest about what wasn't done.
 */
export async function docsAgent(ctx: AgentContext): Promise<Finding[]> {
  const candidates = ctx.tavily.filter((r) => {
    try {
      const host = new URL(r.url).hostname;
      return ctx.providerDomains.some((d) => hostIsOnDomain(host, d));
    } catch {
      return false;
    }
  });

  if (candidates.length === 0) {
    return [
      makeFinding({
        agent: "docs-agent",
        question: `Can we fetch authoritative documentation for ${ctx.providerName}?`,
        attempted:
          "Filtered the retrieved evidence for URLs on the provider's own domain(s).",
        attemptKind: "docs-read",
        outcome: "insufficient",
        conclusion:
          "No authoritative docs URL was present in the retrieved evidence; the pipeline could not fetch and quote provider-authored content directly.",
        observation: "",
        evidence: [],
        uncertainty:
          "What the provider itself says about this integration — authoritative pages were not surfaced by the search queries.",
      }),
    ];
  }

  const top = candidates.slice(0, 3);
  const findings: Finding[] = [];
  await Promise.all(
    top.map(async (c) => {
      const probe = await getProbe(c.url);
      if (!probe.ok || !probe.body) {
        findings.push(
          makeFinding({
            agent: "docs-agent",
            question: `What does ${c.url} say?`,
            attempted: `Fetched ${c.url} directly.`,
            attemptKind: "docs-read",
            outcome: "failed",
            conclusion: probe.error
              ? `Could not read page: ${probe.error}`
              : `Page returned HTTP ${probe.status}.`,
            observation: `status=${probe.status ?? "n/a"} error=${probe.error ?? "n/a"}`,
            evidence: [
              {
                id: `docs-${findings.length + 1}`,
                title: c.title,
                url: c.url,
                snippet: "",
                sourceType: c.sourceType,
              },
            ],
            uncertainty: "The content of this page could not be verified in-session.",
          }),
        );
        return;
      }
      const text = probe.contentType?.includes("html") ? stripHtml(probe.body) : probe.body;
      findings.push(
        makeFinding({
          agent: "docs-agent",
          question: `What does ${c.url} say about the ${ctx.providerName} setup flow?`,
          attempted: `Fetched ${c.url} directly (HTTP GET), stripped HTML, extracted the first ~800 chars.`,
          attemptKind: "docs-read",
          outcome: "confirmed",
          conclusion: `Page is live and served from an authoritative host. Excerpt follows in observation.`,
          observation: excerpt(text, 800),
          evidence: [
            {
              id: `docs-${findings.length + 1}`,
              title: c.title,
              url: probe.finalUrl ?? c.url,
              snippet: excerpt(text, 300),
              sourceType: c.sourceType,
            },
          ],
          uncertainty: "",
        }),
      );
    }),
  );
  return findings;
}
