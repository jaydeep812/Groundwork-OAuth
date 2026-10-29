import type { z } from "zod";
import type { Guide as GuideSchema } from "@/lib/schema/guide";

// Seeds are expressed in the schema's INPUT shape so fields with defaults
// (findingIds in particular) don't need to be repeated in every seed object.
// The final guide is validated with Guide.parse(...) at seed time, which
// fills in those defaults.
type Guide = z.input<typeof GuideSchema>;

/**
 * Curated seed guides. These are hand-authored against official provider
 * documentation. Where a precise timeline is not published, estimates are
 * marked as such and uncertainties are recorded. URLs point at real official
 * docs. Content reflects general public documentation as of the research date
 * and should be re-verified before launch.
 */

const RESEARCHED_AT = "2026-10-28T00:00:00.000Z";

export const SEED_GUIDES: Guide[] = [
  // --------------------------------------------------------------------- GitHub
  {
    id: "seed-github",
    slug: "github",
    providerName: "GitHub",
    providerUrl: "https://github.com",
    description:
      "Connect to the GitHub REST/GraphQL APIs on behalf of a user via OAuth. Good first integration: self-serve app registration, no mandatory review for most scopes.",
    recommendedPath: "managed-auth",
    pathRationale:
      "Composio provides a managed GitHub toolkit, so most teams can connect without registering their own OAuth app. Register a custom OAuth app only if you need your own branding on the consent screen or scopes beyond the managed connection.",
    difficulty: { rating: "easy", rationale: "Self-serve OAuth app creation, clear docs, no approval step for standard scopes." },
    activeEffort: {
      kind: "estimate",
      value: 30,
      unit: "minutes",
      rationale: "Registering an OAuth app and wiring the callback is a short, well-documented task.",
      evidenceIds: ["gh-oauth-docs"], findingIds: [],
    },
    externalWaiting: {
      kind: "verified",
      value: 0,
      unit: "minutes",
      rationale: "GitHub OAuth apps are usable immediately; there is no review queue for standard use.",
      evidenceIds: ["gh-oauth-docs"], findingIds: [],
    },
    prerequisites: [
      { id: "gh-pre-account", description: "A GitHub account (and an organization if the app is org-owned).", evidenceIds: [] },
    ],
    setupSteps: [
      {
        id: "gh-step-register",
        title: "Register a GitHub OAuth app",
        category: "register-provider-app",
        instructions:
          "Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Provide an application name, homepage URL, and authorization callback URL.",
        rationale: "The OAuth app issues the client credentials your integration uses to request authorization.",
        required: true,
        appliesWhen: "You are using the custom-oauth path instead of Composio managed auth.",
        fields: [
          {
            id: "gh-field-name",
            label: "Application name",
            required: true,
            description: "Shown to users on the authorization screen.",
            suggestedValue: null,
            provenance: "developer-input",
            validation: "Any descriptive name; this is user-visible.",
            missingInfo: false,
          },
          {
            id: "gh-field-callback",
            label: "Authorization callback URL",
            required: true,
            description: "Where GitHub redirects after the user authorizes. Must match your app's configured redirect.",
            suggestedValue: null,
            provenance: "environment-derived",
            validation: "Must be an exact URL your app serves (e.g. https://yourapp.com/api/auth/callback/github).",
            missingInfo: true,
          },
        ],
        expectedOutcome: "GitHub shows a Client ID and lets you generate a Client Secret.",
        verification: "You can see the Client ID on the app settings page.",
        recovery: "If the callback is rejected during auth, confirm it matches exactly, including scheme and path.",
        executionMode: "manual",
        defaultStatus: "not-started",
        evidenceIds: ["gh-oauth-docs"], findingIds: [],
      },
      {
        id: "gh-step-scopes",
        title: "Choose the scopes you request",
        category: "authorize-user",
        instructions:
          "Request the minimum scopes your use case needs (e.g. repo, read:user). Scopes are requested at authorization time, not fixed on the app.",
        rationale: "Minimal scopes reduce the consent friction and the blast radius of a leaked token.",
        required: true,
        appliesWhen: null,
        fields: [],
        expectedOutcome: "Your authorization URL includes only the scopes you need.",
        verification: "The consent screen lists exactly the permissions you requested.",
        recovery: "If access is denied for an API call, check the granted scopes on the token.",
        executionMode: "agent-assisted",
        defaultStatus: "not-started",
        evidenceIds: ["gh-scopes-docs"], findingIds: [],
      },
    ],
    approvalRequirements: [],
    knownBlockers: [],
    agentCapabilities: ["Draft the authorization URL and scope list", "Explain token exchange"],
    humanHandoff: ["Create the OAuth app in GitHub settings", "Store the client secret securely"],
    evidence: [
      { id: "gh-oauth-docs", title: "Creating an OAuth app — GitHub Docs", url: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app", snippet: "Register a new OAuth app in your developer settings.", sourceType: "official-docs" },
      { id: "gh-scopes-docs", title: "Scopes for OAuth apps — GitHub Docs", url: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps", snippet: "When setting up an OAuth app, request scopes via the scope parameter.", sourceType: "official-docs" },
    ],
    uncertainties: [
      { id: "gh-unc-managed", question: "Which exact scopes does the Composio managed GitHub connection expose?", resolution: "Confirm in the Composio GitHub toolkit documentation for your plan.", kind: "unknown" },
    ],
    lastResearchedAt: RESEARCHED_AT,
    status: "curated",
    nextAction: "Decide between Composio managed auth and a custom OAuth app, then register the app if needed.",
  },

  // --------------------------------------------------------------------- Google
  {
    id: "seed-google",
    slug: "google-apis",
    providerName: "Google APIs",
    providerUrl: "https://developers.google.com",
    description:
      "Connect to Google APIs (Gmail, Drive, Calendar, etc.) via OAuth 2.0. Sensitive and restricted scopes trigger a Google verification process that can add significant external waiting time.",
    recommendedPath: "custom-oauth",
    pathRationale:
      "Google requires an OAuth client configured in a Google Cloud project with a consent screen. If your scopes are sensitive/restricted and you serve external users, you must pass Google's verification — plan for this early.",
    difficulty: { rating: "hard", rationale: "Consent-screen configuration plus potential verification (including a possible security assessment for restricted scopes) makes this one of the more involved providers." },
    activeEffort: {
      kind: "estimate",
      value: 3,
      unit: "hours",
      rationale: "Project + consent screen + OAuth client setup is modest; preparing verification materials (privacy policy, demo video, domain verification) adds time.",
      evidenceIds: ["g-oauth-docs"], findingIds: [],
    },
    externalWaiting: {
      kind: "estimate",
      value: null,
      unit: null,
      rationale: "Google publishes that verification can take several weeks and restricted-scope security assessments longer, but exact timelines vary by app and are not guaranteed. Treat as an estimate, not a commitment.",
      evidenceIds: ["g-verify-docs"], findingIds: [],
    },
    prerequisites: [
      { id: "g-pre-project", description: "A Google Cloud project with the relevant APIs enabled.", evidenceIds: ["g-oauth-docs"] },
      { id: "g-pre-policy", description: "A published privacy policy and app homepage for the consent screen (required for verification).", evidenceIds: ["g-verify-docs"] },
    ],
    setupSteps: [
      {
        id: "g-step-consent",
        title: "Configure the OAuth consent screen",
        category: "register-provider-app",
        instructions:
          "In Google Cloud Console → APIs & Services → OAuth consent screen, set the user type, app name, support email, authorized domains, and scopes.",
        rationale: "Google shows this screen to users and uses its contents to decide whether verification is required.",
        required: true,
        appliesWhen: null,
        fields: [
          { id: "g-field-appname", label: "App name", required: true, description: "User-visible application name on the consent screen.", suggestedValue: null, provenance: "developer-input", validation: "Should match your real product name to pass verification.", missingInfo: false },
          { id: "g-field-privacy", label: "Privacy policy URL", required: true, description: "A reachable privacy policy on your authorized domain.", suggestedValue: null, provenance: "environment-derived", validation: "Must be a public https URL on a domain you have verified.", missingInfo: true },
          { id: "g-field-scopes", label: "Requested scopes", required: true, description: "The Google API scopes your app requests. Sensitive/restricted scopes trigger verification.", suggestedValue: null, provenance: "developer-input", validation: "Request the minimum scopes needed; restricted scopes have the heaviest review.", missingInfo: true },
        ],
        expectedOutcome: "A saved consent-screen configuration; apps using only non-sensitive scopes may avoid verification.",
        verification: "The consent screen status shows your configuration and whether verification is needed.",
        recovery: "If users see an 'unverified app' warning, complete the verification flow or limit to test users.",
        executionMode: "manual",
        defaultStatus: "not-started",
        evidenceIds: ["g-oauth-docs", "g-verify-docs"], findingIds: [],
      },
      {
        id: "g-step-client",
        title: "Create an OAuth 2.0 client ID",
        category: "register-provider-app",
        instructions:
          "Under Credentials → Create credentials → OAuth client ID, choose the application type and add your authorized redirect URIs.",
        rationale: "The client ID/secret authenticate your app during the OAuth exchange.",
        required: true,
        appliesWhen: null,
        fields: [
          { id: "g-field-redirect", label: "Authorized redirect URI", required: true, description: "Exact URL Google redirects to after consent.", suggestedValue: null, provenance: "environment-derived", validation: "Must exactly match the redirect your app sends, including path.", missingInfo: true },
        ],
        expectedOutcome: "Google issues a client ID and client secret.",
        verification: "A test authorization completes and returns an authorization code to your redirect URI.",
        recovery: "redirect_uri_mismatch means the URI isn't registered exactly — add it and retry.",
        executionMode: "manual",
        defaultStatus: "not-started",
        evidenceIds: ["g-oauth-docs"], findingIds: [],
      },
    ],
    approvalRequirements: [
      {
        id: "g-approval-verify",
        title: "OAuth app verification (for sensitive/restricted scopes with external users)",
        description:
          "Apps requesting sensitive or restricted scopes for external users must pass Google verification; restricted scopes may also require an independent security assessment.",
        timeline: { kind: "estimate", value: null, unit: null, rationale: "Google states review can take several weeks; restricted-scope assessments can take longer. Not a guaranteed timeline.", evidenceIds: ["g-verify-docs"] },
        required: true,
        evidenceIds: ["g-verify-docs"], findingIds: [],
      },
    ],
    knownBlockers: [
      { id: "g-block-restricted", title: "Restricted-scope security assessment", description: "Certain Gmail/Drive restricted scopes require a third-party security assessment that can be costly and slow — a common launch blocker.", evidenceIds: ["g-verify-docs"] },
    ],
    agentCapabilities: ["Explain which scopes are sensitive vs restricted", "Draft the redirect URI and authorization URL"],
    humanHandoff: ["Create the Cloud project and consent screen", "Prepare and submit verification materials"],
    evidence: [
      { id: "g-oauth-docs", title: "Using OAuth 2.0 to Access Google APIs — Google Identity", url: "https://developers.google.com/identity/protocols/oauth2", snippet: "Set up OAuth 2.0 via a client ID in a Google Cloud project.", sourceType: "official-docs" },
      { id: "g-verify-docs", title: "OAuth App Verification Help Center — Google", url: "https://support.google.com/cloud/answer/9110914", snippet: "Apps requesting sensitive or restricted scopes must be verified.", sourceType: "official-docs" },
    ],
    uncertainties: [
      { id: "g-unc-timeline", question: "What is the actual verification timeline for this specific app's scopes?", resolution: "Google does not publish a guaranteed timeline; submit early and track the verification status in Cloud Console.", kind: "unknown" },
    ],
    lastResearchedAt: RESEARCHED_AT,
    status: "curated",
    nextAction: "List the exact Google scopes you need and determine whether any are sensitive/restricted — that decides whether verification is on your critical path.",
  },

  // --------------------------------------------------------------------- Slack
  {
    id: "seed-slack",
    slug: "slack",
    providerName: "Slack",
    providerUrl: "https://api.slack.com",
    description:
      "Connect to Slack via OAuth 2.0 with granular bot/user scopes. Internal (single-workspace) apps are quick; distributing on the Slack App Directory adds a review process.",
    recommendedPath: "custom-oauth",
    pathRationale:
      "Slack apps are created in the Slack API dashboard with your chosen scopes and redirect URLs. Internal use is self-serve; public distribution requires Slack's directory review.",
    difficulty: { rating: "moderate", rationale: "Scope selection and install flow are straightforward for internal apps; public distribution review raises the bar." },
    activeEffort: { kind: "estimate", value: 1, unit: "hours", rationale: "Creating the app, picking scopes, and configuring redirect URLs is quick for a single workspace.", evidenceIds: ["slack-oauth-docs"] },
    externalWaiting: { kind: "estimate", value: 0, unit: "minutes", rationale: "No waiting for internal/single-workspace installs. Public App Directory submission adds review time that Slack does not publish as a fixed SLA.", evidenceIds: ["slack-oauth-docs"] },
    prerequisites: [
      { id: "slack-pre-workspace", description: "A Slack workspace where you can install apps (admin rights may be required).", evidenceIds: [] },
    ],
    setupSteps: [
      {
        id: "slack-step-create",
        title: "Create a Slack app and add OAuth scopes",
        category: "register-provider-app",
        instructions:
          "At api.slack.com/apps, create an app, then under OAuth & Permissions add bot and/or user token scopes and your redirect URL(s).",
        rationale: "Scopes define what your app can do; the redirect URL receives the OAuth code.",
        required: true,
        appliesWhen: null,
        fields: [
          { id: "slack-field-scopes", label: "Bot/User token scopes", required: true, description: "The granular Slack permissions your app needs (e.g. chat:write, channels:read).", suggestedValue: null, provenance: "developer-input", validation: "Add only the scopes you use; extra scopes slow directory review.", missingInfo: true },
          { id: "slack-field-redirect", label: "Redirect URL", required: true, description: "Where Slack sends the OAuth authorization code.", suggestedValue: null, provenance: "environment-derived", validation: "Must be https and match the redirect your app sends.", missingInfo: true },
        ],
        expectedOutcome: "Slack provides a Client ID/Secret and an install URL for your workspace.",
        verification: "Installing the app to your workspace returns an access token with the expected scopes.",
        recovery: "If install fails with invalid_scope, remove unsupported scopes; for bad_redirect_uri, fix the registered URL.",
        executionMode: "manual",
        defaultStatus: "not-started",
        evidenceIds: ["slack-oauth-docs"], findingIds: [],
      },
    ],
    approvalRequirements: [
      {
        id: "slack-approval-directory",
        title: "App Directory review (only if distributing publicly)",
        description: "Listing an app publicly in the Slack App Directory requires passing Slack's submission/review checklist. Not required for internal single-workspace use.",
        timeline: { kind: "unknown", value: null, unit: null, rationale: "Slack does not publish a guaranteed directory review timeline.", evidenceIds: ["slack-oauth-docs"] },
        required: false,
        evidenceIds: ["slack-oauth-docs"], findingIds: [],
      },
    ],
    knownBlockers: [],
    agentCapabilities: ["Recommend minimal scopes for a use case", "Explain bot vs user tokens"],
    humanHandoff: ["Create the app and install it to the workspace", "Submit to the App Directory if distributing"],
    evidence: [
      { id: "slack-oauth-docs", title: "Installing with OAuth — Slack API", url: "https://api.slack.com/authentication/oauth-v2", snippet: "Use OAuth 2.0 to install your app and obtain tokens with the scopes you configure.", sourceType: "official-docs" },
    ],
    uncertainties: [
      { id: "slack-unc-managed", question: "Does Composio's managed Slack connection cover the scopes you need?", resolution: "Check the Composio Slack toolkit docs; if covered, you may skip creating your own app.", kind: "unknown" },
    ],
    lastResearchedAt: RESEARCHED_AT,
    status: "curated",
    nextAction: "Decide whether this is internal-only (quick) or public distribution (adds directory review), then create the Slack app with minimal scopes.",
  },
];
