import { getProbe, stripHtml, headProbe } from "@/lib/investigation/safe-fetch";
import type { Finding } from "@/lib/schema/guide";
import { slugify } from "@/lib/util/text";
import type { AgentContext } from "@/lib/investigation/agents/_shared";
import { excerpt, makeFinding } from "@/lib/investigation/agents/_shared";

/**
 * Tries each plausible Composio toolkit URL *by direct HTTP* (not search) and
 * reports what it found. Composio's catalog has a predictable URL shape:
 *   https://composio.dev/toolkits/<slug>
 *   https://docs.composio.dev/toolkits/<slug>
 * so we can resolve "supported?" without relying on search engine coverage.
 */
export async function catalogAgent(ctx: AgentContext): Promise<Finding[]> {
  // Produce a few candidate slugs: the raw name, split tokens, each individual
  // non-trivial token. "Kite Connect (Zerodha)" → kite-connect-zerodha, kite,
  // zerodha, kite-connect.
  const base = slugify(ctx.providerName);
  const tokens = ctx.providerName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const candidates = Array.from(
    new Set<string>([base, ...tokens, tokens.slice(0, 2).join("-")].filter(Boolean)),
  );

  const urls = candidates.flatMap((s) => [
    `https://composio.dev/toolkits/${s}`,
    `https://docs.composio.dev/toolkits/${s}`,
  ]);

  // Head-check all; keep those that resolve 2xx.
  const probes = await Promise.all(urls.map((u) => headProbe(u)));
  const live = probes.filter((p) => p.ok && (p.status ?? 0) >= 200 && (p.status ?? 0) < 300);

  if (live.length === 0) {
    return [
      makeFinding({
        agent: "catalog-agent",
        question: `Does Composio ship a managed-auth toolkit for ${ctx.providerName}?`,
        attempted: `HEAD-probed ${urls.length} candidate Composio toolkit URLs: ${urls
          .slice(0, 4)
          .join(", ")}${urls.length > 4 ? ", …" : ""}`,
        attemptKind: "catalog-check",
        outcome: "insufficient",
        conclusion:
          "No Composio toolkit page resolved cleanly for any plausible slug of this provider. This is NOT proof of unsupported — Composio's catalog slug may differ. A developer should check the catalog manually.",
        observation: `probed=${urls.length} live=0`,
        evidence: [],
        uncertainty:
          "Whether Composio Managed Auth covers this provider under a different slug.",
      }),
    ];
  }

  // GET the first live page to pull a confirming excerpt.
  const bestUrl = live[0].finalUrl ?? live[0].url;
  const body = await getProbe(bestUrl);
  const text = body.body ? stripHtml(body.body) : "";
  // Confirm the page actually mentions the provider — Composio's catalog may
  // 200 for arbitrary slugs with a generic "not found" HTML body.
  const nameKey = ctx.providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bodyKey = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mentions = tokens.some((t) => bodyKey.includes(t)) || bodyKey.includes(nameKey);

  if (!mentions) {
    return [
      makeFinding({
        agent: "catalog-agent",
        question: `Does Composio ship a managed-auth toolkit for ${ctx.providerName}?`,
        attempted: `HEAD-probed candidate URLs; GET on ${bestUrl} returned 200 but the page did not mention the provider by name.`,
        attemptKind: "catalog-check",
        outcome: "insufficient",
        conclusion:
          "A candidate catalog URL loaded, but the page content does not reference the provider. Likely a generic page (e.g. 404 served with 200) rather than confirmation of coverage.",
        observation: `status=${body.status} finalUrl=${bestUrl} excerpt=${excerpt(text, 200)}`,
        evidence: [],
        uncertainty: "Whether Composio supports this provider under a different name/slug.",
      }),
    ];
  }

  return [
    makeFinding({
      agent: "catalog-agent",
      question: `Does Composio ship a managed-auth toolkit for ${ctx.providerName}?`,
      attempted: `HEAD-probed ${urls.length} Composio toolkit URLs. First live one: ${bestUrl}. GET fetched the page and verified it mentions the provider by name.`,
      attemptKind: "catalog-check",
      outcome: "confirmed",
      conclusion: `Composio Managed Auth exposes a toolkit for ${ctx.providerName} at ${bestUrl}. Recommended path: managed-auth.`,
      observation: `status=${body.status} finalUrl=${bestUrl} excerpt=${excerpt(text, 400)}`,
      evidence: [
        {
          id: "catalog-1",
          title: `Composio toolkit page: ${ctx.providerName}`,
          url: bestUrl,
          snippet: excerpt(text, 300),
          sourceType: "composio-docs",
        },
      ],
      uncertainty: "",
    }),
  ];
}
