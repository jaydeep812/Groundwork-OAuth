import { z } from "zod";

/** An http(s) URL. Zod's .url() accepts dangerous schemes (javascript:, data:),
 * so we additionally require an http/https protocol. */
const httpUrl = z
  .string()
  .url()
  .refine(
    (u) => {
      try {
        const p = new URL(u).protocol;
        return p === "http:" || p === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an http(s) URL" },
  );

/**
 * Canonical OAuth Readiness Guide schema.
 *
 * This is the SINGLE source of truth reused across:
 *  - seeded curated data
 *  - Gemini structured output
 *  - persistence (serialized to SQLite)
 *  - API responses
 *  - UI rendering
 *
 * Keep it stable and explicit. All identifiers are stable strings (never array
 * indexes) so progress tracking survives reordering.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const RecommendedPath = z.enum([
  "managed-auth", // Use Composio Managed Auth (existing managed connection)
  "custom-oauth", // Register a provider OAuth app + configure custom credentials
  "other", // A different justified route (explained in rationale)
]);
export type RecommendedPath = z.infer<typeof RecommendedPath>;

export const DifficultyRating = z.enum(["easy", "moderate", "hard", "unknown"]);
export type DifficultyRating = z.infer<typeof DifficultyRating>;

export const EffortUnit = z.enum(["minutes", "hours", "days"]);
export type EffortUnit = z.infer<typeof EffortUnit>;

/** How a claim is grounded. A search result is evidence to evaluate, not proof. */
export const ClaimKind = z.enum([
  "verified", // Confirmed against official provider documentation
  "observed", // Directly observed by the pipeline
  "estimate", // A reasoned estimate (timeline/effort)
  "inference", // Inferred from available evidence
  "unknown", // Not established by available evidence
]);
export type ClaimKind = z.infer<typeof ClaimKind>;

export const ExecutionMode = z.enum([
  "manual", // Human must do this
  "agent-assisted", // Agent can help but human is in the loop
  "automatable", // Could be automated later (e.g. via browser automation)
]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const ProgressStatus = z.enum([
  "not-started",
  "in-progress",
  "completed",
  "blocked",
  "unverified",
]);
export type ProgressStatus = z.infer<typeof ProgressStatus>;

export const ValueProvenance = z.enum([
  "developer-input", // Developer chooses/supplies this value
  "environment-derived", // Comes from the developer's app/environment (e.g. redirect URI)
  "provider-issued", // Issued by the provider (e.g. client id/secret)
]);
export type ValueProvenance = z.infer<typeof ValueProvenance>;

export const GuideStatus = z.enum(["curated", "generated", "needs-review"]);
export type GuideStatus = z.infer<typeof GuideStatus>;

// ---------------------------------------------------------------------------
// Finding — one atomic unit of what an investigator agent did and observed.
// Lives here (not in report.ts) because the Guide now embeds Findings so the
// UI can render "how we know" per claim without a round-trip to another table.
// ---------------------------------------------------------------------------

export const AttemptKind = z.enum([
  "docs-read",
  "url-probe",
  "api-error-probe",
  "catalog-check",
  "search",
  "static-reasoning",
]);
export type AttemptKind = z.infer<typeof AttemptKind>;

export const AttemptOutcome = z.enum([
  "confirmed",
  "supports",
  "contradicts",
  "insufficient",
  "failed",
  "skipped",
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

// ---------------------------------------------------------------------------
// Sub-objects
// ---------------------------------------------------------------------------

export const EvidenceRef = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: httpUrl,
  /** Short snippet or quote supporting the claim. */
  snippet: z.string().default(""),
  /**
   * Provenance of the source. "official-docs" and "developer-portal" are only
   * credited when the host is on the provider's own domain (see
   * lib/search/classify.ts). "third-party-integration" covers integration
   * platforms (Nango, Clerk, OpenAlgo, …) that document other providers'
   * OAuth; "community" covers forums/blogs; "unknown" is the honest fallback.
   */
  sourceType: z
    .enum([
      "official-docs",
      "developer-portal",
      "composio-docs",
      "third-party-integration",
      "community",
      "unknown",
      // Legacy values accepted for forward-compat with older rows:
      "third-party",
    ])
    .default("unknown"),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/**
 * One atomic result from an investigator agent. Guides produced by the deep
 * pipeline embed these so the UI can show "how we know" for every claim.
 */
export const Finding = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  question: z.string().min(1),
  attempted: z.string().min(1),
  attemptKind: AttemptKind,
  outcome: AttemptOutcome,
  conclusion: z.string().min(1),
  observation: z.string().default(""),
  evidence: z.array(EvidenceRef).default([]),
  uncertainty: z.string().default(""),
  at: z.string().datetime(),
});
export type Finding = z.infer<typeof Finding>;

export const Estimate = z.object({
  kind: ClaimKind,
  /** Numeric estimate; null when unknown. */
  value: z.number().nullable().default(null),
  unit: EffortUnit.nullable().default(null),
  rationale: z.string().min(1),
  /** IDs of evidence entries supporting this estimate. */
  evidenceIds: z.array(z.string()).default([]),
  /** IDs of investigator Findings backing this estimate (deep pipeline). */
  findingIds: z.array(z.string()).optional().default([]),
});
export type Estimate = z.infer<typeof Estimate>;

export const Difficulty = z.object({
  rating: DifficultyRating,
  rationale: z.string().min(1),
  /** IDs of investigator Findings backing the difficulty rating. */
  findingIds: z.array(z.string()).optional().default([]),
});
export type Difficulty = z.infer<typeof Difficulty>;

/** A single configuration field the developer must populate in a provider form. */
export const SetupField = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(true),
  /** What the provider expects for this field. */
  description: z.string().default(""),
  /** Suggested/copyable value, only when supported by evidence. Null otherwise. */
  suggestedValue: z.string().nullable().default(null),
  provenance: ValueProvenance,
  /** Guidance on validating the entered value. */
  validation: z.string().default(""),
  /** Whether we lack enough info to suggest a value. */
  missingInfo: z.boolean().default(false),
});
export type SetupField = z.infer<typeof SetupField>;

export const SetupStepCategory = z.enum([
  "register-provider-app", // Create the OAuth/API app in the provider's developer portal
  "configure-integration", // Wire credentials/redirect URI into the developer's own app
  "authorize-user", // Run the user-facing OAuth / authorization flow
  "verify-data-access", // Confirm the issued token works and the expected data is reachable
  "provider-approval", // Submit for provider review/verification/distribution approval
]);
export type SetupStepCategory = z.infer<typeof SetupStepCategory>;

/**
 * Which authentication path a step/section belongs to. This is the explicit,
 * structural signal that keeps managed-auth and custom-OAuth content from
 * bleeding into each other (replacing the old `appliesWhen`-string convention).
 *   managed-auth  — connect through Composio Managed Auth (no own OAuth app)
 *   custom-oauth  — register and run your own provider OAuth app
 *   both          — applies regardless of path (e.g. "make an API request")
 */
export const AuthPath = z.enum(["managed-auth", "custom-oauth", "both"]);
export type AuthPath = z.infer<typeof AuthPath>;

export const SetupStep = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Which phase of the integration this step belongs to. Drives the UI grouping. */
  category: SetupStepCategory.default("configure-integration"),
  /** Which auth path this step applies to. Defaults to "both" so legacy/curated
   * steps stay visible; the managed/custom separation is enforced on this. */
  authPath: AuthPath.default("both"),
  /** What to do and where to do it. */
  instructions: z.string().min(1),
  /** Why this step matters. */
  rationale: z.string().default(""),
  required: z.boolean().default(true),
  /** Optional condition under which this step applies (supports conditional steps). */
  appliesWhen: z.string().nullable().default(null),
  fields: z.array(SetupField).default([]),
  expectedOutcome: z.string().default(""),
  verification: z.string().default(""),
  recovery: z.string().default(""),
  executionMode: ExecutionMode,
  /** Default progress status; user progress is tracked separately per-guide. */
  defaultStatus: ProgressStatus.default("not-started"),
  evidenceIds: z.array(z.string()).default([]),
  /** IDs of investigator Findings backing this step (deep pipeline). */
  findingIds: z.array(z.string()).optional().default([]),
});
export type SetupStep = z.infer<typeof SetupStep>;

export const ApprovalRequirement = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Timeline estimate; honest about unknowns. */
  timeline: Estimate.nullable().default(null),
  required: z.boolean().default(true),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type ApprovalRequirement = z.infer<typeof ApprovalRequirement>;

export const Blocker = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type Blocker = z.infer<typeof Blocker>;

/**
 * A single thing a developer can BUILD with this provider's API — the
 * "What can you build?" overview. This is a developer-oriented capability
 * (e.g. "Read and create tasks"), NOT a raw endpoint list. Every field is
 * grounded in evidence like any other claim; honest-empty when not established.
 *
 * Crucially this models PROVIDER CAPABILITY (what the API supports), kept
 * distinct from application permissions (scopes to request) and effective user
 * access (what a consented connection can actually reach). `requiredAccess`
 * names the scopes/permissions this capability needs — it does NOT assert the
 * capability is automatically available to any integration.
 */
export const Capability = z.object({
  /** Short developer-facing title, e.g. "Manage project tasks". */
  title: z.string().min(1),
  /** One or two sentences: what you can build with it. */
  summary: z.string().default(""),
  /** Resources + operations (read/create/update/delete), as documented. */
  dataAndActions: z.string().default(""),
  /** Scope names / permissions / settings this capability requires. May be
   * empty when the provider uses a non-scope permission model. */
  requiredAccess: z.array(z.string()).default([]),
  /** Important restrictions: approval, plan gates, rate/access conditions. */
  limitations: z.string().default(""),
  /** Direct link to the official API reference supporting this capability. */
  docUrl: httpUrl.nullable().default(null),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type Capability = z.infer<typeof Capability>;

export const Uncertainty = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  /** What is needed to resolve it. */
  resolution: z.string().default(""),
  kind: ClaimKind.default("unknown"),
  findingIds: z.array(z.string()).optional().default([]),
});
export type Uncertainty = z.infer<typeof Uncertainty>;

export const Prerequisite = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  /** Which investigator Finding ids back this claim (when the guide was
   * produced by the deep pipeline). Empty for the fast guide pipeline. */
  findingIds: z.array(z.string()).optional().default([]),
});
export type Prerequisite = z.infer<typeof Prerequisite>;

// ---------------------------------------------------------------------------
// Implementation pack — the concrete, copyable OAuth facts a developer needs
// to actually wire up the integration. Every field is optional/nullable and
// honest: a null endpoint or empty list means "not established from retrieved
// evidence", never a fabricated value. The completeness critic in the research
// graph checks exactly these fields.
// ---------------------------------------------------------------------------

export const PkceRequirement = z.enum(["required", "supported", "not-supported", "unknown"]);
export type PkceRequirement = z.infer<typeof PkceRequirement>;

// ---------------------------------------------------------------------------
// Normalized fact ledger. The deterministic layer between research
// (findings + evidence) and guide synthesis. Each fact establishes ONE
// canonical field path, carries its own status + provenance, and is built
// ONLY from evidence/findings actually collected — never model-invented.
// Reuses existing EvidenceRef ids (evidenceRefs) and Finding ids (findingIds).
// ---------------------------------------------------------------------------

/** Confidence/grounding of a normalized fact. Superset of ClaimKind tuned for
 * the ledger: adds "conflicting" (sources disagree) as a first-class status. */
export const FactStatus = z.enum([
  "verified", // authoritative documentation / provider metadata states it
  "observed", // the pipeline directly observed it (e.g. a live endpoint probe)
  "inferred", // reasoned from evidence, not stated outright
  "conflicting", // sources disagree; see conflicts[]
  "unknown", // not established from the retrieved evidence
]);
export type FactStatus = z.infer<typeof FactStatus>;

/** How the supporting evidence for a fact was retrieved. Mirrors the pipeline's
 * real retrieval methods so provenance is never fabricated. */
export const RetrievalMethod = z.enum([
  "oauth-metadata", // provider's own .well-known OAuth/OIDC metadata document
  "official-docs", // authoritative provider documentation page
  "http-probe", // direct HTTP probe of a live endpoint
  "catalog-probe", // Composio catalog toolkit probe
  "search-result", // general web search result
  "static-reasoning", // deterministic reasoning over other evidence
  "unknown",
]);
export type RetrievalMethod = z.infer<typeof RetrievalMethod>;

/** Why an important field could not be resolved. Drives targeted recovery. */
export const UnresolvedReason = z.enum([
  "not_found_in_retrieved_evidence",
  "extraction_failed",
  "source_conflict",
  "no_authoritative_source_found",
  "not_applicable",
  "requires_provider_confirmation",
]);
export type UnresolvedReason = z.infer<typeof UnresolvedReason>;

export const NormalizedFact = z.object({
  /** Canonical field this fact establishes, e.g. "implementation.tokenUrl". */
  fieldPath: z.string().min(1),
  /** The normalized, correctly-typed value. null when status is unknown. */
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).default(null),
  status: FactStatus,
  /** Evidence ids (EvidenceRef.id) that support this fact. */
  evidenceRefs: z.array(z.string()).default([]),
  /** Finding ids that back this fact. */
  findingIds: z.array(z.string()).default([]),
  /** The relevant quote / structured observation, when available. */
  sourceExcerpt: z.string().default(""),
  /** Applicability conditions: flow, environment, scope, app type, distribution. */
  appliesTo: z.string().default(""),
  retrievalMethod: RetrievalMethod.default("unknown"),
  /** ISO timestamp the supporting evidence was retrieved. */
  retrievedAt: z.string().default(""),
  /** When status is "conflicting", the competing values + their sources. */
  conflicts: z
    .array(
      z.object({
        value: z.union([z.string(), z.number(), z.boolean()]),
        evidenceRefs: z.array(z.string()).default([]),
        note: z.string().default(""),
      }),
    )
    .default([]),
  /** When the field could not be resolved, why (drives recovery). */
  unresolvedReason: UnresolvedReason.nullable().default(null),
});
export type NormalizedFact = z.infer<typeof NormalizedFact>;

export const OAuthScope = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  /** True ONLY when required for the developer's selected use case — never
   * default-true just because the provider offers the scope. */
  required: z.boolean().default(false),
  /** What API operations / features this scope enables. */
  enables: z.string().default(""),
  /** A narrower alternative scope, when one exists (least-privilege hint). */
  narrowerAlternative: z.string().default(""),
  /** True when this scope needs special provider approval/verification. */
  requiresApproval: z.boolean().default(false),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type OAuthScope = z.infer<typeof OAuthScope>;

export const RateLimit = z.object({
  /** e.g. "10" or "100". Kept as a string because providers phrase these
   * many ways ("10 requests") and we never want to fabricate a number. */
  limit: z.string().min(1),
  /** e.g. "per second", "per minute per user". */
  window: z.string().default(""),
  /** What the limit applies to, e.g. "order placement", "all endpoints". */
  scope: z.string().default(""),
  note: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type RateLimit = z.infer<typeof RateLimit>;

/** Tri-state fact used across the OAuth model where "we don't know" must be
 * distinct from "no". */
export const TriState = z.enum(["yes", "no", "unknown"]);
export type TriState = z.infer<typeof TriState>;

/** PKCE support and requirement, kept INDEPENDENT (a flow can support PKCE
 * without mandating it). */
export const PkceDetail = z.object({
  supported: TriState.default("unknown"),
  required: TriState.default("unknown"),
  /** Accepted challenge methods, e.g. ["S256"]. Empty when not established. */
  methods: z.array(z.string()).default([]),
  /** Condition the requirement applies under, e.g. "public clients only". */
  appliesTo: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type PkceDetail = z.infer<typeof PkceDetail>;

/** OAuth flow / grant requirements. */
export const OAuthFlow = z.object({
  /** e.g. ["authorization_code", "refresh_token"]. Empty when not established. */
  grantTypes: z.array(z.string()).default([]),
  /** e.g. ["code"]. */
  responseTypes: z.array(z.string()).default([]),
  /** Required authorization-request params beyond the usual, when documented. */
  requiredAuthParams: z.array(z.string()).default([]),
  /** Token-endpoint client auth, e.g. "client_secret_post" | "client_secret_basic". */
  tokenEndpointAuthMethods: z.array(z.string()).default([]),
  /** "public" | "confidential" | "unknown" — whether a client secret is used. */
  clientType: z.enum(["public", "confidential", "unknown"]).default("unknown"),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type OAuthFlow = z.infer<typeof OAuthFlow>;

/** Refresh-token + revocation lifecycle. Every field honest-nullable. */
export const TokenLifecycle = z.object({
  refreshTokenIssued: TriState.default("unknown"),
  /** Refresh-token lifetime, when documented. */
  refreshTokenLifetime: Estimate.nullable().default(null),
  /** Whether using a refresh token returns a NEW refresh token (rotation). */
  refreshTokenRotates: TriState.default("unknown"),
  /** Whether the previous refresh token is invalidated on rotation. */
  refreshTokenSingleUse: TriState.default("unknown"),
  revocationSupported: TriState.default("unknown"),
  /** Token type/format when established, e.g. "Bearer (opaque)", "JWT". */
  tokenType: z.string().default(""),
  /** How the token is presented, e.g. "Authorization: Bearer header". */
  presentation: z.string().default(""),
  /** Documented behavior when refresh/reauth fails. */
  onRefreshFailure: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type TokenLifecycle = z.infer<typeof TokenLifecycle>;

/** App registration, account/plan, and approval readiness. Distinguish
 * not_applicable from unknown via the honest-nullable fields. */
export const AppReadiness = z.object({
  /** Account type / plan / admin privileges required to register, when documented. */
  accountRequirements: z.string().default(""),
  /** Required app registration fields, e.g. ["privacy policy URL", "logo", "callback URL"]. */
  requiredAppFields: z.array(z.string()).default([]),
  /** Dev/sandbox/test/production mode notes. */
  environments: z.string().default(""),
  /** Test-user / connected-account limits before approval, when documented. */
  testUserLimits: z.string().default(""),
  /** Whether a scope-specific verification/approval exists. */
  scopeApproval: TriState.default("unknown"),
  /** Distribution-specific review (public app / marketplace), when documented. */
  distributionReview: z.string().default(""),
  /** Webhooks / data-deletion / compliance callbacks required, when documented. */
  complianceRequirements: z.array(z.string()).default([]),
  /** Pricing/plan gates affecting API or OAuth access. */
  pricingGates: z.string().default(""),
  /** Whether a newly-registered app is usable immediately or must be shared /
   * distributed before external users can authorize it (e.g. per-workspace vs
   * any-workspace, org-internal vs public, publishing/review status). Many
   * providers register an app that CANNOT be authorized by others until this is
   * configured — a silent launch blocker. Empty when not applicable. */
  distribution: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type AppReadiness = z.infer<typeof AppReadiness>;

/** Composio Managed Auth availability — SEPARATE metadata, never the primary
 * guide. "available" requires verified evidence that managed OAuth credentials
 * exist; a bare toolkit page is not sufficient. A failed probe is "unknown",
 * NOT "unavailable". */
export const ManagedAuth = z.object({
  availability: z.enum(["available", "unavailable", "unknown"]).default("unknown"),
  /** Verified toolkit/integration URL, when one resolved. */
  integrationUrl: httpUrl.nullable().default(null),
  /** The evidence/finding establishing availability. */
  sourceEvidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).default([]),
  /** Caveats: supported scopes, required credentials, branding, usage limits. */
  caveats: z.string().default(""),
});
export type ManagedAuth = z.infer<typeof ManagedAuth>;

/** Whether launch-blockers were actually assessed — so an empty array is not
 * silently rendered as "nothing launch-blocking". */
export const BlockerAssessment = z.enum([
  "assessed-none-found", // adequately assessed; no applicable blocker
  "blockers-found", // see knownBlockers[]
  "incomplete", // assessment was not adequate / evidence thin
]);
export type BlockerAssessment = z.infer<typeof BlockerAssessment>;


export const Implementation = z.object({
  /** Where a developer registers the app. Null when not established. */
  developerPortalUrl: httpUrl.nullable().default(null),
  authorizeUrl: httpUrl.nullable().default(null),
  tokenUrl: httpUrl.nullable().default(null),
  refreshUrl: httpUrl.nullable().default(null),
  revokeUrl: httpUrl.nullable().default(null),
  scopes: z.array(OAuthScope).default([]),
  /** Scopes the AUTHORIZATION SERVER advertises as supported (RFC 8414
   * `scopes_supported`) — the provider's full catalog, established from its own
   * metadata. Distinct from `scopes` (the use-case-specific recommendations):
   * being supported does NOT mean an integration needs it. Deterministic,
   * ledger-owned; the model never authors this. Empty = none advertised/found. */
  supportedScopes: z.array(z.string()).default([]),
  /** Format/constraints for the redirect URI (not a fabricated literal). */
  redirectUriRule: z.string().default(""),
  /** PKCE: support and requirement are INDEPENDENT. A flow can support PKCE
   * without requiring it. Keep `pkce` for backward compatibility (treated as
   * the requirement summary); the structured block below is authoritative. */
  pkce: PkceRequirement.default("unknown"),
  pkceDetail: PkceDetail.optional(),
  /** OAuth flow/grant requirements. */
  flow: OAuthFlow.optional(),
  /** Access-token lifetime; reuse the honest Estimate shape. */
  tokenLifetime: Estimate.nullable().default(null),
  /** Refresh-token + revocation lifecycle. */
  tokenLifecycle: TokenLifecycle.optional(),
  rateLimits: z.array(RateLimit).default([]),
  /** Sandbox / test-mode availability notes. */
  testMode: z.string().default(""),
  /** App registration, account/plan, and approval readiness. */
  appReadiness: AppReadiness.optional(),
  /** Provenance for the pack as a whole. */
  evidenceIds: z.array(z.string()).default([]),
  findingIds: z.array(z.string()).optional().default([]),
});
export type Implementation = z.infer<typeof Implementation>;

// ---------------------------------------------------------------------------
// OAuth journey — the canonical 7-step sequence every OAuth2 integration
// follows (register → grant type → authorize → callback/exchange → store →
// API request → refresh). Computed DETERMINISTICALLY by the pipeline from the
// Implementation facts + recommended path (never model-written), so snippets
// can't hallucinate endpoints. Each step carries whatever assist we can offer:
// a copyable code snippet, a per-step agent prompt, and a doc link. Honest by
// construction — a step whose facts aren't established says so.
// ---------------------------------------------------------------------------

export const CodeSnippet = z.object({
  /** e.g. "bash", "typescript". Drives syntax tab labels in the UI. */
  language: z.string().min(1),
  /** Short tab label, e.g. "cURL", "TypeScript". */
  label: z.string().min(1),
  code: z.string().min(1),
});
export type CodeSnippet = z.infer<typeof CodeSnippet>;

export const JourneyStepKey = z.enum([
  // Custom-OAuth flow (the classic 7 stages)
  "register",
  "grant-type",
  "authorize",
  "exchange",
  "store-tokens",
  "api-request",
  "refresh",
  // Managed-auth (Composio) flow
  "managed-connect",
  "managed-authorize",
  "managed-use",
]);
export type JourneyStepKey = z.infer<typeof JourneyStepKey>;

export const JourneyStep = z.object({
  key: JourneyStepKey,
  /** 1..n for display. */
  order: z.number().int(),
  /** Which auth path this journey describes. The whole journey is one path. */
  authPath: AuthPath.default("custom-oauth"),
  title: z.string().min(1),
  /** Plain-language what/why for this step. */
  summary: z.string().min(1),
  /** True when provider-specific facts for this step were established; false
   * means we show universal guidance + "confirm in the provider's docs". */
  established: z.boolean().default(false),
  snippets: z.array(CodeSnippet).default([]),
  /** A focused brief for a coding agent, scoped to just this step. */
  agentPrompt: z.string().nullable().default(null),
  /** Best doc link for this step, when we have one. */
  docUrl: httpUrl.nullable().default(null),
});
export type JourneyStep = z.infer<typeof JourneyStep>;

// ---------------------------------------------------------------------------
// The guide
// ---------------------------------------------------------------------------

export const Guide = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  providerName: z.string().min(1),
  providerUrl: httpUrl,
  description: z.string().min(1),

  recommendedPath: RecommendedPath,
  pathRationale: z.string().min(1),

  difficulty: Difficulty,
  activeEffort: Estimate,
  externalWaiting: Estimate,

  prerequisites: z.array(Prerequisite).default([]),
  setupSteps: z.array(SetupStep).default([]),
  approvalRequirements: z.array(ApprovalRequirement).default([]),
  knownBlockers: z.array(Blocker).default([]),
  /** Whether launch-blockers were adequately assessed. Prevents an empty
   * knownBlockers[] from being shown as "nothing launch-blocking". */
  blockerAssessment: BlockerAssessment.default("incomplete"),

  /** What the agent can handle end to end. */
  agentCapabilities: z.array(z.string()).default([]),
  /** What requires a human. */
  humanHandoff: z.array(z.string()).default([]),

  /** "What can you build?" — 3–5 evidence-backed provider capabilities,
   * developer-oriented, each linked to the scopes it needs. Optional/defaulted
   * so curated/older rows stay valid; honest-empty when none established. */
  capabilities: z.array(Capability).default([]),
  /** The developer's stated use case (echoed from the investigation input),
   * used to prioritize capabilities and tailor the agent brief. Server-set from
   * graph state, not model-authored. Empty when none was provided. */
  useCase: z.string().default(""),

  evidence: z.array(EvidenceRef).default([]),
  uncertainties: z.array(Uncertainty).default([]),

  /** Concrete, copyable OAuth implementation facts (endpoints, scopes,
   * token lifetime, rate limits, …). Optional so curated seeds and older
   * rows stay valid; honest nulls/empties where not established. */
  implementation: Implementation.optional(),

  /** Composio Managed Auth availability — SEPARATE metadata, never the primary
   * guide content. Optional so older rows stay valid. */
  managedAuth: ManagedAuth.optional(),

  /** The deterministic, evidence-backed fact ledger the guide was resolved
   * from. The single source of truth for important OAuth values; the overview,
   * checklist, implementation pack, and agent brief all reflect it. Optional so
   * curated/older rows stay valid. */
  facts: z.array(NormalizedFact).default([]),

  /** Investigator Findings backing this guide. Empty for curated/fast-pipeline
   * guides; populated when the guide was produced by the deep pipeline. */
  findings: z.array(Finding).default([]),

  lastResearchedAt: z.string().datetime(),
  status: GuideStatus,

  /** The single clearest next action for the developer. */
  nextAction: z.string().default(""),

  /** A copy-paste brief a developer can hand to a coding agent (Claude, Cursor,
   * Copilot) to implement the integration. Computed DETERMINISTICALLY by the
   * pipeline from the established decision + implementation facts — never
   * written by the model, so it cannot hallucinate endpoints. Null when the
   * guide lacks enough concrete facts to produce a genuinely useful brief. */
  agentPrompt: z.string().nullable().optional().default(null),

  /** The canonical 7-step OAuth journey, computed deterministically from the
   * implementation facts. Empty for curated/older guides without an
   * implementation block. */
  journey: z.array(JourneyStep).optional().default([]),
});
export type Guide = z.infer<typeof Guide>;

/**
 * Shape Gemini is asked to produce. It omits server-controlled fields
 * (id/slug/timestamp/status), the deterministically-computed agentPrompt and
 * journey, and the deterministically-built fact ledger + managed-auth metadata
 * — so the model cannot fabricate identifiers, a generation time, the brief,
 * the step snippets, a fact's provenance, or managed-auth availability.
 */
export const GeneratedGuide = Guide.omit({
  id: true,
  slug: true,
  lastResearchedAt: true,
  status: true,
  agentPrompt: true,
  journey: true,
  facts: true,
  managedAuth: true,
  // useCase is echoed from the investigation input by the server, not authored
  // by the model.
  useCase: true,
});
export type GeneratedGuide = z.infer<typeof GeneratedGuide>;

export function safeParseGuide(data: unknown) {
  return Guide.safeParse(data);
}
