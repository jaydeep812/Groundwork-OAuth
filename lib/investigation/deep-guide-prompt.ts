import { Type } from "@google/genai";
import type { Finding } from "@/lib/schema/guide";
import { SCHEMA_APPENDIX } from "@/lib/gemini/prompts";

/**
 * Synthesis prompt for turning investigator Findings into a Guide.
 *
 * The model's job is NARROW: produce the Guide fields that aren't automatic
 * (description, difficulty, effort, steps, approvals, blockers, etc.) using
 * ONLY what the Findings established. Every claim-bearing object MUST cite
 * the Finding ids that back it in findingIds. The pipeline scrubs dangling
 * references and reclassifies evidence source types regardless.
 */

export const DEEP_GUIDE_SYSTEM_PROMPT = `You are a senior integrations engineer turning the raw output of five independent investigator agents into a Guide a developer can act on.

AUTHORITATIVE vs NON-AUTHORITATIVE
- A Finding has an "outcome" field: "confirmed" (agent directly observed), "supports" (authoritative sources back the claim), "insufficient" (couldn't resolve), "failed", "skipped", "contradicts". Treat only "confirmed" and "supports" as grounded. Treat "insufficient"/"failed"/"skipped" questions as uncertainties — do NOT fabricate conclusions.
- Each Finding has evidence URLs with a sourceType ("official-docs"/"developer-portal" = on the provider's own domain; "composio-docs" = Composio-owned; "third-party-integration" = Nango/Clerk/OpenAlgo/etc.; "community" = forums/blogs). Prefer authoritative sources.

GROUNDING RULES
- For each setupStep, prerequisite, approvalRequirement, knownBlocker, uncertainty, difficulty, activeEffort, externalWaiting: populate findingIds with the ids of the Findings that back it. If nothing backs it, do NOT include it.
- Every URL you include in evidence[] must come from a Finding's evidence[] in the input. Copy it exactly.
- Never invent redirect URIs, scope names, API hosts, client IDs. If a specific value isn't quoted in authoritative Finding evidence, set suggestedValue to null and set missingInfo=true.
- When a provider doesn't use OAuth2 scopes (for example Kite Connect uses api_key + checksum), state that in the step/field description rather than making up scope names.
- Secrets never go in the guide output: no client secrets, access tokens, refresh tokens, passwords.

PATH DECISION
- This is always a custom OAuth readiness guide: recommendedPath is "custom-oauth" for any provider that uses OAuth2 for user authorization.
- Composio Managed Auth availability (the catalog-agent Finding) is SUPPLEMENTARY metadata — it is a convenience shortcut, NOT the recommended path and NOT a reason to omit or shorten the custom OAuth guide. Do NOT set recommendedPath to "managed-auth". If Composio supports the provider, note it as a brief convenience mention (and its toolkit URL as evidence); still produce the full custom guide.
- If the provider uses a non-OAuth2 flow (custom token exchange, API key only, SAML, etc.), set recommendedPath to "other" and explain in pathRationale.

SETUP STEPS — one coherent custom OAuth path (do not branch)
- Every setupStep MUST set "authPath": "custom-oauth" (or "both" for steps that apply regardless, e.g. "make an API request").
- Describe the single custom OAuth flow: register the provider OAuth app, configure redirect URIs, request scopes, exchange the code, store and refresh tokens. Do NOT emit a parallel "managed" set of steps or conditional branches that contradict the custom steps.

PKCE — do not assume, and support ≠ requirement
- Set implementation.pkce to "required" or "supported" ONLY when a Finding's authoritative evidence explicitly says the provider's OAuth flow uses PKCE. If the docs do not mention PKCE, set "not-supported" when they describe a client-secret flow without it, otherwise "unknown". NEVER set "required"/"supported" just because PKCE is a modern best practice.
- PKCE SUPPORT and PKCE REQUIREMENT are independent and requirement is often CONDITIONAL. Use implementation.pkceDetail = { supported, required ("yes"/"no"/"unknown"), methods (e.g. ["S256"]), appliesTo }. If the docs require PKCE only for certain redirect URIs or client types (e.g. "required for localhost / 127.0.0.1 / native-app redirect URIs; recommended otherwise"), set required="yes" and put that exact condition in appliesTo — do NOT flatten a conditional requirement to "supported" or to an unconditional "required". When PKCE is used, include code_verifier in the token-exchange description.

SCOPES — register, don't imply, don't over-require
- Requested scopes usually must be REGISTERED/selected in the provider's developer console before they can be requested; requesting an unregistered scope typically fails (e.g. a forbidden/invalid_scope error). Say this in the register/configure step when the evidence supports it.
- Scopes do NOT imply one another (e.g. a ":write" scope does not grant ":read"). Never assume a broad scope covers a narrower one.
- Mark a scope required=true ONLY when the DEVELOPER'S USE CASE needs it. Treat the displayed scope list as use-case-specific recommendations / examples, NOT universal requirements, and never mark a provider's full-access scope required just because it exists.

APP DISTRIBUTION / AVAILABILITY — a silent launch blocker
- For many providers, registering an app does NOT make it usable by others: it must be shared/distributed (per-workspace vs any-workspace), made public vs org-internal, or submitted for App-Directory/marketplace publication — these are SEPARATE decisions. If the evidence shows this, add a setupStep (category "provider-approval" or "configure-integration") titled like "Configure app distribution" explaining testing-in-specific-workspaces vs allowing any workspace, and fill implementation.appReadiness.distribution. If not configured, external users may be unable to authorize the app even though OAuth is wired correctly — surface that as a knownBlocker when it applies.

STEP CATEGORIES
Each setupStep has a category:
  register-provider-app, configure-integration, authorize-user, verify-data-access, provider-approval.
Produce a few concrete steps per applicable category. Omit a category entirely when the Findings don't support it (e.g. no provider-approval step when no approval process is evidenced).

FIRST AUTHORIZED REQUEST — post-authorization operational requirements
- OAuth setup does not end at the token exchange. When the evidence documents provider-specific requirements for the FIRST usable authenticated API request, add a "verify-data-access" setupStep capturing them. Examples: account/workspace/tenant DISCOVERY and selection after authorization (the token alone isn't enough to know which account to call), a required identifying User-Agent (or other mandatory header), a provider-specific API BASE URL distinct from the OAuth host, or an initial account/plan/workspace prerequisite.
- Include such a requirement ONLY when the evidence supports it and it applies to this provider. Do NOT invent generic steps and present them as provider-specific — an unsupported "set a User-Agent" step is worse than none.

AGENT-vs-HUMAN
- agentCapabilities: things the developer's agent code can do once credentials exist (make API calls, parse responses, store tokens). Keep concrete.
- humanHandoff: things a person must do (log into dashboard, enter payment info, pass MFA, submit approval forms).

WHAT CAN YOU BUILD (capabilities[])
- Produce 3–5 developer-oriented capabilities describing what someone can BUILD with this provider's API (e.g. "Read and create project tasks", "Sync calendar events"), NOT a raw endpoint dump. Fewer is fine; emit NONE rather than padding with unverified ones.
- For each: title; summary (1–2 sentences); dataAndActions (which resources can be read/created/updated/deleted, as documented); requiredAccess (the scope NAMES or permissions it needs — may be empty when the provider uses a non-scope permission model); limitations (approval, plan gates, rate/access conditions); docUrl (the official API-reference URL supporting it — only when it appears in evidence, else omit); evidenceIds/findingIds.
- GROUND every capability: each must cite a Finding (confirmed/supports) or authoritative evidence. Do NOT invent capabilities, resources, scope mappings, or doc links. A provider EXPOSING an API operation does NOT mean an integration can use it — describe provider capability, and let requiredAccess name what must be requested; never imply automatic access.
- When a use case is provided (see the user prompt), ORDER the capabilities with the most relevant first and make requiredAccess reflect the MINIMUM scopes that use case needs — but still include a few adjacent capabilities (aim for 3–5 total) so the developer sees the provider's broader range, not just one row.

IMPLEMENTATION PACK
- Populate the "implementation" object with the concrete OAuth facts the Findings established: developerPortalUrl, authorizeUrl, tokenUrl, refreshUrl, revokeUrl, scopes[], redirectUriRule, pkce, tokenLifetime, rateLimits[], testMode.
- Set a URL ONLY when a Finding's evidence quotes it. Otherwise null — never guess from a pattern. scopes[] only from authoritative Findings; empty when the provider has no OAuth2 scopes. pkce defaults to "unknown". Each implementation field may carry findingIds.
- authorizeUrl/tokenUrl/refreshUrl/revokeUrl are the BARE endpoints (scheme+host+path) — never include query parameters like "?response_type=code"; those are request params shown separately. When the provider documents refresh at the token endpoint (grant_type=refresh_token), set refreshUrl to the token endpoint rather than leaving it null.
- A deterministic fact ledger runs AFTER you and will OVERRIDE endpoints/PKCE with authoritative values, so do not guess these — leave them null if unsure. The ledger also records the provider's advertised scope catalog (supportedScopes) from its own OAuth metadata, so only list a scope in scopes[] when a Finding quotes its name — never invent scope names to pad the list.

STRUCTURED OAUTH DETAIL (optional sub-objects — populate ONLY from authoritative evidence, else omit the field)
- implementation.pkceDetail: { supported: "yes"|"no"|"unknown", required: "yes"|"no"|"unknown", methods: string[] }. Keep SUPPORT and REQUIREMENT independent — never set required="yes" just because PKCE is supported, and never collapse them.
- implementation.flow: { grantTypes[], responseTypes[], tokenEndpointAuthMethods[], clientType: "public"|"confidential"|"unknown" }.
- implementation.tokenLifecycle: { refreshTokenIssued, refreshTokenRotates, refreshTokenSingleUse, revocationSupported (each "yes"|"no"|"unknown"), refreshTokenLifetime (Estimate|null), tokenType, presentation }. Do NOT assume refresh tokens are issued or rotate — use "unknown" unless documented.
- For each scope, set required=true ONLY when the DEVELOPER'S USE CASE needs it; set requiresApproval=true only when the docs say the scope needs review; fill enables/narrowerAlternative when documented. Never mark a full-access scope required just because it exists.
- implementation.appReadiness: { accountRequirements, requiredAppFields[], environments, testUserLimits, scopeApproval, distributionReview, complianceRequirements[], pricingGates } — only fields the evidence supports.

ESTIMATES — never overstate confidence
- activeEffort (hands-on setup time) is ALWAYS a planning estimate: kind MUST be "estimate" or "inference" (or "unknown"), NEVER "verified"/"observed", even if the setup steps themselves are confirmed.
- externalWaiting (waiting on the provider): set kind="verified" ONLY if the PROVIDER's own docs publish a timeline you can cite. When a finding reports an approval/verification turnaround figure from a community or third-party source (e.g. "developers report Google verification takes 2-6 weeks"), DO record it as externalWaiting with kind="estimate" or "inference" and cite that finding's evidence — a community-reported duration is useful signal and must not be dropped to "unknown". What you must NOT do is fabricate a number from the mere existence of an approval process with no source at all. Same rule for approvalRequirements[].timeline.
- CRUCIAL: externalWaiting is the wait that applies to the DEVELOPER'S OWN integration reaching launch. If a review only applies to an OPTIONAL path the developer need not take (e.g. listing on a public marketplace, publishing an app others install, org-owned app approval) and the base integration works with no wait, DO NOT put that optional review's duration in externalWaiting — leave externalWaiting unknown and record the optional review as an approvalRequirement with required=false instead. A self-serve provider with no mandatory review must read as no wait, not an inflated one.

BLOCKERS — assessed vs empty
- Set "blockerAssessment" to "blockers-found" (list them in knownBlockers), "assessed-none-found" (you looked and found none), or "incomplete" (not adequately assessed). Do NOT leave knownBlockers empty and imply there are none unless you set "assessed-none-found". A prerequisite is NOT a launch blocker unless it actually prevents reaching launch.

Output ONLY JSON matching the provided schema. Use stable kebab-case ids. Keep text concrete and short — a developer should be able to scan it.`;

export function buildDeepGuideUserPrompt(opts: {
  providerName: string;
  providerUrl: string;
  providerDomains: string[];
  useCase: string;
  findings: Finding[];
  /** Additional web evidence (base sweep + any re-planned searches). Used to
   * fill the implementation pack when the agents returned "insufficient". */
  evidence?: { id: string; sourceType: string; url: string; title: string; content: string }[];
}): string {
  const findingsBlock = opts.findings
    .map((f) => {
      const evLines = f.evidence
        .map((e) => `    - [${e.sourceType}] ${e.url} :: ${(e.snippet || "").slice(0, 220)}`)
        .join("\n");
      return `[${f.id}] agent=${f.agent} outcome=${f.outcome} kind=${f.attemptKind}
Q: ${f.question}
TRIED: ${f.attempted}
CONCLUSION: ${f.conclusion}
OBSERVED: ${f.observation || "(none)"}
UNCERTAIN: ${f.uncertainty || "(none)"}
EVIDENCE:
${evLines || "    (none)"}`;
    })
    .join("\n\n");

  const evidenceBlock = (opts.evidence ?? [])
    .map((e) => `[${e.id}] (${e.sourceType}) ${e.title}\nURL: ${e.url}\nEXCERPT: ${(e.content || "").slice(0, 700)}`)
    .join("\n\n");

  return `PROVIDER: ${opts.providerName}
PROVIDER URL: ${opts.providerUrl}
PROVIDER DOMAIN(S): ${opts.providerDomains.join(", ") || "unknown"}
DEVELOPER USE CASE: ${opts.useCase || "(not specified)"}

AGENT FINDINGS (${opts.findings.length}):
${findingsBlock}

ADDITIONAL WEB EVIDENCE (${(opts.evidence ?? []).length}) — use to populate the implementation pack (endpoints, scopes, token lifetime, rate limits) when the Findings are insufficient. Cite by id in evidenceIds. Only quote URLs that appear here or in a Finding:
${evidenceBlock || "(none)"}

Produce the Guide JSON. Every claim-bearing object (setupSteps, prerequisites, approvalRequirements, knownBlockers, uncertainties, difficulty, activeEffort, externalWaiting) MUST cite at least one of the finding ids above in its findingIds array. The implementation pack may be backed by the ADDITIONAL WEB EVIDENCE via evidenceIds. If no Finding or authoritative evidence backs a potential claim, record it as an uncertainty instead of fabricating it. Set an endpoint URL only when it appears verbatim in the evidence above — never guess from a pattern.
${SCHEMA_APPENDIX}`;
}

// ---------------------------------------------------------------------------
// Structured-output schema for the deep guide path. Mirrors GeneratedGuide
// but allows findingIds on claim-bearing objects.
// ---------------------------------------------------------------------------

const estimate = {
  type: Type.OBJECT,
  properties: {
    kind: { type: Type.STRING, enum: ["verified", "observed", "estimate", "inference", "unknown"] },
    value: { type: Type.NUMBER, nullable: true },
    unit: { type: Type.STRING, enum: ["minutes", "hours", "days"], nullable: true },
    rationale: { type: Type.STRING },
    evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["kind", "rationale"],
};

const evidenceRef = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: { type: Type.STRING },
    url: { type: Type.STRING },
    snippet: { type: Type.STRING },
    sourceType: {
      type: Type.STRING,
      enum: [
        "official-docs",
        "developer-portal",
        "composio-docs",
        "third-party-integration",
        "community",
        "unknown",
      ],
    },
  },
  required: ["id", "title", "url"],
};

const setupField = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    label: { type: Type.STRING },
    required: { type: Type.BOOLEAN },
    description: { type: Type.STRING },
    suggestedValue: { type: Type.STRING, nullable: true },
    provenance: {
      type: Type.STRING,
      enum: ["developer-input", "environment-derived", "provider-issued"],
    },
    validation: { type: Type.STRING },
    missingInfo: { type: Type.BOOLEAN },
  },
  required: ["id", "label", "provenance"],
};

const setupStep = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: { type: Type.STRING },
    category: {
      type: Type.STRING,
      enum: [
        "register-provider-app",
        "configure-integration",
        "authorize-user",
        "verify-data-access",
        "provider-approval",
      ],
    },
    instructions: { type: Type.STRING },
    rationale: { type: Type.STRING },
    required: { type: Type.BOOLEAN },
    appliesWhen: { type: Type.STRING, nullable: true },
    fields: { type: Type.ARRAY, items: setupField },
    expectedOutcome: { type: Type.STRING },
    verification: { type: Type.STRING },
    recovery: { type: Type.STRING },
    executionMode: { type: Type.STRING, enum: ["manual", "agent-assisted", "automatable"] },
    evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["id", "title", "category", "instructions", "executionMode"],
};

export const DEEP_GUIDE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    providerName: { type: Type.STRING },
    providerUrl: { type: Type.STRING },
    description: { type: Type.STRING },
    recommendedPath: { type: Type.STRING, enum: ["managed-auth", "custom-oauth", "other"] },
    pathRationale: { type: Type.STRING },
    difficulty: {
      type: Type.OBJECT,
      properties: {
        rating: { type: Type.STRING, enum: ["easy", "moderate", "hard", "unknown"] },
        rationale: { type: Type.STRING },
        findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["rating", "rationale"],
    },
    activeEffort: estimate,
    externalWaiting: estimate,
    implementation: {
      type: Type.OBJECT,
      properties: {
        developerPortalUrl: { type: Type.STRING, nullable: true },
        authorizeUrl: { type: Type.STRING, nullable: true },
        tokenUrl: { type: Type.STRING, nullable: true },
        refreshUrl: { type: Type.STRING, nullable: true },
        revokeUrl: { type: Type.STRING, nullable: true },
        scopes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              required: { type: Type.BOOLEAN },
              evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["name"],
          },
        },
        redirectUriRule: { type: Type.STRING },
        pkce: { type: Type.STRING, enum: ["required", "supported", "not-supported", "unknown"] },
        tokenLifetime: { ...estimate, nullable: true },
        rateLimits: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              limit: { type: Type.STRING },
              window: { type: Type.STRING },
              scope: { type: Type.STRING },
              note: { type: Type.STRING },
              evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["limit"],
          },
        },
        testMode: { type: Type.STRING },
        evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
    prerequisites: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          description: { type: Type.STRING },
          evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["id", "description"],
      },
    },
    setupSteps: { type: Type.ARRAY, items: setupStep },
    approvalRequirements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          timeline: { ...estimate, nullable: true },
          required: { type: Type.BOOLEAN },
          evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["id", "title", "description"],
      },
    },
    knownBlockers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["id", "title", "description"],
      },
    },
    agentCapabilities: { type: Type.ARRAY, items: { type: Type.STRING } },
    humanHandoff: { type: Type.ARRAY, items: { type: Type.STRING } },
    capabilities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          dataAndActions: { type: Type.STRING },
          requiredAccess: { type: Type.ARRAY, items: { type: Type.STRING } },
          limitations: { type: Type.STRING },
          docUrl: { type: Type.STRING },
          evidenceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title"],
      },
    },
    evidence: { type: Type.ARRAY, items: evidenceRef },
    uncertainties: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          question: { type: Type.STRING },
          resolution: { type: Type.STRING },
          kind: {
            type: Type.STRING,
            enum: ["verified", "observed", "estimate", "inference", "unknown"],
          },
          findingIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["id", "question"],
      },
    },
    nextAction: { type: Type.STRING },
  },
  required: [
    "providerName",
    "providerUrl",
    "description",
    "recommendedPath",
    "pathRationale",
    "difficulty",
    "activeEffort",
    "externalWaiting",
    "setupSteps",
    "evidence",
    "nextAction",
  ],
};
