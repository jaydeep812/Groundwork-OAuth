import { getProbe, errorProbePost, stripHtml } from "@/lib/investigation/safe-fetch";
import type { Finding } from "@/lib/schema/guide";
import { hostIsOnDomain } from "@/lib/search/classify";
import type { AgentContext } from "@/lib/investigation/agents/_shared";
import { excerpt, makeFinding } from "@/lib/investigation/agents/_shared";

/**
 * Looks for OAuth-style endpoints in the retrieved evidence (URLs that
 * mention /oauth/, /authorize, /token, /session/token, /connect/login) on the
 * provider's own domain, probes them with BOGUS public params, and reports
 * the error contract. This is diagnostic — it never submits real credentials.
 *
 * The value: a developer sees that the endpoint exists, is reachable, and
 * what error shape it returns when the request is wrong. If no such endpoint
 * surfaces, the agent emits an "insufficient" finding — never a guess.
 */
export async function authEndpointAgent(ctx: AgentContext): Promise<Finding[]> {
  const AUTH_PATH_RE = /\/(oauth|authorize|authorise|token|session|connect\/login)/i;
  const candidates: { url: string; kind: "authorize-get" | "token-post" }[] = [];

  for (const r of ctx.tavily) {
    try {
      const u = new URL(r.url);
      if (!ctx.providerDomains.some((d) => hostIsOnDomain(u.hostname, d))) continue;
      if (!AUTH_PATH_RE.test(u.pathname)) continue;
      const kind = /token/.test(u.pathname) ? "token-post" : "authorize-get";
      candidates.push({ url: `${u.protocol}//${u.hostname}${u.pathname}`, kind });
    } catch {
      /* skip */
    }
  }
  // De-dup by URL.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
  if (unique.length === 0) {
    return [
      makeFinding({
        agent: "auth-endpoint-agent",
        question: `Can we observe the OAuth authorization/token endpoints behave as documented?`,
        attempted:
          "Scanned retrieved evidence for /oauth/, /authorize, /token, or /session/token paths on the provider's domain(s). None found.",
        attemptKind: "static-reasoning",
        outcome: "insufficient",
        conclusion:
          "No OAuth endpoint URL on the provider's own domain was in the retrieved evidence; the authorization/token contract could not be probed directly.",
        observation: "",
        evidence: [],
        uncertainty: "The exact request shape and error contract for the token exchange.",
      }),
    ];
  }

  const findings: Finding[] = [];
  // Prefer at most one authorize-GET and one token-POST probe.
  const authGet = unique.find((c) => c.kind === "authorize-get");
  const tokenPost = unique.find((c) => c.kind === "token-post");

  if (authGet) {
    const probe = await getProbe(authGet.url);
    const text = probe.contentType?.includes("html") ? stripHtml(probe.body) : probe.body;
    findings.push(
      makeFinding({
        agent: "auth-endpoint-agent",
        question: `Does the authorization URL ${authGet.url} serve something reasonable without credentials?`,
        attempted: `GET ${authGet.url} with no query params.`,
        attemptKind: "api-error-probe",
        outcome: probe.ok ? "confirmed" : "failed",
        conclusion: probe.ok
          ? `Endpoint reachable (HTTP ${probe.status}). Response excerpt in observation. A real integration must redirect the user here with the required query parameters.`
          : `Endpoint not reachable: ${probe.error ?? `HTTP ${probe.status}`}`,
        observation: probe.ok
          ? `status=${probe.status} excerpt=${excerpt(text, 400)}`
          : `status=${probe.status ?? "n/a"} error=${probe.error ?? "n/a"}`,
        evidence: [
          {
            id: "auth-1",
            title: "Authorization endpoint",
            url: probe.finalUrl ?? authGet.url,
            snippet: excerpt(text, 300),
            sourceType: "official-docs",
          },
        ],
        uncertainty: "",
      }),
    );
  }

  if (tokenPost) {
    // Send intentionally-missing params to inspect the error shape.
    // Note: NO real client secret or token. These are nonce values.
    const probe = await errorProbePost(tokenPost.url, {
      api_key: "nonexistent-public-probe-key",
      request_token: "nonexistent-public-probe-token",
      checksum: "nonexistent-public-probe-checksum",
    });
    const text = probe.contentType?.includes("html") ? stripHtml(probe.body) : probe.body;
    findings.push(
      makeFinding({
        agent: "auth-endpoint-agent",
        question: `What error does ${tokenPost.url} return for an obviously invalid exchange?`,
        attempted: `POST ${tokenPost.url} with three bogus public-named params (api_key/request_token/checksum = 'nonexistent-public-probe-*'). No real credentials sent.`,
        attemptKind: "api-error-probe",
        outcome: probe.ok || (probe.status ?? 0) >= 400 ? "confirmed" : "failed",
        conclusion:
          probe.status === null
            ? `Endpoint did not respond: ${probe.error}`
            : `Endpoint responded with HTTP ${probe.status}. This confirms the token endpoint exists and documents its error shape for an invalid request.`,
        observation: `status=${probe.status ?? "n/a"} contentType=${
          probe.contentType ?? "n/a"
        } body=${excerpt(text, 400)}`,
        evidence: [
          {
            id: "auth-2",
            title: "Token exchange endpoint",
            url: tokenPost.url,
            snippet: excerpt(text, 300),
            sourceType: "official-docs",
          },
        ],
        uncertainty: "",
      }),
    );
  }

  return findings;
}
