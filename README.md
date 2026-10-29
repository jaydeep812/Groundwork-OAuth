# Groundwork

Know what it takes to set up a provider's OAuth app — before you commit to it.

How hard. How long. Whether there's an approval wait. What tends to bite.

Look up a provider from the library, or submit one that isn't there.

An agent researches it live and writes a shareable guide — with a source behind each claim.

Live demo: _add your deployed URL_

## What it does

Every guide opens with a readiness verdict:

- Difficulty
- Hands-on time
- Approval wait
- Launch blockers

Tell a one-hour job from a three-week one at a glance.

Approval and waiting carry the most weight — that's what usually turns a quick task slow.

Below the verdict:

**What's different about this provider.**

The non-obvious things a developer who knows OAuth wouldn't guess.

Restricted-scope reviews. Single-use refresh tokens. Publishing gates.

From evidence, not generic OAuth advice.

**Your next move.**

The first concrete step.

A clear split of what an agent can do vs. what needs a human.

Plus a copy-paste brief to hand your coding agent.

**Confidence you can see.**

A provider-published timeline, a community estimate, and an unknown all look different — and say so.

Unknowns show up as a risk to confirm. Never hidden. Never invented.

## Stack

- **Next.js 15** (App Router), **TypeScript**, **Tailwind v4**
- **LangGraph** — the research pipeline
- **Gemini** — one synthesis step
- **Tavily** — web search
- **Zod** — schema validation
- **SQLite** (`better-sqlite3`) — persistent, shareable guides

The pipeline stays narrow where it counts.

One model call authors facts.

Everything else — five HTTP-probing investigators, a deterministic fact ledger, grounding, reconciliation — is code, not model output.

Web content is treated as untrusted.

The model can't cite a source the pipeline didn't actually fetch.

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

Missing keys surface a clear setup error. Research is never silently faked.

## Deploy

The app writes guides to SQLite, so it needs a persistent disk.

**Container host** (Railway, Render, Fly):

- Mount a volume
- Point `DATABASE_PATH` at it
- Run `npm run seed` once on the server

**Serverless** (Vercel):

- Point `DATABASE_PATH` at durable storage, or swap the `lib/db` layer for a hosted database.
- It's isolated behind one module for exactly this.

## How it's built

The research is one LangGraph state graph with a bounded re-plan loop:

```
normalize → plan → search → investigate → synthesize → critic → (re-plan ×≤2 | persist)
```

Only synthesis calls the model.

The five investigators (docs, portal, catalog, auth-endpoint, constraints) are HTTP probes.

The fact ledger is built only from structured signals — RFC 8414 `.well-known` metadata, on-domain doc extraction, live endpoint probes.

It's reconciled over the model's output, so OAuth values stay consistent and unhallucinated.

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

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown, [docs/DECISIONS.md](docs/DECISIONS.md) for the why.

## Commands

- `npm run dev` — dev server
- `npm run build` — production build (runs typecheck)
- `npm run seed` — seed or refresh curated guides
- `npm test` — Vitest suite (210 tests, fully mocked, no live calls)

## Limitations

- Progress tracking is browser-local.
- Curated content reflects public docs as of the research date — re-verify before launch.
- Live-generated approval timelines are often community-estimated, and labelled that way.

More in `docs/STATUS.md`.
