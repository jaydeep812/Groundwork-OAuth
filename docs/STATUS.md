# Status

Last updated: 2026-10-28 (iteration 5)

## Iteration 5 — LangGraph research graph + Implementation Pack

**Assignment-constraint note:** the original brief said "no LangGraph / multi-agent
framework." The user explicitly chose to waive this and adopt LangGraph for real
(one graph serving both modes, LangChain Gemini connector, completeness critic that
re-plans and re-searches). This iteration honors that decision.

### Two problems addressed

1. **The guide didn't give a developer what they need to implement.** Endpoints,
   scopes, redirect-URI rules, PKCE, token lifetime, and rate limits were absent or
   buried in prose. Now there is a first-class `implementation` block on the Guide
   and an Implementation Pack section on the page (copyable, honest nulls).
2. **The pipeline couldn't fill those gaps.** The old engine did a fixed Tavily
   sweep then one synthesis. Now a LangGraph graph plans targeted queries, fans out
   the five agents, synthesizes, runs a completeness critic, and loops back to
   re-plan/re-search the missing fields (capped at `MAX_LOOPS = 2`).

### The research graph (`lib/graph/`)

- **One graph, both modes** (`lib/graph/run.ts`). Fast = reflection disabled (never
  loops). Deep = reflection on (loops until the critic is satisfied or MAX_LOOPS).
- **Nodes**: `normalize → plan → search → (deep ? investigate : synthesize) →
  critic → (done ? persist : plan)`. Grounding is folded into `persist`.
  - `plan` (`nodes/plan.ts`): loop 0 is deterministic (base queries + endpoint/rate
    queries); re-plan loops ask the LangChain Gemini connector for queries targeting
    ONLY the critic's missing fields, with a deterministic fallback.
  - `search` (`nodes/search.ts`): `tavilySearchMany`, domain establishment +
    Composio probe (loop 0 only), evidence accumulates+dedupes across loops.
  - `investigate` (`nodes/investigate.ts`): the five agents via `Promise.allSettled`
    (loop 0 only — agents are expensive HTTP probes).
  - `synthesize` (`nodes/synthesize.ts`): LangChain Gemini (`generateJsonLC`) in JSON
    mode; deep mode now ALSO passes ranked web evidence so re-planned searches can
    fill the implementation pack when agents returned "insufficient". A
    `sanitizeDraft` step prunes malformed claim entries and coerces out-of-enum
    values before Zod, so one stray field never discards a good guide.
  - `critic` (`critique.ts`): deterministic presence check over the implementation
    pack + setup steps. No LLM. Returns `{complete, missing[], score}`.
  - `persist` (`nodes/persist.ts`): grounds via the shared `ground.ts` walker,
    embeds findings (deep), assembles, validates the full `Guide`, upserts.
- **LLM access** (`lib/graph/llm.ts`): `@langchain/google-genai`
  `ChatGoogleGenerativeAI`, JSON mode, one retry on transient errors. We do NOT pass
  our `@google/genai` Type-enum schemas to `withStructuredOutput` (they use uppercase
  type names and aren't standard JSON Schema); the output shape is described in a
  `SCHEMA_APPENDIX` and Zod remains the authority.

### Retired / consolidated

- `lib/research/pipeline.ts` and `lib/investigation/orchestrator.ts` **deleted**.
  Their pure helpers moved to `lib/research/helpers.ts` (`buildQueries`,
  `rankEvidence`, `determineProviderDomain(s)`, `probeComposioManagedAuth`,
  `mergeComposioEvidence`, `normalizeInput`). The duplicated input-normalization and
  scrub/ground logic is now defined once (`normalizeInput`, `lib/graph/ground.ts`).
- Both routes (`/api/investigate`, `/api/investigation`) call `runGraph(..., {mode})`.

### Schema (`lib/schema/guide.ts`)

- New `Implementation` block (+ `OAuthScope`, `RateLimit`, `PkceRequirement`): all
  fields optional/nullable, honest — a null endpoint / empty list means "not
  established", never fabricated. `Guide.implementation` is optional so curated seeds
  and older rows stay valid.

### UI (`components/implementation-pack.tsx`)

- Implementation Pack rendered below the hero when `guide.implementation` exists.
  Endpoint rows with copy buttons, copyable scope chips, redirect-URI rule, PKCE
  badge, token-lifetime (with ClaimKindBadge), rate-limit table. Empty slots show an
  honest "not established" chip. Reuses `CopyButton`, `WhyWeKnow`, badges. The trust
  sections below (findings, uncertainties, audit log) are unchanged.

### Verified live (gemini-3.6-flash + Tavily)

- Fast Slack run: 200 OK, pack rendered, scopes + redirect rule populated, endpoints
  honestly null (not re-searched in fast mode).
- Deep Slack run (~88s, within the 60–180s envelope): the re-plan loop filled
  authorizeUrl, scopes (commands, incoming-webhook, channels:*), a VERIFIED 12h token
  lifetime (rotation) backed by a findingId, 2 rate limits, redirect-URI rule, PKCE
  "supported"; 10 findings embedded, all 3 steps cite findingIds; tokenUrl stayed
  null (genuinely not in retrieved evidence — honest). Page renders 200 with 7 "Why"
  badges, copy buttons, and the audit log.
- `tsc --noEmit` clean; `npm test` → **9 files / 70 tests**; `next build` passes
  (5 routes). Dev DB cleaned of test pollution: 3 curated + 7 generated guides.

### Known gaps (iteration 5)

- Deep mode adds LLM calls (one synthesis per loop + one re-plan query call per
  extra loop). On the free `gemini-3.6-flash` tier (20 req/day/project) this can
  exhaust quota quickly — rotate to a new project key or enable billing for heavy
  testing.
- The critic is a presence check, not a correctness check: it drives the loop toward
  filling fields but can't tell a wrong endpoint from a right one. Zod + the "only
  quote URLs present in evidence" rule are the guards against fabrication.
- `tokenUrl` and other fields can remain null when the provider's own docs weren't
  surfaced by any query — reported honestly rather than guessed.

---

# Status (iteration 4 and earlier)

Last updated: 2026-10-28 (iteration 4)

## Verified end-to-end

- **Build & types** — `npm run build` passes; `tsc --noEmit` clean.
- **Tests** — `npm test` → **7 files / 62 tests passing**.
- **Live research** — both pipelines route to the same destination (`/guides/<slug>`):
  - `POST /api/investigate` — single-pass Gemini synthesis, ~30–60s.
  - `POST /api/investigation` — five agents in parallel + synthesis, ~60–180s. The resulting guide **embeds the Findings** so every claim shows "how we know".
- **Live Kite Connect unified investigation** — 10 Findings produced by 5 agents, zero fabricated sources, zero warnings. Every claim on the guide (steps, blockers, approvals, uncertainties, difficulty, effort, waiting) cites one or more `findingIds` that resolve to a real embedded Finding. ₹2,000 pricing, 10 req/s order rate limit, multi-tenant approval process, and the mandatory TOTP constraint are all surfaced with per-claim "Why: supported by sources ▾" affordances linking to the backing agent and observation.

## Iteration 4 — one page per provider, report is the engine

In iteration 3 the deep investigation produced a separate `/reports/<slug>` page. That split the actionable material (categorized setup steps, copyable fields) from the receipts (what the agents did and observed). A developer landing on a provider had to pick between two pages and neither on its own was enough.

The unification:

- **Guide schema gained a `findings: Finding[]` field** at the top level, plus optional `findingIds: string[]` on every claim-bearing object (`Difficulty`, `Estimate`, `Prerequisite`, `SetupStep`, `ApprovalRequirement`, `Blocker`, `Uncertainty`). `findingIds` is optional so curated seeds remain valid.
- **The deep orchestrator now produces a Guide** (not a separate Report). It runs the same five agents, then synthesizes with a new prompt (`deep-guide-prompt.ts`) that fills in `findingIds` on every claim. The pipeline then scrubs dangling `findingIds` and `evidenceIds` post-synthesis.
- **The guide page gained a `<WhyWeKnow>` component** that renders a small outcome-colored badge next to each claim. Clicking expands a block with the backing Finding(s): what the agent did, the observation, and the evidence links. Shows nothing when `findingIds` is empty (curated seeds and fast-pipeline guides look identical to before).
- **The guide page gained a `<AuditLog>` section** at the bottom — collapsed by default — that lists every Finding grouped by agent for a developer who wants to scan everything the pipeline did.
- **`/reports/[slug]` route deleted** (route, page, not-found, API bookkeeping, DB table). `lib/schema/report.ts`, `lib/db/reports.ts`, `lib/investigation/synth-prompt.ts`, `tests/report-schema.test.ts` all removed. One shareable URL per provider.
- **The investigate form kept its toggle** (deep vs guide-only) because the fast single-pass pipeline is still useful for providers you want to look up quickly; both redirect to `/guides/<slug>`.

### Seed-data typing refactor

Zod v4's `.default([])` produces a *required* output type while the input type is optional. Seed data was failing typecheck because I was treating it as the output type. Fix: `seed-data.ts` now types its array as `z.input<typeof Guide>[]`, matching what `Guide.safeParse(...)` consumes. The parse call at seed time still fills in all defaults.

### What the UI now looks like for Kite

Rendered page sections, top to bottom:

1. **Hero summary** — path (`other` — Kite is non-OAuth2), difficulty (`moderate` with 5 backing findings), active effort (3 findings), external waiting (1 finding), main blocker ("API Rate Limits", 1 finding), next action.
2. **Prerequisites** — each with `[source]` links.
3. **Setup steps** grouped by category (Register / Configure / Authorize / Verify). Each step card ends with a `Why: confirmed by agent ▾` button that expands the backing Findings.
4. **What an agent can help with / What needs a human.**
5. **Approval & production requirements** — "Multi-Tenant Application Approval", with the `[source]` link to the kite.trade forum thread AND the Why popover linking to `constraints-agent`'s search.
6. **Known blockers** — "API Rate Limits" (10 req/s order placement) and "Subscription Charges" (₹2,000 brokerage threshold). Both have Why popovers linking to the specific constraint finding.
7. **Open questions & uncertainty** — three questions, each labelled with `Why: not fully established ▾` so a developer can see WHICH agent couldn't resolve it (portal-agent / catalog-agent / auth-endpoint-agent).
8. **Sources** — color-coded trust tiers.
9. **What the agents actually did** — collapsed; expands to the full audit log, grouped by agent.

## Known gaps & limitations

- **No sandbox-call verification.** We probe endpoint shapes but don't exercise a real token exchange — that needs developer-supplied test credentials.
- **portal-agent/auth-endpoint-agent/catalog-agent still depend on URLs being in the Tavily base sweep.** For Kite that's why all three returned `insufficient`. Known-URL speculation would reduce coverage holes but introduce false negatives.
- **Latency** — unified deep investigation ran 60–180s depending on load. Streaming agent completions to the client is the next step.
- Progress is browser-local; no auth/billing/multi-tenant.

## Not implemented (deferred by design)

- Playwright browser automation.
- Autonomous OAuth-app creation / automated approval.
- Multi-agent orchestration framework (we use 5 small typed functions).
- Vector search / knowledge graph.
- Bring-your-own-model.
- Auth, roles, billing, analytics, background queues.

## Next milestone (ranked)

1. **"Verify with my credentials" opt-in** on the guide page — paste a sandbox API key, server runs the real token exchange and appends a confirmed Finding to the guide. Credentials stay server-side; never surface in guides or URLs.
2. **Streaming agent completions** — stream each agent's finish event to the client so the 60–180s wait shows real activity rather than a timer.
3. **Automatic re-investigation on stale guides** — background refresh so the guide shows "last confirmed N days ago" and offers a one-click re-run.


## Iteration 3 — agentic deep investigation

Added a second pipeline that goes beyond "search → synthesize". Five
independent agents run in parallel, each producing structured Findings. A
synthesis pass turns those into a one-screen report a developer can act on.

- **docs-agent** — Fetches authoritative docs URLs directly (HTTP GET), strips
  HTML, surfaces page excerpts the synthesizer can quote.
- **portal-agent** — Finds candidate `developers.<provider>` / `dashboard.<provider>` URLs on the provider's own domain and HEAD-probes them.
- **catalog-agent** — Direct-fetches `composio.dev/toolkits/<slug>` and
  `docs.composio.dev/toolkits/<slug>` for every plausible slug. Verifies the
  page actually mentions the provider (false-positive guard for generic
  404-with-200 pages).
- **auth-endpoint-agent** — Spots `/oauth`, `/authorize`, `/token`,
  `/session/token`, `/connect/login` paths on the provider's domain in the
  Tavily evidence, probes them with intentionally-bogus params to inspect
  the error contract. Never sends real credentials; the safe-fetch helper
  refuses credential-shaped parameter names.
- **constraints-agent** — Runs four focused searches (pricing, approval,
  token lifetime, rate limits) and only accepts hits on the provider's own
  domain.

Each agent returns `Finding[]` with explicit:

- `attempted` — one sentence stating what the agent did
- `attemptKind` — `docs-read` / `url-probe` / `api-error-probe` / `catalog-check` / `search` / `static-reasoning`
- `outcome` — `confirmed` / `supports` / `contradicts` / `insufficient` / `failed` / `skipped`
- `conclusion` — short plain-language result
- `observation` — the actual response/excerpt (what the developer can audit)
- `evidence` — URLs the finding used
- `uncertainty` — what was NOT established

The synthesizer takes the Findings and produces ONLY the summary +
responsibilities + uncertainties — never introducing new facts. Dangling
`findingIds` are scrubbed post-synthesis.

The report page (`/reports/[slug]`) opens with:

1. Three summary cards (difficulty / active time / external waiting).
2. A red "main concern" card.
3. A green "next action" card.
4. Three-column **Who does what** (agent / shared / human).
5. **What we tested** — one card per finding, grouped by agent, showing the
   question, what we did, conclusion, raw observation, and evidence URLs
   with trust-tier badges. This is the auditable "receipts" section.
6. **What remains uncertain**.
7. All sources collected during the investigation.

### Safety

- `isSafeHttpUrl` rejects non-http(s) schemes, loopback/private-IP literals,
  `.local`/`.internal` TLDs, and hostnames without a dot.
- `errorProbePost` strips any parameter name matching `secret|password|token|
  refresh|private[-_]?key` and refuses the probe loudly if the caller passed
  one.
- Response bodies are capped at 16 KiB to prevent prompt-injection payload
  blowups.
- HEAD/GET timeouts: 7s / 12s.
- Deep investigator never submits real OAuth parameters, never follows a
  login flow, never fills forms.

## Known gaps & limitations

- **No sandbox-call verification yet.** The deep investigator probes the
  shape of auth endpoints but doesn't exercise a real token-exchange — that
  needs a developer-supplied test credential and is deliberately out of
  scope.
- **portal-agent/auth-endpoint-agent depend on URLs being in the Tavily
  base sweep.** Known-URL fallback (e.g. trying `developers.<domain>`
  speculatively) would improve coverage but introduce false 404s. For now
  "insufficient" is reported honestly.
- **catalog-agent is slug-based.** Composio's canonical slug for a given
  provider may differ from any token in the provider name. If so, the agent
  reports insufficient (correct, but a developer still needs to confirm
  manually).
- **Latency** — deep investigation ran 28–60s on recent runs. Agents are
  parallelized; the Gemini synthesis is the main cost.
- Progress is browser-local; no auth/billing/multi-tenant.
- `postcss` transitive advisory in Next 15 still present; fixed only by Next 16.

## Not implemented (deferred by design)

- Playwright browser automation.
- Autonomous OAuth-app creation / automated approval.
- Multi-agent orchestration framework (we use 5 small typed functions, not a
  framework).
- Vector search / knowledge graph.
- Bring-your-own-model.
- Auth, roles, billing, analytics, background queues.

## Next milestone (ranked)

1. **"Try my credentials" verifier** — opt-in form where a developer pastes
   a sandbox `api_key`/`api_secret` into the report, which the server then
   uses to run the real token-exchange and verify data access. Keeps
   credentials server-side, out of guides and URLs.
2. **Streaming agent progress** — stream each agent's completion event to
   the client so the 30–60s wait shows real activity, not a timer.
3. **Automatic re-investigation on stale reports** — background refresh so
   the report page shows "last confirmed N days ago" and can re-run.


## Priority 1 — Source classification

**Fixed.** `lib/search/classify.ts` is a new module with:

- Registrable-host extraction (handles two-level TLDs: co.uk, co.in, …).
- `hostIsOnDomain` only credits a host as the provider's own if the
  registrable root matches or it's a subdomain.
- New categories: `third-party-integration` (nango.dev, clerk.com,
  openalgo.in, nocodb.com, apideck.com, pipedream.com, zapier.com, …) and
  `community` (stackoverflow, medium, reddit, dev.to, …).
- `developer-portal` is now a special case of `official-docs` triggered only
  by a `developers.<provider>` subdomain of the provider's own domain.
- GitHub: `ComposioHQ/*` → composio-docs; everything else → unknown (we don't
  guess).
- Legacy `"third-party"` enum value kept as a Zod enum value for forward
  compat so old DB rows still validate.

The pipeline establishes the provider domain(s) **after** retrieving evidence
and **reclassifies** results against them. The old inline-keyword classifier
in `tavily.ts` is deleted.

## Priority 2 — Evidence grounding

**Strengthened.** Beyond the existing anti-fabrication filter (drop evidence
URLs the pipeline didn't retrieve), stage 9 now:

- Reclassifies generated `sourceType` fields using our classifier (model
  self-reports are discarded in favor of our hostname check).
- Walks the generated guide and drops any `evidenceIds` reference that
  doesn't point to a surviving evidence entry. Prevents dangling `[source]`
  links in the UI. A new warning line reports the drop count.

The system prompt is rewritten with an explicit **"authoritative vs
non-authoritative"** block that forbids the model from asserting a
provider-level requirement based solely on a third-party integrator or
community source.

## Priority 3 — Composio Managed Auth check

**Implemented.** `probeComposioManagedAuth` runs ONE dedicated Tavily search
scoped to Composio's own domains. The outcome is categorized as
`supported` / `not-indicated` / `unknown`. The prompt tells the model:

- `supported` → recommend `managed-auth` and cite the Composio evidence.
- `not-indicated` → treat as **uncertainty**, not as proof of unsupported.
- `unknown` → preserve as uncertainty.

The Kite Connect run now records the Composio question as an explicit
uncertainty rather than claiming "Composio does not support this."

## Priority 4 — Configuration fields

**Improved.** The schema's per-field `provenance` enum is unchanged
(`developer-input` | `environment-derived` | `provider-issued`) but the
prompt now enforces strict rules:

- `suggestedValue` is only set when the exact literal is quoted in
  **authoritative** evidence (not inferred from third-party docs). Otherwise
  `missingInfo=true` and the field is clearly marked.
- Never invent redirect URIs, scopes, API hosts.
- When a provider doesn't use OAuth2 scopes (Kite Connect is an example),
  state so in the field description rather than making one up.
- Secrets never go in guides — the UI now hides the "fill in your value"
  prompt for `provider-issued` fields because provider-issued credentials
  (API key, access token) are not something the user types into the guide.

## Priority 5 — Setup step structure

**Implemented.** A new `SetupStepCategory` enum (`register-provider-app` |
`configure-integration` | `authorize-user` | `verify-data-access` |
`provider-approval`) is required on every generated step and is grouped in
the UI. Seed guides updated with explicit categories. The Zod default is
`configure-integration` so legacy rows don't break.

Steps continue to carry expected outcome, verification, recovery, execution
mode, and evidenceIds (unchanged). The prompt now instructs the model to
produce a few steps per category and OMIT a category entirely when it
doesn't apply (Kite Connect has no `provider-approval` category — correct).

## Priority 6 — Guide detail UI

**Reworked.** The guide page now opens with a **hero summary**:

1. Recommended path + rationale.
2. Active developer effort + external waiting (with claim-kind badges).
3. Main blocker (first `knownBlocker` if any, else "none recorded" with a
   plain-text explanation — not a misleading placeholder).
4. Next action (surfaced in a bright emerald card).

Setup steps are grouped under their category labels with a running step
number so the overall order remains clear.

Agent / human sections render only when they have content — no more
"Not specified" placeholders.

Evidence badges now use the trust-tier colors from the new classifier:
green for authoritative (provider's own domain), violet for Composio, amber
for third-party-integration platforms, slate for community, red for unknown.
A short legend sits above the source list.

When `providerUrl` is still a Google-search placeholder (no provider domain
established), the header labels it honestly as "not established from
retrieved evidence" rather than displaying a false "official" link.

## Known gaps & limitations (unchanged + new)

- **Kite Connect subscription cost** (₹2000/month) — Zerodha-published fact
  the current retrieved evidence did not surface; the guide records the
  initial subscription in `pathRationale` but doesn't give a price or add it
  to `externalWaiting`. Would require retrieving a specific support article;
  recorded as implicit uncertainty via "signup for a developer account".
- **Daily 6 AM access-token expiry** is captured as an uncertainty + hinted
  in `nextAction`, but not elevated to a top-level operational constraint.
  The model saw the mandatory TOTP forum thread but didn't quote the exact
  regulatory expiry window.
- **DNS can intermittently fail** on this environment. One Tavily call
  returned `getaddrinfo ENOTFOUND api.tavily.com` during this iteration;
  retrying worked. The pipeline reports search errors honestly in the
  response.
- **Latency** — 60–120s per full guide now that `maxOutputTokens` is 32k.
  Streaming would be a next step; still deferred.
- **Progress is browser-local** — unchanged.
- **No Playwright, no auth, no multi-tenant** — unchanged.

## Not implemented (deferred by design)

- Playwright browser automation.
- Autonomous OAuth-app creation / automated approval.
- Multi-agent orchestration.
- Vector search / knowledge graph.
- Bring-your-own-model.
- Auth, roles, billing, analytics, background queues.
- Hand-curated 100-provider catalog (the data model supports it; curation is
  not a code task).

## Next milestone (ranked)

1. **Streaming guide generation** — pipe the model's structured output into
   the UI as it arrives so the 60–120s wait is visible, not a spinner.
2. **Second-pass fact-check** on key quantitative claims (approval
   timelines, fees, token lifetimes) using a targeted follow-up search —
   catches cases like the Kite daily 6 AM expiry.
3. **Server-side progress persistence** (opt-in) — unchanged.
