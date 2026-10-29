import { headProbe } from "@/lib/investigation/safe-fetch";
import type { Finding } from "@/lib/schema/guide";
import { hostIsOnDomain } from "@/lib/search/classify";
import type { AgentContext } from "@/lib/investigation/agents/_shared";
import { makeFinding } from "@/lib/investigation/agents/_shared";

/**
 * Identifies candidate developer-portal URLs from the Tavily evidence and
 * HEAD-probes the top one to confirm it's live. Candidates are URLs on a
 * subdomain like developers.<provider> or dashboards/console URLs on the
 * provider's own domain.
 */
export async function portalAgent(ctx: AgentContext): Promise<Finding[]> {
  const DEVELOPER_HOST_RE = /^(developers?|dev|dashboard|console|portal|admin)\./;

  const candidates = ctx.tavily
    .filter((r) => {
      try {
        const u = new URL(r.url);
        const host = u.hostname.toLowerCase();
        const onProvider = ctx.providerDomains.some((d) => hostIsOnDomain(host, d));
        if (!onProvider) return false;
        return DEVELOPER_HOST_RE.test(host.replace(/^www\./, ""));
      } catch {
        return false;
      }
    })
    // Prefer short paths — a login/landing page over a deep article.
    .sort((a, b) => {
      try {
        return new URL(a.url).pathname.length - new URL(b.url).pathname.length;
      } catch {
        return 0;
      }
    });

  if (candidates.length === 0) {
    return [
      makeFinding({
        agent: "portal-agent",
        question: `Where do developers register an OAuth app for ${ctx.providerName}?`,
        attempted:
          "Searched the retrieved evidence for URLs under developers./dev./dashboard./console. on the provider's domain.",
        attemptKind: "static-reasoning",
        outcome: "insufficient",
        conclusion:
          "No developer-portal URL on the provider's own domain was retrieved — the developer-facing registration page could not be confirmed to exist via a live probe.",
        observation: "",
        evidence: [],
        uncertainty:
          "The exact URL where a developer registers an app. The main docs pages often link to it, but no such URL was surfaced by the search queries.",
      }),
    ];
  }

  const best = candidates[0];
  const probe = await headProbe(best.url);
  const findings: Finding[] = [];
  if (probe.ok || (probe.status && probe.status >= 200 && probe.status < 400)) {
    findings.push(
      makeFinding({
        agent: "portal-agent",
        question: `Is the ${ctx.providerName} developer portal URL live and reachable?`,
        attempted: `HEAD ${best.url}`,
        attemptKind: "url-probe",
        outcome: "confirmed",
        conclusion: `Developer portal reachable — HTTP ${probe.status} from ${
          probe.finalUrl ?? best.url
        }. Developers should go here to register an app.`,
        observation: `status=${probe.status} contentType=${probe.contentType ?? "n/a"} finalUrl=${
          probe.finalUrl ?? best.url
        }`,
        evidence: [
          {
            id: "portal-1",
            title: best.title,
            url: probe.finalUrl ?? best.url,
            snippet: "",
            sourceType: best.sourceType,
          },
        ],
        uncertainty: "",
      }),
    );
  } else {
    findings.push(
      makeFinding({
        agent: "portal-agent",
        question: `Is the ${ctx.providerName} developer portal URL live and reachable?`,
        attempted: `HEAD ${best.url}`,
        attemptKind: "url-probe",
        outcome: "failed",
        conclusion: probe.error
          ? `Candidate portal URL did not respond cleanly: ${probe.error}`
          : `Candidate portal URL returned HTTP ${probe.status}.`,
        observation: `status=${probe.status ?? "n/a"} error=${probe.error ?? "n/a"}`,
        evidence: [
          {
            id: "portal-1",
            title: best.title,
            url: best.url,
            snippet: "",
            sourceType: best.sourceType,
          },
        ],
        uncertainty: "Whether the developer-portal URL has moved or is temporarily down.",
      }),
    );
  }
  return findings;
}
