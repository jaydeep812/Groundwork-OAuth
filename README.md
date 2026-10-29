# Groundwork

**An OAuth readiness check for developers building AI-agent integrations.** You're about to wire up a provider's OAuth and you need to know, before you commit: *How hard is this? How long will it take? Will I wait weeks for approval? What's weird about this provider?* Groundwork answers that — for any app, researched live by an agent, with a source behind every claim.

> Enter a provider → an agent investigates it live → you get a shareable guide that reads as a **readiness verdict**, not a documentation dump.

🔗 **Live demo:** _<add your deployed URL>_

---

## What it does

- **Readiness verdict first.** Every guide opens with the four things the brief asks a developer to understand — **difficulty · hands-on time · approval wait · launch blockers** — at a glance. Approval + waiting is treated as the crux (it's what turns a 1-hour task into a 3-week one).
- **"What's different about this provider."** The non-obvious gotchas a developer who already knows OAuth couldn't guess — restricted-scope reviews, single-use refresh tokens, publishing gates — pulled from evidence, not boilerplate.
- **Honest about confidence.** A provider-published timeline, a community-reported estimate, and an unknown are visibly different. Unknowns are shown as a risk to confirm — never hidden, never faked.
- **Agent vs. you.** Each guide makes clear what a coding agent can do for you and where a human has to take over, and ships a copy-paste brief to hand your agent.
- **Live generation.** Submit an app that isn't in the library and an agent researches it in ~1–3 min: it probes the provider's own OAuth metadata, reads official docs, checks endpoints read-only, and hunts for approval/review timelines — then synthesizes a structured, cited guide.

## How it answers the assignment

| The developer needs to understand… | Where Groundwork shows it |
| --- | --- |
| How easy/hard it is | Difficulty stat in the verdict |
| Time + effort, incl. approval wait | Hands-on + **Approval wait** stats (the crux) |
| Requirements & nuances | "What's different about this provider" |
| What an agent does vs. where you take over | "Your next move" + agent/human split |
| *(and crucially)* what's verified vs. uncertain | Confidence tier + a "Why we know" source trail on every claim |

## What it uses

**Next.js 15** (App Router) · **TypeScript** · **Tailwind v4** · **LangGraph.js** for the research pipeline · **Gemini** for a single fact-authoring synthesis · **Tavily** for web search · **Zod** schema · **SQLite** (`better-sqlite3`) for shareable, persistent guides.

The agent is deliberately disciplined: five HTTP-probing investigators + one model call to synthesize, then a **deterministic fact ledger** reconciles the OAuth values so nothing is hallucinated. Retrieved web content is treated as untrusted data, and the model may not cite a source the pipeline didn't actually retrieve.

## Run it locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # add your Gemini + Tavily keys
npm run seed                 # load the curated guide library
npm run dev                  # http://localhost:3000
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Gemini key (server-side only) |
| `GEMINI_MODEL` | yes | e.g. `gemini-2.5-flash` |
| `TAVILY_API_KEY` | yes | Tavily web-search key |
| `DATABASE_PATH` | no | SQLite path (defaults to `./data/guides.db`) |

Missing keys produce a clear setup error — research is never silently faked.

## Deploy

Runs on any Node host with a **persistent disk** (the app writes generated guides to SQLite). On a container host (Railway/Render/Fly), mount a volume and point `DATABASE_PATH` at it, then `npm run seed` once on the server. Serverless/ephemeral filesystems (e.g. Vercel) need `DATABASE_PATH` pointed at durable storage or the `lib/db` layer swapped for a hosted DB — it's isolated for exactly this.

---

<details>
<summary><strong>Deeper dive</strong> — architecture, pipeline, testing (for the curious)</summary>

### The research pipeline

One LangGraph graph, with a bounded re-plan loop:

```
normalize → plan → search → investigate → synthesize → critic → (re-plan ×≤2 | persist)
```

Everything except the single synthesis call is deterministic: five investigator agents (docs, portal, catalog, auth-endpoint, constraints — all HTTP probes, no LLM), a fact ledger built only from structured signals (RFC 8414 `.well-known`, on-domain doc extraction, live endpoint probes), grounding that drops any fabricated citation, and a completeness critic that drives recovery queries.

### Key modules

```
lib/schema/guide.ts        Canonical Guide schema (Zod; http(s)-only URL guard).
lib/graph/run.ts           Compiles + runs the StateGraph. runGraph(input).
lib/graph/facts.ts         Deterministic fact ledger (verified > observed > inferred).
lib/graph/critique.ts      Completeness + consistency critic (drives re-plan).
lib/search/classify.ts     Honest URL → sourceType; official-docs requires on-domain
                           host (a provider's own forum counts as community, not docs).
lib/investigation/agents/  Five HTTP-probing investigators (no LLM calls).
lib/investigation/safe-fetch.ts  SSRF-safe fetch (no loopback/private IPs, size cap).
lib/db/guides.ts           SQLite persistence (lazy path → test-isolation safe).
app/guides/[slug]/          The tabbed guide (Overview / Setup / Technical / Evidence).
app/api/investigation       Live generation endpoint (POST).
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full graph diagram, node table, and trust model, and [docs/DECISIONS.md](docs/DECISIONS.md) for why the stack and product are shaped this way.

### Testing

`npm test` — **210 tests**, 23 files, fully deterministic (network + LLM mocked, no live calls). Covers the schema, source classification, SSRF guards, RFC 8414 parsing, the fact ledger + reconciliation, canonical setup-step ordering, the approval/waiting evidence rules, and the full pipeline against mocked externals.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (runs typecheck) |
| `npm run seed` | Seed/refresh curated guides |
| `npm test` | Vitest suite |

### Known limitations

See `docs/STATUS.md`. Progress tracking is browser-local; curated content reflects public docs as of the research date and should be re-verified before launch; live-generated approval timelines are often community-estimated (and labelled as such).

</details>
