import type { GeneratedGuide } from "@/lib/schema/guide";

/**
 * Builds the "hand this to your coding agent" brief — a copy-paste prompt a
 * developer gives to Claude / Cursor / Copilot to implement the integration.
 *
 * It is composed DETERMINISTICALLY from facts the guide established. The model
 * never writes it, so it cannot invent an endpoint — every line traces to a
 * retrieved value. The brief always describes the custom OAuth implementation:
 * include only the provider facts actually established, mark unknowns as
 * "verify in the docs", and gate PKCE on documented support. Composio managed
 * auth, when available, is surfaced separately as an optional shortcut — it is
 * not part of this brief.
 *
 * Returns null when there isn't enough to produce a genuinely useful brief.
 */

type GuideLike = Pick<
  GeneratedGuide,
  "providerName" | "recommendedPath" | "pathRationale" | "implementation" | "capabilities"
>;

/** Enough signal to be worth handing to an agent? Requires the two endpoints
 * that make a custom-OAuth brief actionable. */
export function hasEnoughForAgentPrompt(guide: GuideLike): boolean {
  const impl = guide.implementation;
  return Boolean(impl && impl.authorizeUrl && impl.tokenUrl);
}

export function buildAgentPrompt(
  guide: GuideLike,
  useCase?: string,
  _opts: { toolkitUrl?: string | null } = {},
): string | null {
  if (!hasEnoughForAgentPrompt(guide)) return null;
  return customPrompt(guide, useCase);
}

function customPrompt(guide: GuideLike, useCase: string | undefined): string {
  const impl = guide.implementation;
  const p = guide.providerName;
  const usePkce = impl?.pkce === "required" || impl?.pkce === "supported";
  const lines: string[] = [];

  lines.push(`Help me implement OAuth so my app can connect to ${p} with its own OAuth app.`);
  if (useCase?.trim()) lines.push(`\nWhat I'm building: ${useCase.trim()}`);

  // Capability tie-in: name the provider capabilities this integration relies on
  // and the access each needs, so the agent requests the MINIMUM scopes. Only
  // evidence-backed capabilities exist here (never invented).
  const caps = guide.capabilities ?? [];
  if (caps.length > 0) {
    const capLines = caps.slice(0, 5).map((c) => {
      const access = c.requiredAccess.length > 0 ? ` — needs: ${c.requiredAccess.join(", ")}` : "";
      return `- ${c.title}${access}`;
    });
    lines.push(`\nCapabilities this integration uses (request only the access these need):\n${capLines.join("\n")}`);
  }

  // Established, citable facts. Only values that actually exist go here.
  const confirmed: string[] = [];
  if (impl?.developerPortalUrl) confirmed.push(`- Register the OAuth app at: ${impl.developerPortalUrl}`);
  if (impl?.authorizeUrl) confirmed.push(`- Authorization endpoint: ${impl.authorizeUrl}`);
  if (impl?.tokenUrl) confirmed.push(`- Token endpoint: ${impl.tokenUrl}`);
  if (impl?.refreshUrl && impl.refreshUrl !== impl.tokenUrl)
    confirmed.push(`- Refresh endpoint: ${impl.refreshUrl}`);
  if (impl?.revokeUrl) confirmed.push(`- Revoke endpoint: ${impl.revokeUrl}`);
  if (impl?.pkce === "required") {
    const d = impl.pkceDetail;
    const method = d?.methods?.length ? d.methods.join("/") : "S256";
    const cond = d?.appliesTo ? ` Required when: ${d.appliesTo}.` : "";
    confirmed.push(`- PKCE: REQUIRED (${method} code_challenge_method). Send code_verifier at token exchange.${cond}`);
  } else if (impl?.pkce === "supported") {
    const d = impl.pkceDetail;
    const method = d?.methods?.length ? d.methods.join("/") : "S256";
    const cond = d?.appliesTo ? ` Required when: ${d.appliesTo}.` : "";
    confirmed.push(`- PKCE: supported (${method}); use it and send code_verifier at token exchange.${cond}`);
  } else if (impl?.pkce === "not-supported")
    confirmed.push(`- PKCE: not used by this flow — do NOT generate PKCE parameters or code.`);
  const required = (impl?.scopes ?? []).filter((s) => s.required).map((s) => s.name);
  const optional = (impl?.scopes ?? []).filter((s) => !s.required).map((s) => s.name);
  if (required.length) confirmed.push(`- Required scopes: ${required.join(" ")}`);
  if (optional.length) confirmed.push(`- Other available scopes: ${optional.join(" ")}`);
  if (impl?.redirectUriRule) confirmed.push(`- Redirect URI rule: ${impl.redirectUriRule.trim()}`);
  if (impl?.tokenLifetime?.value)
    confirmed.push(
      `- Access token lifetime: ${impl.tokenLifetime.value} ${impl.tokenLifetime.unit ?? ""}`.trim() + ".",
    );
  for (const rl of impl?.rateLimits ?? []) {
    const w = rl.window ? ` ${rl.window}` : "";
    const sc = rl.scope ? ` (${rl.scope})` : "";
    confirmed.push(`- Rate limit: ${rl.limit}${w}${sc}. Back off and retry on HTTP 429.`);
  }
  if (confirmed.length) {
    lines.push(`\nConfirmed from ${p}'s documentation (use these exactly):`);
    lines.push(confirmed.join("\n"));
  }

  // Token-lifecycle nuance (refresh issuance / rotation / single-use) — the
  // facts a developer most often gets wrong. Only emit what's established.
  const lc = impl?.tokenLifecycle;
  if (lc) {
    const lcLines: string[] = [];
    if (lc.refreshTokenIssued === "yes") lcLines.push(`- Refresh tokens ARE issued${impl?.refreshUrl ? ` (refresh at ${impl.refreshUrl})` : ""}.`);
    if (lc.refreshTokenIssued === "no") lcLines.push(`- No refresh tokens are issued — re-run the authorization flow when the access token expires.`);
    if (lc.refreshTokenRotates === "yes" || lc.refreshTokenSingleUse === "yes")
      lcLines.push(`- Refresh tokens are SINGLE-USE / rotating: each refresh returns a NEW refresh token and invalidates the old one. Persist the new refresh_token from every refresh response.`);
    if (lc.revocationSupported === "yes" && impl?.revokeUrl) lcLines.push(`- Revocation endpoint: ${impl.revokeUrl}`);
    if (lc.tokenType) lcLines.push(`- Token type: ${lc.tokenType}`);
    if (lcLines.length) {
      lines.push(`\nToken lifecycle:`);
      lines.push(lcLines.join("\n"));
    }
  }

  // Environment variables the implementation needs — placeholders only, never
  // real secrets. These are the names the agent should read from the env.
  lines.push(
    `\nEnvironment variables (read from env / a secrets manager — never hardcode or log):
- ${envPrefix(p)}_CLIENT_ID=<your client id>
- ${envPrefix(p)}_CLIENT_SECRET=<your client secret>
- ${envPrefix(p)}_REDIRECT_URI=<your registered callback URL>`,
  );

  // A concrete, ordered implementation plan the agent can follow directly.
  const refreshNote = impl?.refreshUrl || impl?.tokenUrl ? " and refresh it before expiry" : "";
  lines.push(
    `\nImplementation steps:
1. Register the OAuth app${impl?.developerPortalUrl ? ` at ${impl.developerPortalUrl}` : " in the provider's developer portal"} and set the redirect/callback URI.
2. Build the authorization-code redirect${impl?.authorizeUrl ? ` to ${impl.authorizeUrl}` : ""} with client_id, redirect_uri, response_type=code, scope, and a random state${usePkce ? " plus a PKCE code_challenge (S256)" : ""}.
3. Handle the callback: verify state${usePkce ? ", send the code_verifier," : ""} and exchange the code for tokens${impl?.tokenUrl ? ` at ${impl.tokenUrl}` : ""}.
4. Store the access token${refreshNote} server-side; never expose it to the browser.
5. Call the API with the Authorization: Bearer header; handle 401 by refreshing once and retrying.`,
  );

  // Tests the agent should write to prove the flow works.
  const rotates = lc?.refreshTokenRotates === "yes" || lc?.refreshTokenSingleUse === "yes";
  const capWithAccess = (guide.capabilities ?? []).find((c) => c.requiredAccess.length > 0);
  const capTest = capWithAccess
    ? `\n- An authorized call for "${capWithAccess.title}" succeeds with the requested scopes (${capWithAccess.requiredAccess.join(", ")}) and fails cleanly without them.`
    : "";
  lines.push(
    `\nTests to add:
- The authorization URL contains client_id, redirect_uri, response_type=code, scope, and state${usePkce ? " and code_challenge" : ""}.
- The callback rejects a mismatched/missing state parameter.
- A successful code exchange stores an access token and (if issued) a refresh token.
- A 401 triggers a single refresh-and-retry${refreshNote ? "" : " (or a re-auth prompt if no refresh token is issued)"}.${
      rotates
        ? "\n- After a refresh, the NEW refresh_token is persisted and the old one is discarded (refresh tokens are single-use)."
        : ""
    }${capTest}`,
  );

  // Documentation links the agent can open — only URLs the research established.
  const docs: string[] = [];
  if (impl?.developerPortalUrl) docs.push(`- Register / developer portal: ${impl.developerPortalUrl}`);
  if (impl?.authorizeUrl) docs.push(`- Authorization endpoint: ${impl.authorizeUrl}`);
  if (impl?.tokenUrl) docs.push(`- Token endpoint: ${impl.tokenUrl}`);
  if (docs.length) {
    lines.push(`\nReference (verified during research):`);
    lines.push(docs.join("\n"));
  }

  // Honest unknowns — tell the agent to verify, not to invent.
  const unknowns: string[] = [];
  if (!impl?.developerPortalUrl) unknowns.push("where to register the OAuth app");
  if ((impl?.scopes ?? []).length === 0) unknowns.push("the scope list");
  if (!impl?.pkce || impl.pkce === "unknown") unknowns.push("whether PKCE is required");
  if (!impl?.tokenLifetime?.value) unknowns.push("the access-token lifetime");
  if (unknowns.length) {
    lines.push(
      `\nUnresolved — verify in ${p}'s official docs, do NOT guess: ${unknowns.join("; ")}.`,
    );
  }

  lines.push(
    `\nSecurity requirements:
- Use the Authorization Code flow${usePkce ? " with PKCE (S256)" : ""}.${
      usePkce ? "" : " Do NOT add PKCE unless the provider's docs say it's supported."
    }
- Read client credentials and tokens from environment variables / a secrets manager — never hardcode or log them.
- Store tokens server-side and refresh before expiry (only if the provider issues refresh tokens).
- Validate the OAuth state parameter on every callback; request only the scopes the use case needs.`,
  );
  return lines.join("\n");
}

/** A safe uppercase env-var prefix from the provider name (letters/digits only). */
function envPrefix(provider: string): string {
  const slug = provider.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return slug || "PROVIDER";
}
