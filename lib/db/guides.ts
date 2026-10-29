import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Guide, type Guide as GuideType, GuideStatus } from "@/lib/schema/guide";

/**
 * Thin SQLite persistence for guides. Isolated from UI and research logic.
 *
 * Guides are stored as validated JSON blobs plus a few indexed columns for
 * listing/search. The canonical Zod schema remains the source of truth: every
 * read re-validates, so a schema change surfaces bad rows loudly.
 */

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  // Resolve the path lazily (NOT at module load) so tests that set
  // DATABASE_PATH before first use don't leak rows into the dev database.
  const dbPath = resolve(process.env.DATABASE_PATH || "./data/guides.db");
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS guides (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      provider_name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_researched_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guides_slug ON guides(slug);
    CREATE INDEX IF NOT EXISTS idx_guides_provider ON guides(provider_name);
  `);
  return db;
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

function rowToGuide(row: Row): GuideType | null {
  try {
    const parsed = Guide.safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function upsertGuide(guide: GuideType): GuideType {
  // Validate before persisting — never store unvalidated data.
  const validated = Guide.parse(guide);
  const existing = getDb()
    .prepare<[string]>("SELECT created_at FROM guides WHERE id = ?")
    .get(validated.id) as { created_at: string } | undefined;
  const createdAt = existing?.created_at ?? new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO guides (id, slug, provider_name, status, created_at, last_researched_at, data)
       VALUES (@id, @slug, @providerName, @status, @createdAt, @lastResearchedAt, @data)
       ON CONFLICT(id) DO UPDATE SET
         slug=excluded.slug,
         provider_name=excluded.provider_name,
         status=excluded.status,
         last_researched_at=excluded.last_researched_at,
         data=excluded.data`,
    )
    .run({
      id: validated.id,
      slug: validated.slug,
      providerName: validated.providerName,
      status: validated.status,
      createdAt,
      lastResearchedAt: validated.lastResearchedAt,
      data: JSON.stringify(validated),
    });
  return validated;
}

export function getGuideBySlug(slug: string): GuideType | null {
  const row = getDb()
    .prepare<[string]>("SELECT * FROM guides WHERE slug = ?")
    .get(slug) as Row | undefined;
  return row ? rowToGuide(row) : null;
}

export function slugExists(slug: string): boolean {
  const row = getDb().prepare<[string]>("SELECT 1 FROM guides WHERE slug = ?").get(slug);
  return Boolean(row);
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

export function listGuides(query?: string): GuideSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM guides ORDER BY last_researched_at DESC")
    .all() as Row[];
  const guides = rows.map(rowToGuide).filter((g): g is GuideType => g !== null);
  const q = query?.trim().toLowerCase();
  const filtered = q
    ? guides.filter(
        (g) =>
          g.providerName.toLowerCase().includes(q) ||
          g.description.toLowerCase().includes(q),
      )
    : guides;
  return filtered.map(toSummary);
}
