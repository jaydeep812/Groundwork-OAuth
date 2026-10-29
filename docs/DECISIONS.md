# Decisions

Why the MVP looks the way it does.

## Stack

- **Next.js 15 App Router + TypeScript strict + Tailwind v4.** The brief
  specified this family; Server Components let us keep DB and privileged API
  calls off the client with zero ceremony. TypeScript dropped to 5.x because
  Next 15 doesn't yet support the newly released TS 7.
- **Gemini via `@langchain/google-genai`, orchestrated with LangGraph.js.**
  The research runs as one LangGraph `StateGraph` (normalize → plan → search →
  investigate → synthesize → critic, with a bounded re-plan loop) so recovery
  and state are explicit rather than ad-hoc. Within it, exactly **one** model
  call authors facts (synthesis); everything else — five HTTP-probing
  investigators, the fact ledger, grounding, reconciliation — is deterministic,
  so the surface area where the model can fabricate is deliberately tiny.
- **Tavily via raw REST.** A dependency not needed; we have query construction,
  timeouts, result normalization, dedup, and classification in ~140 lines.
- **SQLite via `better-sqlite3`.** The simplest reliable persistence on a
  developer's machine. No server to run; single file; sync API matches request
  lifecycle. Isolated behind `lib/db/guides.ts` so swapping to Postgres/
  LibSQL/etc. is a module replacement.
- **Zod** as the single schema source. Reused across seed data, Gemini
  structured-output guidance, DB round-trip validation, API inputs, and
  rendering. The schema is the contract.

## Schema

- Hand-authored one canonical `Guide` with a `GeneratedGuide` that *omits
  server-controlled fields* (id/slug/timestamp/status). The model physically
  cannot fabricate these — the pipeline assigns them after validation.
- **Claim kinds** (`verified | observed | estimate | inference | unknown`) and
  **value provenance** (`developer-input | environment-derived | provider-issued`)
  are explicit enum fields rather than freeform text, so the UI can surface
  uncertainty consistently and no module has to parse prose.
- **Stable string IDs** for every setup step, field, evidence entry, etc. The
  browser-local progress tracker keys on step IDs — reordering steps or editing
  the guide doesn't lose progress.
- **Dangerous URL guard.** Zod's `.url()` accepts `javascript:` and `data:`.
  I added an http(s)-only refinement (`httpUrl`) and tested it. Evidence URLs
  and provider URLs both go through this.

## Pipeline

- **One explicit function, no agent framework.** Ten numbered stages in
  `lib/research/pipeline.ts`. Easy to read, easy to test with mocks.
- **Bounded searches.** Max 6 Tavily queries per investigation; max 5 results
  each; targeted at official docs, scopes, verification, and Composio Managed
  Auth — not dozens of repetitive searches.
- **Evidence-grounding check (stage 9).** The model receives evidence tagged
  with `ev-N` ids; its output's `evidence[]` is filtered to drop any URL the
  pipeline did not actually retrieve. This is the anti-fabrication wall. The
  integration test exercises it.
- **No fabrication on failure.** Empty evidence → honest 502 with a
  recoverable error, not a hollow guide. Invalid JSON from the model → honest
  validation failure. The brief required this and the test suite enforces it.
- **ProviderUrl is upgraded, not invented.** If the user types a bare name, we
  only replace the placeholder with a retrieved URL whose host actually matches
  the provider name. Otherwise we keep a Google-search placeholder — honest
  about uncertainty.
- **No Composio-managed-auth assumption.** The system prompt tells the model to
  treat Composio support as an uncertainty unless the retrieved evidence
  establishes it, and to never claim an app is approved/launched without
  verification.

## UI

- **Server Components by default.** Only `GuideSteps`, `LibrarySearch`,
  `InvestigateForm`, and the two Copy buttons are client components. The guide
  payload is rendered on the server.
- **Progress is browser-local** and the UI says so. No pretense of cross-device
  sync.
- **No fake agent activity.** The investigate form shows a labeled list of real
  pipeline stages on an advancing cursor, never a stream of fabricated tool
  calls.
- **Minimal UI library.** Hand-rolled badge/copy primitives in
  `components/ui/` rather than installing shadcn via CLI. One fewer source of
  version drift in a 6–8h build.

## Iteration 3 (agentic deep investigation)

The guide pipeline produces a static artifact from a Tavily + Gemini sweep.
A developer handed one still has to trust that the model synthesized
honestly. For "shareable without me explaining it", a developer needs
**receipts**: what was actually tested, what the response was, what
remains unknown. This iteration adds a second pipeline that produces those
receipts explicitly.

### Agents, not an agent framework

Five small typed `async (ctx) => Promise<Finding[]>` functions. Each has a
narrow responsibility, runs in parallel via `Promise.allSettled`, and
returns schema-validated Findings. No orchestration framework; no planner;
no tool-use loop. The pattern:

- Deterministic agent code does the thing that actually tells us something
  (fetching a page, probing a URL, running a specific search).
- Gemini is used only for the final synthesis — turning Findings into a
  summary + responsibilities + uncertainties.
- Everything the user sees traces back to a specific Finding by id.

### Why not have Gemini call tools itself?

Because the entire value of the deep pipeline is that the developer can
read a report and know what was verified. If Gemini decides which URLs to
fetch mid-generation, that transparency is lost. Deterministic agent code
runs the probes; the model only summarizes the outcomes.

### Safety rails that mattered

- `isSafeHttpUrl` catches `localhost`/private-range/`.local`/`.internal` as
  well as the obvious `javascript:`/`data:`/`file:` schemes.
- `errorProbePost` has a defense-in-depth check that **rejects** any
  parameter name matching `secret|password|token|refresh|private[-_]?key`.
  The current `auth-endpoint-agent` uses `api_key`, `request_token`,
  `checksum` — all deliberately public-named for the probe. If a future
  agent accidentally passes a credential-shaped field, the probe refuses
  rather than sending it.
- Response bodies are capped at 16 KiB to limit prompt-injection surface
  and token cost.

### False-positive guards

- `catalog-agent` doesn't trust a 2xx response alone. Many catalog systems
  serve a 200 "page not found" page for arbitrary slugs. The agent GETs the
  first live URL and verifies the page actually mentions the provider by
  name before claiming "supported".
- `portal-agent` only credits URLs whose hostname is on the provider's own
  domain AND starts with `developers.|dev.|dashboard.|console.|portal.|admin.`
- `constraints-agent` discards non-authoritative results. A pricing claim
  from `nocodb.com` doesn't count as "supports".

### What agents CANNOT do (deliberate)

- Create apps or submit forms.
- Perform OAuth with real credentials.
- Follow consent/MFA flows.
- Run Playwright.
- Execute code produced by the model.

A separate "try my credentials" verifier is next on the list and is the
natural place for a developer-supplied sandbox token to be used server-
side without surfacing in guides or URLs.

### Report shape

The decision to put "Who does what" above "What we tested" is intentional.
A developer skimming the report gets the actionable split (agent / shared
/ human) first, and the audit log second. The audit log preserves every
observation (truncated response excerpts, HTTP statuses, finding ids), so
the report is independently reviewable.

## Iteration 2 (trust & actionability)

Audited the Kite Connect guide against real kite.trade docs and found four
specific trust gaps that the pipeline reproduces for other providers:
mislabeled sources (`docs.openalgo.in` as "developer-portal"), fabricated
`providerUrl` fallback, missing operational blockers (TOTP, no sandbox), and
unstructured setup steps. Each priority below addresses a class of issue,
not just the Kite instance.

### Source classification moved to its own module

Keyword matching ("docs" in URL, "developer" in host) was the whole bug.
`lib/search/classify.ts` is now the single home for the categorization logic:

- Categories are honest about what we can and can't know. `official-docs`
  requires the retrieved host to be on the provider's own registrable
  domain — not that the URL happens to contain the string "docs".
- `third-party-integration` is a first-class category because the pipeline
  heavily picks up integrator docs (Nango, Clerk, OpenAlgo, Pipedream, …)
  that describe other providers' OAuth.
- `community` separates forums/blogs so a Medium post doesn't masquerade
  as a developer portal.
- GitHub: only `ComposioHQ/*` → composio-docs; the rest → unknown.

### Pipeline is now two-pass: retrieve → establish domain → reclassify

The original pipeline tried to classify at retrieval time, before knowing
the provider's domain. Now Tavily returns host-only classifications and
the pipeline reclassifies the full set against the provider's own
domain(s) once established. Supports multi-domain providers (e.g.
kite.trade AND zerodha.com for Kite Connect) via
`determineProviderDomains`.

### Composio Managed Auth is a probe, not a guess

`probeComposioManagedAuth` runs ONE scoped Tavily search. The outcome is
`supported` / `not-indicated` / `unknown`, and the prompt is explicit that
`not-indicated` means **uncertain**, not **unsupported**.

### Setup steps now have categories

`register-provider-app` → `configure-integration` → `authorize-user` →
`verify-data-access` → `provider-approval`. The UI groups by category with
running step numbers.

### UI puts the decision info first

Hero summary answers "is this worth starting now?" without scrolling. "Not
specified" placeholders removed. Source list uses trust-tier colors.

### Grounding is stricter

- Model's `sourceType` is discarded in favor of our classifier.
- Dangling `evidenceIds` are scrubbed post-synthesis.
- `suggestedValue` is only set when quoted in authoritative evidence.
- Secrets never go in guides; the UI hides the "fill in your value" prompt
  for `provider-issued` fields.



Audited the Kite Connect guide against real kite.trade docs and found four
specific trust gaps that the pipeline reproduces for other providers:
mislabeled sources (`docs.openalgo.in` as "developer-portal"), fabricated
`providerUrl` fallback, missing operational blockers (TOTP, no sandbox), and
unstructured setup steps. Each priority below addresses a class of issue,
not just the Kite instance.

### Source classification moved to its own module

Keyword matching ("docs" in URL, "developer" in host) was the whole bug.
`lib/search/classify.ts` is now the single home for the categorization logic:

- The categories are honest about what we can and can't know. `official-docs`
  requires the retrieved host to be on the provider's own registrable
  domain — not that the URL happens to contain the string "docs".
- `third-party-integration` is a first-class category because the pipeline
  heavily picks up integrator docs (Nango, Clerk, OpenAlgo, Pipedream, …)
  that describe other providers' OAuth. The UI shows these in amber with a
  legend so a developer can tell them apart from authoritative sources.
- `community` separates forums/blogs so a Medium post about Linear doesn't
  masquerade as a developer portal.
- GitHub is tricky; we only credit `ComposioHQ/*` and treat everything else
  as unknown. Even the provider's own GitHub repo isn't necessarily
  authoritative for OAuth-flow details.

### Pipeline is now two-pass: retrieve → establish domain → reclassify

The original pipeline tried to classify at retrieval time, before it knew
the provider's domain. Now Tavily returns host-only classifications
(Composio/community/third-party), and the pipeline reclassifies the full set
against the provider's own domain once it has one. The classifier accepts
multiple provider domains (e.g. kite.trade AND zerodha.com for Zerodha Kite
Connect) via `determineProviderDomains`.

### Composio Managed Auth is a probe, not a guess

A dedicated `probeComposioManagedAuth` function runs ONE scoped Tavily
search. The outcome is `supported` / `not-indicated` / `unknown`, and the
prompt is explicit that `not-indicated` means **uncertain**, not
**unsupported**. The old guide confidently claimed Composio didn't support
Kite; the new one records it honestly as an open question.

### Setup steps now have categories

`register-provider-app` → `configure-integration` → `authorize-user` →
`verify-data-access` → `provider-approval` is a widely-applicable mental
model for OAuth integrations. The schema makes category required for
generated steps and the UI groups by category with running step numbers.
Seeded guides carry explicit categories; the Zod default of
`configure-integration` keeps legacy rows valid.

### UI puts the decision info first

The new hero summary (path, difficulty, effort, waiting, main blocker, next
action) answers "is this worth starting now?" without scrolling. "Not
specified" placeholders are removed; sections only render when they have
content. Source list uses trust-tier colors with a one-line legend above it.

### Grounding is stricter

- Model's `sourceType` field is discarded in favor of our classifier.
- `evidenceIds` references in any field are scrubbed if they don't point to
  a surviving evidence entry — prevents dangling `[source]` links in the UI.
- The prompt forbids asserting provider requirements based on third-party or
  community sources; those become uncertainties.
- `suggestedValue` is only set when the literal value is quoted in
  authoritative evidence.
- Secrets never go in guides; the UI hides the "fill in your value" prompt
  for `provider-issued` fields.

### Iteration-2 trade-offs

- **`maxOutputTokens` raised to 32k.** The new guides are longer because
  there are more required structural fields (category per step, more
  explicit uncertainties). gemini-2.5-flash's output ceiling is 65k, so 32k
  has headroom. 60–120s latency.
- **Multi-domain detection is heuristic.** We'll miss cases where the
  provider name tokens don't appear in any retrieved host at all. The
  honest fallback is "no provider domain established" and all evidence
  stays `unknown`.
- **No sandbox-call verification yet.** We tell the model to produce a
  "verify-data-access" step but we don't execute it. Playwright-driven
  verification remains deferred.

## Trade-offs made explicitly

- **Guide generation takes 30–70s.** We call Tavily (5 searches) + Gemini
  (one large JSON synthesis) with a bigger output token budget. Streaming
  would be a worthwhile next step; it was deferred to keep complexity down.
- **Thinking-first Gemini models break the fast path.** `gemini-flash-latest`
  (and reasoning models like `gemini-4-argon`) return empty text at reasonable
  `maxOutputTokens` because they spend the budget on hidden thinking. The
  `.env.example` therefore pins a NON-thinking model — `gemini-3.5-flash-lite`
  (the tested default). Documented in `docs/STATUS.md`.
- **Dependency vulnerability.** `postcss` has a high-severity advisory, pulled
  in transitively by Next 15. The fix requires Next 16 (breaking). Noted; not
  worth a mid-build upgrade.
- **TypeScript 7 → 5 downgrade.** Next 15 doesn't support TS 7 yet; TS 5 keeps
  strict mode and all our types work unchanged.
- **Spaces in the project path exposed a Next webpack-alias quirk.** The
  `@/*` tsconfig alias resolved for server-component imports but not for
  client-component or route-handler layers in Next 15. Fixed by setting
  `config.resolve.alias["@"] = __dirname` in `next.config.mjs`. This was the
  most time-consuming debug of the session; captured here for the next person.
