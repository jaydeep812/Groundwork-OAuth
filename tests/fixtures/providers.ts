/**
 * Provider regression fixtures for the fact ledger + critic.
 *
 * PROVENANCE / VERIFICATION CAVEAT
 * --------------------------------
 * Each fact below carries the official-documentation URL and a short excerpt it
 * is drawn from. These values were authored from the providers' documented
 * OAuth behavior; they were NOT re-fetched live in the build environment that
 * produced this file (outbound web access was unavailable). Before trusting a
 * value as current, re-verify it against the cited URL and update the fixture
 * deliberately if the provider's docs have changed. The tests assert how the
 * ledger/critic TREAT these inputs (status, provenance, consistency) — not that
 * the provider's live docs currently say exactly this.
 */

import type { OAuthMetadata } from "@/lib/research/oauth-metadata";
import type { EndpointHit } from "@/lib/research/endpoint-extract";
import type { Finding } from "@/lib/schema/guide";

export type FactExpectation = {
  fieldPath: string;
  value: string | number | boolean | null;
  /** Expected ledger status for this input shape. */
  status: "verified" | "observed" | "inferred" | "conflicting" | "unknown";
  source: string;
  excerpt: string;
};

export type ProviderFixture = {
  name: string;
  providerDomains: string[];
  /** Structured .well-known metadata, when the provider publishes it. */
  oauthMetadata: OAuthMetadata | null;
  /** Literal endpoint URLs an on-domain doc page would yield. */
  endpointHits: EndpointHit[];
  findings: Finding[];
  /** The authoritative facts we expect the ledger to resolve (with sources). */
  expectations: FactExpectation[];
  /** Notes about non-endpoint facts (scopes, approval, token rotation) that the
   * synthesis model owns — carried for documentation + future assertions. */
  notes: Record<string, { value: string; source: string; excerpt: string }>;
};

function finding(p: Partial<Finding> & { id: string; agent: string }): Finding {
  return {
    question: "q", attempted: "a", attemptKind: "docs-read", outcome: "confirmed",
    conclusion: "c", observation: "", evidence: [], uncertainty: "", at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

// ---------------------------------------------------------------------------
// BoldSign — IdentityServer-based OAuth; authorization-code flow REQUIRES PKCE.
// Refresh uses the SAME token endpoint and refresh tokens are SINGLE-USE.
// Docs: https://developers.boldsign.com/authentication/oauth/ (and OAuth
// standard-scopes + API-scopes pages). Values re-stated from the live docs the
// reviewer cited; re-verify at the URL before trusting as current.
// ---------------------------------------------------------------------------
export const boldsign: ProviderFixture = {
  name: "BoldSign",
  providerDomains: ["boldsign.com"],
  oauthMetadata: null, // BoldSign does not publish a .well-known document.
  endpointHits: [
    // Docs show these as full example URLs with query params; the extractor must
    // normalize them to the bare endpoint (regression for the malformed-URL bug).
    { kind: "authorize", url: "https://account.boldsign.com/connect/authorize?response_type=code&client_id=X&redirect_uri=Y&scope=Z&state=S&code_challenge=C&code_challenge_method=S256" },
    { kind: "token", url: "https://account.boldsign.com/connect/token" },
  ],
  findings: [
    finding({
      id: "bs-portal", agent: "portal-agent", attemptKind: "url-probe",
      conclusion: "An account admin registers a developer application under BoldSign API settings; availability depends on the subscription plan.",
      evidence: [{ id: "e", title: "BoldSign API settings", url: "https://app.boldsign.com/settings", snippet: "", sourceType: "developer-portal" }],
    }),
  ],
  expectations: [
    {
      fieldPath: "implementation.authorizeUrl",
      value: "https://account.boldsign.com/connect/authorize", // BARE endpoint
      status: "verified",
      source: "https://developers.boldsign.com/authentication/oauth/",
      excerpt: "Authorization endpoint: https://account.boldsign.com/connect/authorize",
    },
    {
      fieldPath: "implementation.tokenUrl",
      value: "https://account.boldsign.com/connect/token",
      status: "verified",
      source: "https://developers.boldsign.com/authentication/oauth/",
      excerpt: "Token endpoint: https://account.boldsign.com/connect/token (also used for refresh)",
    },
  ],
  notes: {
    pkceRequired: { value: "REQUIRED for the authorization-code flow (S256 preferred; plain also accepted)", source: "https://developers.boldsign.com/authentication/oauth/", excerpt: "The authorization request must include code_challenge and code_challenge_method; send the matching code_verifier at token exchange." },
    refreshUrl: { value: "same as token endpoint: https://account.boldsign.com/connect/token", source: "https://developers.boldsign.com/authentication/oauth/", excerpt: "Use the token endpoint with grant_type=refresh_token." },
    refreshSingleUse: { value: "yes — each refresh returns a NEW refresh token and invalidates the previous one", source: "https://developers.boldsign.com/authentication/oauth/", excerpt: "Refresh tokens are single-use; a successful refresh issues a new refresh token." },
    accessTokenLifetime: { value: "expires_in: 3600 (1 hour) — documented example; respect the runtime value", source: "https://developers.boldsign.com/authentication/oauth/", excerpt: '"expires_in": 3600' },
    standardScopes: { value: "openid, profile, email (standard); offline_access to receive a refresh token", source: "https://developers.boldsign.com/authentication/oauth/", excerpt: "Request openid profile email, and offline_access for a refresh token." },
    apiScopes: { value: "BoldSign.Documents.All, BoldSign.Templates.Create, BoldSign.Users.All — pick per use case, not all", source: "https://developers.boldsign.com/authentication/scopes/", excerpt: "Scopes grant specific API permissions; request only what you need." },
    registrationPrereqs: { value: "account admin required; API access depends on subscription plan; separate sandbox/live credentials; client-secret validity + billing option noted", source: "https://developers.boldsign.com/authentication/oauth/", excerpt: "An administrator creates the app; API features depend on your plan." },
  },
};

// ---------------------------------------------------------------------------
// Strava — endpoints documented; strict app eligibility + review gating.
// Docs: https://developers.strava.com/docs/authentication/
// ---------------------------------------------------------------------------
export const strava: ProviderFixture = {
  name: "Strava",
  providerDomains: ["strava.com"],
  oauthMetadata: null,
  endpointHits: [
    { kind: "authorize", url: "https://www.strava.com/oauth/authorize" },
    { kind: "token", url: "https://www.strava.com/oauth/token" },
  ],
  findings: [
    finding({
      id: "st-approval", agent: "constraints-agent", attemptKind: "search", outcome: "supports",
      question: "Is an approval/verification process required before launch?",
      conclusion: "New apps are capped to the owner athlete until Strava raises the limit on request.",
      evidence: [{ id: "e", title: "Strava rate limits & review", url: "https://developers.strava.com/docs/getting-started/", snippet: "", sourceType: "official-docs" }],
      uncertainty: "Exact review turnaround time is not published.",
    }),
  ],
  expectations: [
    {
      fieldPath: "implementation.authorizeUrl",
      value: "https://www.strava.com/oauth/authorize",
      status: "verified",
      source: "https://developers.strava.com/docs/authentication/",
      excerpt: "https://www.strava.com/oauth/authorize?client_id=...",
    },
    {
      fieldPath: "implementation.tokenUrl",
      value: "https://www.strava.com/oauth/token",
      status: "verified",
      source: "https://developers.strava.com/docs/authentication/",
      excerpt: "POST https://www.strava.com/oauth/token",
    },
  ],
  notes: {
    accessTokenLifetime: { value: "6 hours (21600s)", source: "https://developers.strava.com/docs/authentication/", excerpt: "expires_at ... short-lived access token valid for six hours" },
    refreshTokenIssued: { value: "yes", source: "https://developers.strava.com/docs/authentication/", excerpt: "Use the refresh token to get a new short-lived access token." },
    appEligibility: { value: "any Strava account can create ONE API application", source: "https://developers.strava.com/docs/getting-started/", excerpt: "Every Strava account comes with an API application." },
    connectedAthleteLimit: { value: "limited to the owner until increased-access is granted", source: "https://developers.strava.com/docs/getting-started/", excerpt: "Applications are rate limited and start with access to only the owner's data." },
    productionReview: { value: "required to raise athlete/rate limits", source: "https://developers.strava.com/docs/getting-started/", excerpt: "Request a rate limit increase once your app is ready." },
    externalWaiting: { value: "UNKNOWN — Strava does not publish a review turnaround", source: "https://developers.strava.com/docs/getting-started/", excerpt: "(no published timeline)" },
  },
};

// ---------------------------------------------------------------------------
// LinkedIn — capability/product-gated scopes; approval per product.
// Docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
// ---------------------------------------------------------------------------
export const linkedin: ProviderFixture = {
  name: "LinkedIn",
  providerDomains: ["linkedin.com", "microsoft.com"],
  oauthMetadata: null,
  endpointHits: [
    { kind: "authorize", url: "https://www.linkedin.com/oauth/v2/authorization" },
    { kind: "token", url: "https://www.linkedin.com/oauth/v2/accessToken" },
  ],
  findings: [
    finding({
      id: "li-products", agent: "docs-agent",
      conclusion: "Scopes are unlocked by adding Products to the app (e.g. 'Sign In with LinkedIn using OpenID Connect', 'Share on LinkedIn'); some require review.",
      evidence: [{ id: "e", title: "LinkedIn OAuth scopes", url: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow", snippet: "", sourceType: "official-docs" }],
    }),
  ],
  expectations: [
    {
      fieldPath: "implementation.authorizeUrl",
      value: "https://www.linkedin.com/oauth/v2/authorization",
      status: "verified",
      source: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
      excerpt: "https://www.linkedin.com/oauth/v2/authorization",
    },
    {
      fieldPath: "implementation.tokenUrl",
      value: "https://www.linkedin.com/oauth/v2/accessToken",
      status: "verified",
      source: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
      excerpt: "https://www.linkedin.com/oauth/v2/accessToken",
    },
  ],
  notes: {
    scopeGating: { value: "openid/profile/email via 'Sign In with LinkedIn using OpenID Connect'; w_member_social via 'Share on LinkedIn'", source: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2", excerpt: "Add the product to request these scopes." },
    scopeApproval: { value: "some products require review before approval", source: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow", excerpt: "Certain products require LinkedIn review." },
    accessTokenLifetime: { value: "60 days (consumer)", source: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow", excerpt: "Access tokens are valid for 60 days." },
    refreshTokenIssued: { value: "program-dependent (not all apps)", source: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens", excerpt: "Refresh tokens are available to approved applications." },
  },
};

// ---------------------------------------------------------------------------
// Unfamiliar provider — thin evidence, extraction failure → honest unknowns.
// ---------------------------------------------------------------------------
export const unknownProvider: ProviderFixture = {
  name: "Obscure Widgets API",
  providerDomains: ["obscure-widgets.example"],
  oauthMetadata: null,
  endpointHits: [], // nothing extractable
  findings: [
    finding({
      id: "ow-docs", agent: "docs-agent", outcome: "insufficient",
      conclusion: "Could not fetch authoritative OAuth documentation.",
      uncertainty: "Whether the provider uses OAuth 2.0 at all.",
    }),
  ],
  expectations: [
    {
      fieldPath: "implementation.authorizeUrl", value: null, status: "unknown",
      source: "(none)", excerpt: "no authoritative source retrieved",
    },
    {
      fieldPath: "implementation.tokenUrl", value: null, status: "unknown",
      source: "(none)", excerpt: "no authoritative source retrieved",
    },
  ],
  notes: {},
};

// ---------------------------------------------------------------------------
// Asana — endpoints under /-/ paths; documents a revoke endpoint; PKCE is
// conditionally required (localhost / native redirects); apps must be
// distributed to workspaces before external users can authorize.
// Docs: https://developers.asana.com/docs/oauth
// ---------------------------------------------------------------------------
export const asana: ProviderFixture = {
  name: "Asana",
  providerDomains: ["asana.com"],
  oauthMetadata: null,
  endpointHits: [
    { kind: "authorize", url: "https://app.asana.com/-/oauth_authorize" },
    { kind: "token", url: "https://app.asana.com/-/oauth_token" },
    { kind: "revoke", url: "https://app.asana.com/-/oauth_revoke" },
  ],
  findings: [
    finding({
      id: "as-dist", agent: "docs-agent",
      conclusion: "Creating an app does not make it available to any workspace; distribution must be configured (specific workspaces vs any workspace). App Directory publication is separate.",
      evidence: [{ id: "e", title: "Asana OAuth", url: "https://developers.asana.com/docs/oauth", snippet: "", sourceType: "official-docs" }],
    }),
  ],
  expectations: [
    {
      fieldPath: "implementation.authorizeUrl", value: "https://app.asana.com/-/oauth_authorize",
      status: "verified", source: "https://developers.asana.com/docs/oauth",
      excerpt: "https://app.asana.com/-/oauth_authorize",
    },
    {
      fieldPath: "implementation.tokenUrl", value: "https://app.asana.com/-/oauth_token",
      status: "verified", source: "https://developers.asana.com/docs/oauth",
      excerpt: "https://app.asana.com/-/oauth_token",
    },
    {
      fieldPath: "implementation.revokeUrl", value: "https://app.asana.com/-/oauth_revoke",
      status: "verified", source: "https://developers.asana.com/docs/oauth",
      excerpt: "POST https://app.asana.com/-/oauth_revoke with client_id, client_secret, token",
    },
  ],
  notes: {
    pkceConditional: { value: "supported; REQUIRED for localhost/127.0.0.1/native-app redirect URIs; S256 recommended", source: "https://developers.asana.com/docs/oauth", excerpt: "PKCE is required when using the localhost, 127.0.0.1 or native redirect URI." },
    scopeRegistration: { value: "requested scopes must be registered in the Developer Console; unregistered scope → forbidden_scopes; projects:write does not imply projects:read", source: "https://developers.asana.com/docs/oauth-scopes", excerpt: "Scopes must be configured on the app; scopes are not implied." },
    distribution: { value: "configure distribution to specific workspaces or any workspace before external users can authorize; App Directory is a separate publication decision", source: "https://developers.asana.com/docs/oauth", excerpt: "Creating an application does not automatically make it available to any workspace." },
  },
};

export const PROVIDER_FIXTURES = [boldsign, strava, linkedin, unknownProvider, asana];
