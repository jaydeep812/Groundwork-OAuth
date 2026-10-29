/**
 * The OUTPUT JSON SHAPE appended to the synthesis prompt.
 *
 * The graph uses Gemini's JSON mode WITHOUT passing a response schema to the
 * SDK (our former @google/genai Type-enum schema used uppercase type names and
 * is not standard JSON Schema). Zod (`GeneratedGuide`) remains the authority.
 *
 * Beyond listing keys, each field carries a short PM-authored QUALITY directive
 * ("what good looks like") so the model fills the guide the way a developer
 * would want to read it — organized around the Decide → Prepare → Build →
 * Verify → Ship journey. Keys/shape are unchanged; this only steers content.
 */

export const SCHEMA_APPENDIX = `
OUTPUT JSON SHAPE — produce exactly these keys. The // notes say what a GOOD value looks like for a developer; follow them. Omit optional keys only when genuinely empty.
{
  // WHO — confirm the reader is in the right place.
  "providerName": string,
  "providerUrl": string,                 // the provider's own site; never a third party's
  "description": string,                 // one scannable paragraph: what this is + what you can build with it

  // DECIDE — the go/no-go block. A developer should be able to choose a path from here alone.
  "recommendedPath": "managed-auth" | "custom-oauth" | "other",
  "pathRationale": string,               // WHY this path, citing what was actually observed — not generic advice

  "difficulty": { "rating": "easy"|"moderate"|"hard"|"unknown", "rationale": string, "findingIds"?: string[] },

  // DECIDE (cost) — keep hands-on work separate from waiting-on-the-provider; developers plan them differently.
  "activeEffort": { "kind": "verified"|"observed"|"estimate"|"inference"|"unknown", "value": number|null, "unit": "minutes"|"hours"|"days"|null, "rationale": string, "evidenceIds"?: string[], "findingIds"?: string[] },  // hands-on dev time
  "externalWaiting": { ...same shape as activeEffort... },   // calendar time blocked on review/approval; value:null if none/unknown

  // BUILD (reference) — the highest-value block for shipping speed: concrete, copy-pasteable OAuth facts.
  // Honesty is strict here: a URL appears ONLY if quoted verbatim in evidence; otherwise null. Never guess from a pattern.
  "implementation": {
    "developerPortalUrl": string|null,   // where to register the app
    "authorizeUrl": string|null, "tokenUrl": string|null, "refreshUrl": string|null, "revokeUrl": string|null,
    "scopes": [ { "name": string, "description": string, "required": boolean, "evidenceIds"?: string[], "findingIds"?: string[] } ],  // scopes relevant to the use case; mark which are required. Empty [] is valid+meaningful (provider may not use scopes) — then note it in uncertainties
    "redirectUriRule": string,           // the FORMAT/constraints (e.g. "https only except http://localhost; must exactly match a registered value") — never a fabricated literal URI
    "pkce": "required"|"supported"|"not-supported"|"unknown",   // "unknown" unless evidence states it
    "tokenLifetime": { ...Estimate... }|null,
    "rateLimits": [ { "limit": string, "window": string, "scope": string, "note": string, "evidenceIds"?: string[], "findingIds"?: string[] } ],  // limit as a string (providers phrase these many ways); never coerce a fabricated number
    "testMode": string,                  // sandbox/dev-workspace availability for testing before production
    "evidenceIds"?: string[], "findingIds"?: string[]
  },

  // PREPARE — what must be true before step 1 (accounts, plans, entitlements). Stops the developer hitting a wall mid-way.
  "prerequisites": [ { "id": string, "description": string, "evidenceIds"?: string[], "findingIds"?: string[] } ],

  // BUILD (do) — the ordered, actionable spine. Each step is SELF-CONTAINED: what to do, what should happen,
  // how to confirm, and what to do if it breaks. Grouped by category (phase), in this order.
  "setupSteps": [ { "id": string, "title": string, "category": "register-provider-app"|"configure-integration"|"authorize-user"|"verify-data-access"|"provider-approval", "authPath": "managed-auth"|"custom-oauth"|"both" /* which auth path this step belongs to; see the MANAGED-AUTH vs CUSTOM-OAUTH rules */, "instructions": string /* concrete: where to go, what to click/enter */, "rationale"?: string, "required"?: boolean, "appliesWhen"?: string|null /* condition for conditional steps, e.g. "only for multi-tenant apps" */, "fields"?: [ { "id": string, "label": string, "required"?: boolean, "description"?: string, "suggestedValue": string|null /* copyable literal ONLY if quoted in evidence; never a secret */, "provenance": "developer-input"|"environment-derived"|"provider-issued", "validation"?: string, "missingInfo"?: boolean } ], "expectedOutcome"?: string /* what success looks like */, "verification"?: string /* how to confirm it worked */, "recovery"?: string /* what to do if it fails — the line a developer needs at 2am */, "executionMode": "manual"|"agent-assisted"|"automatable", "evidenceIds"?: string[], "findingIds"?: string[] } ],

  // SHIP — provider gates between "works in testing" and "works for real users". These carry calendar time, not code time.
  "approvalRequirements": [ { "id": string, "title": string, "description": string, "timeline"?: Estimate|null, "required"?: boolean, "evidenceIds"?: string[], "findingIds"?: string[] } ],

  // SHIP (risk) — things that will stop or slow the developer. Put the single worst one first.
  "knownBlockers": [ { "id": string, "title": string, "description": string, "evidenceIds"?: string[], "findingIds"?: string[] } ],

  // BUILD (division of labor) — this product connects providers to AI AGENTS, so be specific:
  "agentCapabilities": string[],         // what the agent can do unattended once credentials exist (API calls, parse, refresh)
  "humanHandoff": string[],              // what a person must do at least once (dashboard login, payment, MFA, approval forms)

  // WHAT CAN YOU BUILD — 3–5 evidence-backed, developer-oriented capabilities (not an endpoint dump); omit if unverified.
  "capabilities": [ { "title": string, "summary"?: string, "dataAndActions"?: string, "requiredAccess"?: string[], "limitations"?: string, "docUrl"?: string, "evidenceIds"?: string[], "findingIds"?: string[] } ],

  // TRUST — every source consulted, tiered by authority so the reader can weigh each claim.
  "evidence": [ { "id": string, "title": string, "url": string, "snippet": string, "sourceType": "official-docs"|"developer-portal"|"composio-docs"|"third-party-integration"|"community"|"unknown" } ],

  // TRUST — what the research could NOT establish, as questions + how to resolve them. Admitting gaps beats bluffing.
  "uncertainties": [ { "id": string, "question": string, "resolution"?: string /* concrete next step to close the gap */, "kind"?: string, "findingIds"?: string[] } ],

  // START HERE — the ONE clearest first move, so a convinced developer can act without re-reading everything.
  "nextAction": string
}
Output ONLY this JSON object. No markdown fences, no commentary.`;

