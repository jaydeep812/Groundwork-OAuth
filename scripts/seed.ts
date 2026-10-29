import { SEED_GUIDES } from "@/lib/db/seed-data";
import { Guide } from "@/lib/schema/guide";
import { upsertGuide } from "@/lib/db/guides";

/** Seed curated guides into the database. Idempotent (upsert by id). */
async function main() {
  let ok = 0;
  for (const g of SEED_GUIDES) {
    const parsed = Guide.safeParse(g);
    if (!parsed.success) {
      console.error(`✗ Seed guide "${g.slug}" failed validation:`);
      console.error(parsed.error.issues.map((i) => `   ${i.path.join(".")}: ${i.message}`).join("\n"));
      process.exitCode = 1;
      continue;
    }
    await upsertGuide(parsed.data);
    ok++;
    console.log(`✓ Seeded ${g.providerName} (/guides/${g.slug})`);
  }
  console.log(`\nSeeded ${ok}/${SEED_GUIDES.length} guides.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
