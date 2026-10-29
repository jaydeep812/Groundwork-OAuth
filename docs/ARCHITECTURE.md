# Architecture

OAuth Readiness Guide researches how to connect a given provider's OAuth to an
AI agent, and produces an **evidence-backed guide where every claim links to what
the system actually did** — not a single opaque LLM summary.

This document reflects the current implementation. For the *why* behind key
choices, see [DECISIONS.md](./DECISIONS.md).

---

## 1. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript 5 (strict) |
| Styling | Tailwind CSS v4 (`@theme` + CSS variables), dark "composio DEV" theme |
| Validation | Zod v4 — the canonical `Guide` schema is the single source of truth |
| Orchestration | **LangGraph.js** (`@langchain/langgraph`) — one `StateGraph` |
| LLM | **Gemini** via `@langchain/google-genai`, model `gemini-3.5-flash-lite` (paid tier) |
| Web search | Tavily (`search_depth: "advanced"`) |
| Persistence | better-sqlite3 (`data/guides.db`) |
| Tests | Vitest (79 tests) |

> **Assignment note:** the original brief said "no LangGraph / multi-agent
> framework." That constraint was **explicitly waived** by the product owner in
> favour of a real LangGraph graph. See DECISIONS.md.

---

## 2. Request flow

```
Browser
  │  fills /investigate  (provider name-or-URL  +  use case)
  ▼
POST /api/investigation            ← the ONLY generation route
  │  Zod-validates intake, checks server keys
  ▼
runGraph(input)                    lib/graph/run.ts  (compiled LangGraph)
  │  plans → searches → investigates → synthesizes → critiques → (loops) → persists
  ▼
SQLite  (data/guides.db)
  │
  ▼
redirect → /guides/[slug]          server-rendered guide page
```

There is exactly **one** generation path. (An earlier "fast / guide-only" mode
and its `/api/investigate` route were removed — deep investigation is the only
mode.)

---

## 3. The research graph (`lib/graph/`)

A single `StateGraph`. The critic can send the graph back to re-plan when the
implementation pack has gaps, bounded by `MAX_LOOPS = 2` (and a hard
`recursionLimit: 50`).

```
START
  ▼
normalize ──► plan ──► search ──► investigate ──► synthesize ──► critic
                ▲                                                   │
                │                                                   ▼
                │                                          complete OR loopCount≥2 ?
                │                                            │              │
                └──────────────── no ◄───────────────────── ┘        yes → persist → END
                       (re-plan: query ONLY the missing fields)
```

### Nodes

| Node | File | Responsibility |
|---|---|---|
| `normalize` | `nodes/normalize.ts` | Parse provider name/URL; derive a provider name from a URL when only a URL is given. |
| `plan` | `nodes/plan.ts` | **Loop 0:** deterministic seed queries (`buildQueries`). **Re-plan loops:** Gemini generates targeted queries for the critic's *missing* fields only. |
| `search` | `nodes/search.ts` | `tavilySearchMany` over planned queries; establish provider domain; reclassify evidence; run **endpoint extraction** (loop 0). |
| `investigate` | `nodes/investigate.ts` | Fan out the five investigator agents in parallel (`Promise.allSettled`), loop 0 only. Appends `Finding`s. |
| `synthesize` | `nodes/synthesize.ts` | Gemini JSON synthesis from findings + top-ranked evidence → draft `Guide`. Sanitizes malformed entries and coerces out-of-enum values rather than failing the whole guide. |
| `critic` | `nodes/critique.ts` | **Deterministic** presence check over the implementation-pack fields + setup steps → `{ complete, missing[], score }`. No LLM call. |
| `persist` | `nodes/persist.ts` | **Ground** (drop fabricated/unretrieved evidence, scrub dangling `evidenceIds`/`findingIds`), final Zod validation, `upsertGuide`. |

### Shared state (`state.ts`)

`Annotation.Root` with reducers:
- `evidence` — accumulates across loops, **deduped by URL**
- `findings`, `warnings` — accumulate
- all scalars — replace

No `mode` field — the graph is single-path.

### Cross-cutting (`lib/graph/`)
- `llm.ts` — Gemini-only `generateJsonLC` / `generateObjectLC`. JSON mode; Zod (not the SDK) is the schema authority; retry honours Gemini's `retryDelay`; empty-response guard.
- `ground.ts` — grounding walker (drops fabricated evidence, overwrites `sourceType` from the authoritative domain map, scrubs dangling ids).
- `critique.ts` — the completeness critic logic.

---

## 4. The five investigator agents (`lib/investigation/agents/`)

Plain functions that **probe evidence over HTTP — they make no LLM calls**. Each
returns `Finding`s that record *what it attempted* and *what it observed*, which
become the per-claim "why we know" provenance trail.

| Agent | What it does |
|---|---|
| `docs-agent` | GET-fetches authoritative documentation pages. |
| `portal-agent` | HEAD-probes developer-portal URLs on the provider's own domain. |
| `auth-endpoint-agent` | Probes `/oauth`, `/authorize`, `/token` endpoints with **bogus public params** to inspect the error contract — read-only, never real credentials. |
| `catalog-agent` | Direct-fetches `composio.dev/toolkits/<slug>` and verifies the page actually names the provider. |
| `constraints-agent` | Scoped searches for pricing / approval / token-lifetime / rate-limits; discards non-authoritative hits. |

All network access goes through `lib/investigation/safe-fetch.ts` — SSRF-safe
HEAD/GET/error-probe helpers (16 KiB body cap, short timeouts, no loopback /
private IPs, credential-shaped params rejected).

---

## 5. Supporting libraries

| Module | Role |
|---|---|
| `lib/research/helpers.ts` | Pure helpers: `normalizeInput`, `buildQueries`, `rankEvidence`, `determineProviderDomains`. |
| `lib/research/endpoint-extract.ts` | Deep-fetch the top provider-domain doc page and regex the literal authorize/token/revoke URLs. Trusts only on-domain hits; never invents; never throws. (Works on server-rendered docs; JS-rendered SPA docs return an empty shell and yield nothing — honest nulls result.) |
| `lib/search/tavily.ts` | Tavily client. **Per-query retry** on 429/5xx (honours `Retry-After`); queries run in **batches of 3** so a rate-limit burst can't knock out the whole sweep. `reclassifyResults` re-tags against the established provider domain. |
| `lib/search/classify.ts` | URL → `sourceType`. `official-docs` / `developer-portal` require the host to be on the provider's own domain; Composio, third-party integrations, and community are tiered below. |
| `lib/schema/guide.ts` | Canonical `Guide` Zod schema (http(s)-only URL guard; required `SetupStepCategory`; the optional `Implementation` block). |
| `lib/db/guides.ts` | SQLite guides table. DB path resolved lazily inside `getDb()` so tests setting `DATABASE_PATH` never pollute the dev DB. |

---

## 6. Trust & honesty model

The product's core promise is *no confident fabrication*. Enforced at several layers:

- **Classification** — a requirement is only "verified" when backed by
  authoritative (provider-domain) evidence; third-party/community sources are
  marked, never treated as the provider's own word.
- **Grounding** (persist) — any evidence URL the pipeline did not actually
  retrieve is dropped; dangling `evidenceIds`/`findingIds` are scrubbed.
- **Honest nulls** — unestablished endpoints/scopes/limits render as
  "not established from retrieved evidence," never a guessed value.
- **Untrusted input** — retrieved web content and model output are treated as
  data, never instructions; model-generated code is never executed.

---

## 7. Presentation (`app/`)

| Route | Page |
|---|---|
| `/` | Library + search over saved guides. |
| `/investigate` | Single-mode intake form (provider + use case). |
| `/guides/[slug]` | The guide. |
| `/api/investigation` | The generation endpoint (`POST`). |

The guide page uses a deliberate **visual hierarchy**:

1. **Decision card** (recommended path + rationale) — the focal point.
2. **Hero metrics** — active effort / external waiting / main blocker; `Unknown`
   values are visually de-emphasised so real data stands out.
3. **"Start here"** — the single next action.
4. **Implementation Pack** — copyable endpoints, scopes, PKCE, token lifetime,
   rate limits (rendered only when the guide carries an `implementation` block).
5. **Setup Steps** — the actionable centerpiece, grouped by category.
6. **Trust / reference** (open questions, sources, agent audit log) — visually
   demoted; present for verification, secondary in weight.

Components: `implementation-pack`, `guide-steps` (with per-step browser-local
progress), `why-we-know` (the audit-trail popover + bottom audit log),
`ui/badges`.

---

## 8. Data note — older vs newer guides

The curated/seeded guides predate the `Implementation` schema field, so their
stored JSON has no `implementation` block and the Implementation Pack simply
doesn't render for them. **All rendering/hierarchy changes apply to every guide**
(the page re-renders from the DB on each view); only the Implementation Pack is
data-gated. Re-running the investigation for an older provider repopulates it.
