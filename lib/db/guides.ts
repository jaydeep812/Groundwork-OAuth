import { createClient, type Client } from "@libsql/client";
import { resolve } from "node:path";
import { Guide, type Guide as GuideType, GuideStatus } from "@/lib/schema/guide";

/**
 * Thin persistence for guides, backed by libSQL (SQLite-compatible). Isolated
 * from UI and research logic.
 *
 * Dual-mode by environment, so local dev/tests and serverless deploys share ONE
 * code path:
 *   - TURSO_DATABASE_URL set  → hosted Turso (libsql://…) with an auth token.
 *     Used in production (Vercel etc.) where there is no writable local disk.
 *   - otherwise               → a local SQLite file via a `file:` URL, path from
 *     DATABASE_PATH (default ./data/guides.db). Used for local dev and the test
 *     suite (which set DATABASE_PATH to an isolated temp file).
 *
 * Guides are stored as validated JSON blobs plus a few indexed columns for
 * listing/search. The canonical Zod schema is the source of truth: every read
 * re-validates, so a schema change surfaces bad rows loudly.
 */

let client: Client | null = null;
let ready: Promise<Client> | null = null;

async function getDb(): Promise<Client> {
  if (client) return client;
  // Serialize initialization so concurrent first-callers don't each create a
  // client / race the schema creation.
  if (!ready) {
    ready = (async () => {
      const tursoUrl = process.env.TURSO_DATABASE_URL;
      const c = tursoUrl
        ? createClient({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN })
        : createClient({ url: `file:${resolve(process.env.DATABASE_PATH || "./data/guides.db")}` });
      await c.batch(
        [
          `CREATE TABLE IF NOT EXISTS guides (
             id TEXT PRIMARY KEY,
             slug TEXT UNIQUE NOT NULL,
             provider_name TEXT NOT NULL,
             status TEXT NOT NULL,
             created_at TEXT NOT NULL,
             last_researched_at TEXT NOT NULL,
             data TEXT NOT NULL
           )`,
          `CREATE INDEX IF NOT EXISTS idx_guides_slug ON guides(slug)`,
          `CREATE INDEX IF NOT EXISTS idx_guides_provider ON guides(provider_name)`,
        ],
        "write",
      );
      client = c;
      return c;
    })();
  }
  return ready;
}

type Row = {
  id: string;
  slug: string;
  provider_name: string;
  status: string;
  created_at: string;
  last_researched_at: string;
  data: string;
};

function rowToGuide(row: Pick<Row, "data">): GuideType | null {
  try {
    const parsed = Guide.safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function upsertGuide(guide: GuideType): Promise<GuideType> {
  // Validate before persisting — never store unvalidated data.
  const validated = Guide.parse(guide);
  const db = await getDb();

  const existing = await db.execute({
    sql: "SELECT created_at FROM guides WHERE id = ?",
    args: [validated.id],
  });
  const createdAt = (existing.rows[0]?.created_at as string | undefined) ?? new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO guides (id, slug, provider_name, status, created_at, last_researched_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            slug=excluded.slug,
            provider_name=excluded.provider_name,
            status=excluded.status,
            last_researched_at=excluded.last_researched_at,
            data=excluded.data`,
    args: [
      validated.id,
      validated.slug,
      validated.providerName,
      validated.status,
      createdAt,
      validated.lastResearchedAt,
      JSON.stringify(validated),
    ],
  });
  return validated;
}

export async function getGuideBySlug(slug: string): Promise<GuideType | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT data FROM guides WHERE slug = ?", args: [slug] });
  const row = res.rows[0];
  return row ? rowToGuide({ data: row.data as string }) : null;
}

export async function slugExists(slug: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT 1 FROM guides WHERE slug = ? LIMIT 1", args: [slug] });
  return res.rows.length > 0;
}

export type GuideSummary = {
  slug: string;
  providerName: string;
  providerUrl: string;
  description: string;
  recommendedPath: GuideType["recommendedPath"];
  difficulty: GuideType["difficulty"];
  activeEffort: GuideType["activeEffort"];
  externalWaiting: GuideType["externalWaiting"];
  status: GuideStatus;
  lastResearchedAt: string;
};

function toSummary(g: GuideType): GuideSummary {
  return {
    slug: g.slug,
    providerName: g.providerName,
    providerUrl: g.providerUrl,
    description: g.description,
    recommendedPath: g.recommendedPath,
    difficulty: g.difficulty,
    activeEffort: g.activeEffort,
    externalWaiting: g.externalWaiting,
    status: g.status,
    lastResearchedAt: g.lastResearchedAt,
  };
}

export async function listGuides(query?: string): Promise<GuideSummary[]> {
  const db = await getDb();
  const res = await db.execute("SELECT data FROM guides ORDER BY last_researched_at DESC");
  const guides = res.rows
    .map((r) => rowToGuide({ data: r.data as string }))
    .filter((g): g is GuideType => g !== null);
  const q = query?.trim().toLowerCase();
  const filtered = q
    ? guides.filter(
        (g) =>
          g.providerName.toLowerCase().includes(q) || g.description.toLowerCase().includes(q),
      )
    : guides;
  return filtered.map(toSummary);
}
