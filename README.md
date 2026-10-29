# Groundwork — OAuth Readiness Guide

Helps developers find the shortest viable path from *wanting* an integration to a
**working, launch-ready OAuth connection**. Enter an unfamiliar provider and the app
runs live web research and synthesizes a structured, evidence-backed guide —
separating real developer effort from external waiting, flagging approval
requirements and blockers, surfacing what you can build with the provider, and
telling you whether **Composio Managed Auth** may already cover you.

The **guide** is the product. Everything else makes it actionable, verifiable, and
shareable.

## What works end to end

- **Investigate (`/investigate`)** — enter a provider (and optionally what you're
  building). One research pipeline runs live: it probes the provider's own OAuth
  metadata (RFC 8414 `.well-known`), reads official docs (including `.md`/raw
  variants), checks the developer portal and Composio's catalog, probes OAuth
  endpoints read-only (never real credentials), and researches approval, token
  lifetime, and rate limits. A single model synthesis turns the findings into a
  guide; a deterministic fact ledger reconciles the OAuth values so every section
  agrees. Honest errors on failure — research is never faked. ~60–180s.
- **Guide (`/guides/<slug>`)** — a shareable, tabbed guide:
  - **Overview** — recommended path, effort vs. external waiting, prerequisites,
    main blocker, next action, and a **"What can you build?"** capabilities preview.
  - **Setup** — the one canonical, ordered checklist (with per-step progress saved
    in the browser) plus the coding-agent handoff brief.
  - **Technical** — endpoints, scopes (+ the provider's full advertised catalog),
    PKCE, token lifecycle, rate limits, and a copyable OAuth code walkthrough.
  - **Evidence** — sources, unresolved questions, and the investigation trace.
- **Library (`/`)** — searchable list of curated + generated guides.
- **Persistence** — SQLite (`better-sqlite3`); guides survive refresh and have
  stable, shareable URLs.

## Tech stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS v4 · LangGraph.js ·
Gemini (via `@langchain/google-genai`) · Tavily (REST) · Zod · SQLite
(`better-sqlite3`) · Vitest.

Gemini is the only model provider, and the pipeline makes a single fact-authoring
model call (synthesis) — everything else (five HTTP-probing investigator agents, the
fact ledger, grounding, reconciliation, the journey/brief builders) is deterministic.

## Setup

Requires Node 20+ (developed on Node 24).

```bash
npm install
cp .env.example .env.local   # then fill in real keys
npm run seed                 # load curated guides into SQLite
npm run dev                  # http://localhost:3000
```

### Environment variables (all server-side)

| Variable         | Required | Purpose                                             |
| ---------------- | -------- | --------------------------------------------------- |
| `GEMINI_API_KEY` | yes      | Google Gemini API key (used only on the server).    |
| `GEMINI_MODEL`   | yes      | Model id, e.g. `gemini-2.5-flash`. Never hardcoded. |
| `TAVILY_API_KEY` | yes      | Tavily web-search key (server-side only).           |
| `DATABASE_PATH`  | no       | SQLite file path. Defaults to `./data/guides.db`.   |

Keys are validated at the service boundary. Missing keys produce a clear setup error
(the investigate API returns `503` with a message) — research is never silently faked.

## Commands

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Dev server.                                   |
| `npm run build`    | Production build (runs typecheck).            |
| `npm start`        | Serve the production build.                   |
| `npm run seed`     | Seed/refresh curated guides.                  |
| `npm run typecheck`| `tsc --noEmit`.                               |
| `npm test`         | Vitest unit + integration tests.              |

## Architecture

Separation of concerns is enforced; privileged operations stay server-side.
A single **LangGraph** graph runs the research:

```
normalize → plan → search → investigate → synthesize → critic → (re-plan loop | persist)
```

```
lib/schema/guide.ts          Canonical Guide Zod schema (http(s)-only URL guard;
                             required SetupStepCategory; optional Implementation pack).
lib/graph/run.ts             Compiles + runs the StateGraph. runGraph(input).
lib/graph/state.ts           Shared Annotation.Root state (evidence dedupes by URL;
                             findings/warnings accumulate). MAX_LOOPS = 2.
lib/graph/llm.ts             Gemini (via @langchain/google-genai) JSON access.
lib/graph/{ground,critique}  Grounding walker + deterministic completeness critic.
lib/graph/nodes/*.ts         normalize, plan, search, investigate, synthesize,
                             critique, persist.
lib/research/helpers.ts      Pure: normalizeInput, buildQueries, rankEvidence,
                             determineProviderDomains.
lib/research/endpoint-extract.ts
                             Fetch the top provider-domain doc pages (trying raw
                             Markdown / `.md` doc variants), regex authorize/token/
                             revoke URLs (on-domain only).
lib/research/oauth-metadata.ts
                             RFC 8414 / OIDC `.well-known` probe over canonical +
                             common OAuth subdomains; validates the issuer.
lib/guide/workflow-order.ts  Canonical setup-step ordering + deterministic workflow
                             validation (authorize-before-exchange, prereqs, etc.).
lib/search/classify.ts       Honest URL → sourceType. official-docs requires the
                             host to be on the provider's own domain.
lib/search/tavily.ts         Tavily client. Per-query retry (429/5xx, Retry-After);
                             batched concurrency; reclassifyResults re-tags.
lib/investigation/
  safe-fetch.ts              SSRF-safe HEAD/GET/errorProbePost (16 KiB cap, short
                             timeouts, no loopback/private IPs).
  agents/                    Five HTTP-probing investigator agents (no LLM calls):
    docs-agent, portal-agent, catalog-agent, auth-endpoint-agent, constraints-agent.
lib/guide/{oauth-journey,agent-prompt}.ts
                             Deterministic 7-step walkthrough + coding-agent brief,
                             built from reconciled facts (no hallucinated endpoints).
lib/db/guides.ts             SQLite guides table (lazy path → test-isolation safe).
app/
  /                          Library + search.
  /investigate               Intake form (provider + use case).
  /guides/[slug]             Tabbed guide (Overview / Setup / Technical / Evidence).
  /api/investigation         The generation endpoint (POST).
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown (graph
diagram, node table, trust model, UI hierarchy).

Retrieved web content and model output are treated as **untrusted data** — never as
instructions, and the model may not cite a URL the pipeline did not retrieve (the
grounding step drops any fabricated source).

## Testing

`npm test` — **204 tests** across 23 files, all deterministic (network and the LLM
are mocked; no live calls in CI). Representative coverage:

- **Schema & classification** — `schema`, `classify`, `search`, `util`, `safe-fetch`
  (SSRF guards: loopback, private, `.local`, dangerous schemes).
- **Retrieval** — `oauth-metadata` (RFC 8414 parse, issuer validation, candidate
  hosts), `endpoint-extract` (doc-variant cascade, markdown-URL edge cases),
  `agents`.
- **Fact ledger & reconciliation** — `facts`, `reconcile`, `critic-consistency`,
  `sanitize-draft`.
- **Workflow correctness** — `workflow-order` (canonical ordering + the
  authorize-before-exchange dependency validation), `cross-section`,
  `path-separation`.
- **Provider regressions** — `providers`, `basecamp`, `bitbucket`.
- **Pipeline integration** — `pipeline`, `graph`, `graph-deep` (mocked externals),
  `oauth-journey`, `agent-prompt`.

## Deployment

Runs on any Node host. `better-sqlite3` is a native module and is marked as a server
external package. For ephemeral/serverless filesystems, point `DATABASE_PATH` at durable
storage or swap the `lib/db` layer for a hosted database — it is isolated for this reason.

## Known limitations

See `docs/STATUS.md`. Highlights: progress is browser-local (not cross-device);
Playwright automation is intentionally deferred; curated guide content reflects public
docs as of the research date and should be re-verified before launch.
