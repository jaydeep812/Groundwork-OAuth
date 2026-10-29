import type { GeneratedGuide } from "@/lib/schema/guide";

/**
 * Bitbucket Cloud OAuth fixture — explicitly SOURCED, used only in tests (never
 * wired into the generic synthesis pipeline). Every fact below is verified
 * against Atlassian's official documentation:
 *
 *   OAuth reference / consumer setup + token lifetime + scopes:
 *     https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/
 *     https://developer.atlassian.com/cloud/bitbucket/oauth-2/
 *
 * Verified facts (2026-10-29):
 *   - Authorization endpoint: https://bitbucket.org/site/oauth2/authorize
 *   - Token endpoint:         https://bitbucket.org/site/oauth2/access_token
 *   - Access token lifetime:  2 hours ("Our access tokens expire in two hours")
 *   - Refresh tokens:         issued ("include refresh tokens for generating new
 *                             tokens without the need for user participation")
 *   - PKCE:                   NOT mentioned in the docs → "unknown" (do NOT claim
 *                             supported/required, do NOT generate PKCE code)
 *   - OAuth consumer setup:   Workspace settings → Apps and features → OAuth consumers
 *   - Scopes:                 defined ON THE CONSUMER, not via a per-request
 *                             `scope` parameter
 */

export const BITBUCKET_SOURCES = {
  oauthReference: "https://developer.atlassian.com/cloud/bitbucket/oauth-2/",
  useOauth: "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/",
  restIntro: "https://developer.atlassian.com/cloud/bitbucket/rest/intro/",
} as const;

export const BITBUCKET_FACTS = {
  authorizeUrl: "https://bitbucket.org/site/oauth2/authorize",
  tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
  tokenLifetimeHours: 2,
  issuesRefreshTokens: true,
  pkce: "unknown" as const, // not documented → preserve uncertainty, no PKCE code
  consumerSetupUrl: "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/",
};

/**
 * A CORRECT generated Bitbucket guide, as the pipeline should produce it after
 * the fixes: recommendedPath managed-auth (Composio ships a Bitbucket toolkit),
 * honest implementation facts, and the custom OAuth-app registration marked as
 * the non-mandatory "bring your own OAuth app" alternative.
 */
export const bitbucketManagedGuide: GeneratedGuide = {
  providerName: "Bitbucket",
  providerUrl: "https://bitbucket.org",
  description:
    "Bitbucket Cloud's REST API with OAuth 2.0 for acting on a user's repositories, pull requests, and pipelines.",
  recommendedPath: "managed-auth",
  pathRationale:
    "Composio ships a managed Bitbucket toolkit that handles the OAuth consumer, client secret, and token exchange, so you connect without building the flow yourself.",
  difficulty: { rating: "easy", rationale: "Managed connection via Composio.", findingIds: [] },
  activeEffort: { kind: "estimate", value: 15, unit: "minutes", rationale: "Connect the toolkit.", evidenceIds: [], findingIds: [] },
  externalWaiting: { kind: "unknown", value: null, unit: null, rationale: "No provider review for standard OAuth.", evidenceIds: [], findingIds: [] },
  prerequisites: [],
  implementation: {
    developerPortalUrl: BITBUCKET_FACTS.consumerSetupUrl,
    authorizeUrl: BITBUCKET_FACTS.authorizeUrl,
    tokenUrl: BITBUCKET_FACTS.tokenUrl,
    refreshUrl: BITBUCKET_FACTS.tokenUrl, // refresh is a grant at the same token endpoint
    revokeUrl: null,
    scopes: [], // Bitbucket scopes are set on the consumer, not per-request → none to list here
    supportedScopes: [],
    redirectUriRule:
      "Set the callback URL on the OAuth consumer in workspace settings; it must match the redirect_uri used in the authorize request.",
    pkce: BITBUCKET_FACTS.pkce, // "unknown" — not documented
    tokenLifetime: {
      kind: "verified",
      value: BITBUCKET_FACTS.tokenLifetimeHours,
      unit: "hours",
      rationale: "Atlassian docs: access tokens expire in two hours.",
      evidenceIds: ["ev-bb-oauth"],
      findingIds: [],
    },
    rateLimits: [],
    testMode: "",
    evidenceIds: ["ev-bb-oauth"],
    findingIds: [],
  },
  setupSteps: [
    {
      id: "connect-composio",
      title: "Connect Bitbucket via Composio",
      category: "configure-integration",
      authPath: "managed-auth",
      instructions: "Add the Bitbucket toolkit to Composio and connect your account.",
      rationale: "Composio manages the OAuth consumer and tokens.",
      required: true,
      appliesWhen: null,
      fields: [],
      expectedOutcome: "A connected Bitbucket account in Composio.",
      verification: "The connection shows active in the Composio dashboard.",
      recovery: "Reconnect from the Composio dashboard.",
      executionMode: "manual",
      defaultStatus: "not-started",
      evidenceIds: [],
      findingIds: [],
    },
    {
      id: "register-consumer",
      title: "Register a Bitbucket OAuth consumer",
      category: "register-provider-app",
      authPath: "custom-oauth",
      instructions:
        "In Workspace settings → Apps and features → OAuth consumers → Add consumer, create a consumer to get a Key and Secret and set the callback URL.",
      rationale: "Only needed if you run your own OAuth app instead of Composio.",
      required: false,
      appliesWhen: "Only if you choose to run your own OAuth app instead of Composio Managed Auth",
      fields: [],
      expectedOutcome: "An OAuth consumer Key and Secret.",
      verification: "The consumer appears in workspace settings.",
      recovery: "Edit the consumer in workspace settings.",
      executionMode: "manual",
      defaultStatus: "not-started",
      evidenceIds: ["ev-bb-oauth"],
      findingIds: [],
    },
  ],
  approvalRequirements: [],
  knownBlockers: [],
  blockerAssessment: "incomplete",
  agentCapabilities: [], capabilities: [],
  humanHandoff: [],
  evidence: [
    {
      id: "ev-bb-oauth",
      title: "Use OAuth on Bitbucket Cloud",
      url: BITBUCKET_SOURCES.useOauth,
      snippet: "Access tokens expire in two hours; OAuth consumers are created in workspace settings.",
      sourceType: "official-docs",
    },
    {
      id: "ev-bb-composio",
      title: "Bitbucket toolkit on Composio",
      url: "https://composio.dev/toolkits/bitbucket",
      snippet: "Managed Bitbucket toolkit.",
      sourceType: "composio-docs",
    },
  ],
  uncertainties: [],
  nextAction: "Connect Bitbucket through Composio to start.",
  findings: [],
};
