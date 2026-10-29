import type { GeneratedGuide, JourneyStep, CodeSnippet, Implementation, AuthPath } from "@/lib/schema/guide";

/**
 * Builds the integration walkthrough DETERMINISTICALLY from established facts.
 * The model never writes these steps, so snippets can't contain a hallucinated
 * endpoint — every value traces to something the pipeline retrieved.
 *
 * The journey is ALWAYS the custom OAuth readiness walkthrough: the 7-stage
 * OAuth flow (register → grant-type → authorize → exchange → store → api →
 * refresh), tailored to the provider's established facts. PKCE code is emitted
 * ONLY when the provider's evidence says PKCE is required or supported — never
 * from a generic assumption.
 *
 * Composio managed auth is NOT a separate path here: when it's available the
 * page surfaces it as a small optional shortcut (see ManagedAuthCallout). It
 * does not change the walkthrough.
 */

type Impl = Implementation;

/** The subset of a guide this builder reads. Narrow so callers/tests can pass
 * partial fixtures without constructing a full GeneratedGuide. */
type JourneyInput = Pick<GeneratedGuide, "providerName" | "recommendedPath" | "implementation">;

const AUTH_HEADER = "Authorization: Bearer <ACCESS_TOKEN>";

/** True when the provider's evidence establishes PKCE is used in this flow. */
function pkceApplies(impl: Impl | undefined): boolean {
  return impl?.pkce === "required" || impl?.pkce === "supported";
}

export function buildJourney(
  guide: JourneyInput,
  _opts: { toolkitUrl?: string | null } = {},
): JourneyStep[] {
  const impl = guide.implementation;
  const provider = guide.providerName;

  // The custom OAuth readiness walkthrough is always the guide's content: the
  // classic 7 stages, PKCE-gated. Managed-auth availability is supplementary.
  const usePkce = pkceApplies(impl);
  return [
    stepRegister(provider, impl),
    stepGrantType(provider, impl, usePkce),
    stepAuthorize(provider, impl, usePkce),
    stepExchange(provider, impl, usePkce),
    stepStoreTokens(provider, impl),
    stepApiRequest(provider, impl),
    stepRefresh(provider, impl),
  ];
}

function stepRegister(provider: string, impl: Impl | undefined): JourneyStep {
  const portal = impl?.developerPortalUrl ?? null;
  return base("register", 1, "Register your application", {
    authPath: "custom-oauth",
    summary: portal
      ? `Create an OAuth app/consumer in ${provider}'s developer settings to get a Client ID and Client Secret, and register your redirect URI(s).`
      : `Create an OAuth app/consumer in ${provider}'s developer settings to get a Client ID and Client Secret. Confirm the exact location in ${provider}'s docs.`,
    established: Boolean(portal),
    docUrl: portal,
    agentPrompt:
      `Register an OAuth app for ${provider}` +
      (portal ? ` at ${portal}` : "") +
      `. I need a Client ID, Client Secret, and to register my redirect URI. ` +
      (impl?.redirectUriRule ? `Redirect URI rule: ${impl.redirectUriRule}` : ""),
  });
}

function stepGrantType(provider: string, impl: Impl | undefined, usePkce: boolean): JourneyStep {
  const pkceLine =
    impl?.pkce === "required"
      ? ` ${provider} requires PKCE (S256).`
      : impl?.pkce === "supported"
        ? ` ${provider} supports PKCE (S256) — use it.`
        : impl?.pkce === "not-supported"
          ? ` ${provider} does not use PKCE for this flow.`
          : ` PKCE requirement not established — check ${provider}'s docs before adding it.`;
  return base("grant-type", 2, "Choose the grant type", {
    authPath: "custom-oauth",
    summary: `For an app acting on behalf of a user, use the Authorization Code flow. (Use Client Credentials only for server-to-server with no user.)${pkceLine}`,
    established: Boolean(impl?.pkce && impl.pkce !== "unknown"),
  });
}

function stepAuthorize(provider: string, impl: Impl | undefined, usePkce: boolean): JourneyStep {
  const authUrl = impl?.authorizeUrl ?? null;
  const scopes = requiredScopeString(impl);
  const pkcePhrase = usePkce ? ", and a PKCE code_challenge" : "";
  const summary = authUrl
    ? `Send the user's browser to ${provider}'s authorization endpoint with your client_id, redirect_uri, scope, state${pkcePhrase}.`
    : `Send the user to ${provider}'s authorization endpoint with client_id, redirect_uri, scope, state${pkcePhrase}. Confirm the exact endpoint in ${provider}'s docs.`;
  return base("authorize", 3, "Redirect the user to authorize", {
    authPath: "custom-oauth",
    summary,
    established: Boolean(authUrl),
    docUrl: authUrl,
    snippets: authUrl ? authorizeSnippets(authUrl, scopes, usePkce) : [],
    agentPrompt: authUrl
      ? `Build the ${provider} OAuth authorization URL: base ${authUrl}, query params client_id, redirect_uri, response_type=code, scope="${scopes}", state (random)${usePkce ? ", code_challenge (S256)" : ""}. Redirect the user there.${usePkce ? "" : " Do not add PKCE params unless the provider documents PKCE support."}`
      : null,
  });
}

function stepExchange(provider: string, impl: Impl | undefined, usePkce: boolean): JourneyStep {
  const tokenUrl = impl?.tokenUrl ?? null;
  const summary = tokenUrl
    ? `On the callback, your backend POSTs the authorization code to ${provider}'s token endpoint with your client_id and client_secret${usePkce ? " (plus the PKCE code_verifier)" : ""} to get an access token${refreshClause(impl)}.`
    : `On the callback, exchange the authorization code at ${provider}'s token endpoint for an access token. Confirm the exact endpoint in ${provider}'s docs.`;
  return base("exchange", 4, "Handle the callback & exchange the code", {
    authPath: "custom-oauth",
    summary,
    established: Boolean(tokenUrl),
    docUrl: tokenUrl,
    snippets: tokenUrl ? exchangeSnippets(tokenUrl, usePkce) : [],
    agentPrompt: tokenUrl
      ? `Implement the ${provider} token exchange: POST to ${tokenUrl} with grant_type=authorization_code, the code from the callback, redirect_uri, client_id, client_secret${usePkce ? ", code_verifier" : ""}. Parse access_token${impl?.refreshUrl || impl?.tokenUrl ? ", refresh_token" : ""}, and expires_in from the JSON response.`
      : null,
  });
}

function stepStoreTokens(provider: string, impl: Impl | undefined): JourneyStep {
  const lifetime =
    impl?.tokenLifetime && impl.tokenLifetime.value
      ? ` ${provider} access tokens last ~${impl.tokenLifetime.value} ${impl.tokenLifetime.unit ?? ""}.`.trimEnd()
      : "";
  return base("store-tokens", 5, "Store & manage tokens securely", {
    authPath: "custom-oauth",
    summary:
      `Save the access${impl?.refreshUrl || impl?.tokenUrl ? " and refresh" : ""} token(s) server-side (encrypted session or secrets manager) — never in client-side localStorage, never in logs. Track expiry so you can refresh ahead of time.` +
      lifetime,
    established: true, // universal best-practice step
    agentPrompt: `Store ${provider} OAuth tokens securely: keep tokens in server-side encrypted storage / a secrets manager, never in localStorage or logs, and persist expires_in so refresh runs before expiry.`,
  });
}

function stepApiRequest(provider: string, impl: Impl | undefined): JourneyStep {
  return base("api-request", 6, "Make authorized API requests", {
    authPath: "custom-oauth",
    summary: `Attach the access token as an HTTP header on every ${provider} API call: \`${AUTH_HEADER}\`.`,
    established: true,
    snippets: apiRequestSnippets(provider),
    agentPrompt: `Make authenticated ${provider} API requests by sending the header "${AUTH_HEADER}". Handle 401 by refreshing the token and retrying once.${rateLimitHint(impl)}`,
  });
}

function stepRefresh(provider: string, impl: Impl | undefined): JourneyStep {
  // Only describe refresh when there's a plausible refresh endpoint. If neither
  // a refresh nor token URL is established, stay honest rather than assume it.
  const refreshUrl = impl?.refreshUrl ?? impl?.tokenUrl ?? null;
  return base("refresh", 7, "Refresh expired tokens", {
    authPath: "custom-oauth",
    summary: refreshUrl
      ? `When the access token expires, POST your refresh_token to ${provider}'s token endpoint to get a new access token — no user prompt needed.`
      : `If ${provider} issues refresh tokens, exchange the refresh token for a new access token when it expires. Confirm refresh support in ${provider}'s docs.`,
    established: Boolean(refreshUrl),
    docUrl: refreshUrl,
    snippets: refreshUrl ? refreshSnippets(refreshUrl) : [],
    agentPrompt: refreshUrl
      ? `Implement token refresh for ${provider}: POST to ${refreshUrl} with grant_type=refresh_token, refresh_token, client_id, client_secret. Swap in the new access_token and reschedule the next refresh from expires_in.`
      : null,
  });
}

// --- snippet templates (deterministic; values come from established facts) ---

function authorizeSnippets(authUrl: string, scope: string, usePkce: boolean): CodeSnippet[] {
  const scopeParam = scope ? `&scope=${encodeURIComponent(scope)}` : "";
  const pkceSetupTs = usePkce
    ? `import crypto from "node:crypto";

const codeVerifier = crypto.randomBytes(32).toString("base64url");
const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
// persist codeVerifier + a random "state" in the user's session
`
    : `// persist a random "state" value in the user's session
`;
  const pkceParamsTs = usePkce
    ? `url.searchParams.set("code_challenge", codeChallenge);
url.searchParams.set("code_challenge_method", "S256");
`
    : "";
  const ts = `// Build the authorization URL (Authorization Code${usePkce ? " + PKCE" : ""})
${pkceSetupTs}
const url = new URL(${JSON.stringify(authUrl)});
url.searchParams.set("response_type", "code");
url.searchParams.set("client_id", process.env.CLIENT_ID!);
url.searchParams.set("redirect_uri", process.env.REDIRECT_URI!);
${scope ? `url.searchParams.set("scope", ${JSON.stringify(scope)});\n` : ""}url.searchParams.set("state", state);
${pkceParamsTs}// redirect the user to url.toString()`;
  const pkceQuery = usePkce ? "&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256" : "";
  const curl = `# The authorization step happens in the user's browser, not via cURL.
# Redirect them to:
${authUrl}?response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI${scopeParam}&state=$STATE${pkceQuery}`;
  return [snippet("bash", "cURL", curl), snippet("typescript", "TypeScript", ts)];
}

function exchangeSnippets(tokenUrl: string, usePkce: boolean): CodeSnippet[] {
  const verifierCurl = usePkce ? `\n  -d "code_verifier=$CODE_VERIFIER"` : "";
  const curl = `curl -X POST ${tokenUrl} \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "code=$AUTH_CODE" \\
  -d "redirect_uri=$REDIRECT_URI" \\
  -d "client_id=$CLIENT_ID" \\
  -d "client_secret=$CLIENT_SECRET"${verifierCurl}`;
  const verifierTs = usePkce ? `\n    code_verifier: codeVerifier,` : "";
  const ts = `// Exchange the authorization code for tokens (backend)
const res = await fetch(${JSON.stringify(tokenUrl)}, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: authCode,
    redirect_uri: process.env.REDIRECT_URI!,
    client_id: process.env.CLIENT_ID!,
    client_secret: process.env.CLIENT_SECRET!,${verifierTs}
  }),
});
const { access_token, refresh_token, expires_in } = await res.json();`;
  return [snippet("bash", "cURL", curl), snippet("typescript", "TypeScript", ts)];
}

function refreshSnippets(refreshUrl: string): CodeSnippet[] {
  const curl = `curl -X POST ${refreshUrl} \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=refresh_token" \\
  -d "refresh_token=$REFRESH_TOKEN" \\
  -d "client_id=$CLIENT_ID" \\
  -d "client_secret=$CLIENT_SECRET"`;
  const ts = `const res = await fetch(${JSON.stringify(refreshUrl)}, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: storedRefreshToken,
    client_id: process.env.CLIENT_ID!,
    client_secret: process.env.CLIENT_SECRET!,
  }),
});
const { access_token, expires_in } = await res.json();`;
  return [snippet("bash", "cURL", curl), snippet("typescript", "TypeScript", ts)];
}

function apiRequestSnippets(provider: string): CodeSnippet[] {
  const curl = `curl https://<API_BASE>/endpoint \\
  -H "${AUTH_HEADER}"`;
  const ts = `// Call ${provider}'s API with the access token (replace <API_BASE> with the provider's API host)
const res = await fetch("https://<API_BASE>/endpoint", {
  headers: { Authorization: \`Bearer \${accessToken}\` },
});
if (res.status === 401) {
  // token expired → refresh, then retry once
}`;
  return [snippet("bash", "cURL", curl), snippet("typescript", "TypeScript", ts)];
}

// --- small helpers ----------------------------------------------------------

function requiredScopeString(impl: Impl | undefined): string {
  if (!impl) return "";
  const req = impl.scopes.filter((s) => s.required).map((s) => s.name);
  const chosen = req.length ? req : impl.scopes.map((s) => s.name);
  return chosen.join(" ");
}

function refreshClause(impl: Impl | undefined): string {
  return impl?.refreshUrl || impl?.tokenUrl ? " (and a refresh token, if the provider issues one)" : "";
}

function rateLimitHint(impl: Impl | undefined): string {
  if (!impl || impl.rateLimits.length === 0) return "";
  const r = impl.rateLimits[0];
  return ` Respect the rate limit (${r.limit}${r.window ? " " + r.window : ""}) and back off on HTTP 429.`;
}

function snippet(language: string, label: string, code: string): CodeSnippet {
  return { language, label, code };
}

function base(
  key: JourneyStep["key"],
  order: number,
  title: string,
  rest: Partial<Omit<JourneyStep, "key" | "order" | "title">> & { summary: string },
): JourneyStep {
  return {
    key,
    order,
    authPath: rest.authPath ?? "custom-oauth",
    title,
    summary: rest.summary,
    established: rest.established ?? false,
    snippets: rest.snippets ?? [],
    agentPrompt: rest.agentPrompt ?? null,
    docUrl: rest.docUrl ?? null,
  };
}
