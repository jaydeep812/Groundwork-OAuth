# Groundwork

Groundwork tells a developer what it takes to set up a provider's OAuth app before they commit to it: how hard it is, how long it'll take, whether there's an approval wait, and the provider-specific details that tend to bite. You can look up a provider from the library or submit one that isn't there yet — an agent researches it live and writes a shareable guide, with a source behind each claim.

Live demo: _add your deployed URL_

## What it does

A guide opens with a readiness verdict — difficulty, hands-on time, approval wait, and launch blockers — so you can tell a one-hour job from a three-week one at a glance. Approval and waiting get the most weight, since that's usually what turns a quick task into a slow one.

Below the verdict, each guide covers:

- **What's different about this provider** — the non-obvious things a developer who already knows OAuth wouldn't guess: restricted-scope reviews, single-use refresh tokens, publishing gates. Pulled from evidence, not generic OAuth advice.
- **Your next move** — the first concrete step, and a clear split of what a coding agent can do versus what needs a human. Each guide also ships a copy-paste brief for handing to an agent.
- **Confidence you can see** — a provider-published timeline, a community-reported estimate, and an unknown look different and are labelled as such. Unknowns show up as a risk to confirm rather than getting hidden or invented.

Submitting a new provider runs the research live (roughly one to three minutes): it reads the provider's own OAuth metadata, official docs, and developer portal, probes endpoints read-only, and looks for approval timelines, then writes the guide.

## Stack

Next.js 15 (App Router), TypeScript, Tailwind v4. The research runs as a LangGraph pipeline using Gemini for a single synthesis step and Tavily for web search. Guides are validated with Zod and stored in SQLite (`better-sqlite3`) so they persist and have shareable URLs.

The pipeline is deliberately narrow where it matters: one model call authors facts, and everything else — five HTTP-probing investigators, a deterministic fact ledger, grounding, and reconciliation — is code, not model output. Retrieved web content is treated as untrusted, and the model can't cite a source the pipeline didn't actually fetch.

## Run it locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # add your Gemini and Tavily keys
npm run seed                 # load the curated guide library
npm run dev                  # http://localhost:3000
```

Environment variables (all server-side):

- `GEMINI_API_KEY` — Gemini key (required)
- `GEMINI_MODEL` — model id, e.g. `gemini-2.5-flash` (required)
- `TAVILY_API_KEY` — Tavily web-search key (required)
- `DATABASE_PATH` — SQLite path, defaults to `./data/guides.db` (optional)

Missing keys surface a clear setup error; research is never silently faked.

## Deploy

The app writes generated guides to SQLite, so it needs a persistent disk. On a container host (Railway, Render, Fly), mount a volume, point `DATABASE_PATH` at it, and run `npm run seed` once on the server. Serverless hosts with an ephemeral filesystem (Vercel) need `DATABASE_PATH` on durable storage, or the `lib/db` layer swapped for a hosted database — it's isolated behind one module for that reason.

## How it's built

The research runs as one LangGraph state graph with a bounded re-plan loop:

```
normalize → plan → search → investigate → synthesize → critic → (re-plan ×≤2 | persist)
```

Only the synthesis step calls the model. The five investigators (docs, portal, catalog, auth-endpoint, constraints) are HTTP probes. The fact ledger is built only from structured signals — RFC 8414 `.well-known` metadata, on-domain doc extraction, live endpoint probes — and reconciled over the model's output so OAuth values stay consistent and unhallucinated.

Notable modules:

```
lib/schema/guide.ts        Canonical Guide schema (Zod; http(s)-only URL guard).
lib/graph/run.ts           Compiles and runs the state graph. runGraph(input).
lib/graph/facts.ts         Deterministic fact ledger (verified > observed > inferred).
lib/graph/critique.ts      Completeness and consistency critic (drives re-plan).
lib/search/classify.ts     URL to source type; official docs require an on-domain host
                           (a provider's own forum counts as community, not docs).
lib/investigation/agents/  The five HTTP-probing investigators.
lib/investigation/safe-fetch.ts  SSRF-safe fetch (no loopback/private IPs, size cap).
lib/db/guides.ts           SQLite persistence (lazy path for test isolation).
app/guides/[slug]/          The guide (Overview / Setup / Technical / Evidence).
app/api/investigation       Live generation endpoint (POST).
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown and [docs/DECISIONS.md](docs/DECISIONS.md) for why the stack and product are shaped this way.

## Commands

- `npm run dev` — dev server
- `npm run build` — production build (runs typecheck)
- `npm run seed` — seed or refresh curated guides
- `npm test` — Vitest suite (210 tests, fully mocked, no live calls)

## Limitations

Progress tracking is browser-local. Curated content reflects public docs as of the research date and should be re-verified before launch. Live-generated approval timelines are often community-estimated, and labelled that way. More in `docs/STATUS.md`.
