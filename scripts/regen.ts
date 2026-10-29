/**
 * Regenerate persisted guides for one or more providers, end to end, through the
 * real research pipeline (live Gemini + Tavily). Useful for refreshing a stored
 * guide after a harness change, or spot-checking a provider.
 *
 *   npx tsx --env-file=.env.local scripts/regen.ts [Provider ...]
 *
 * With no arguments it regenerates Basecamp, BoldSign, and Asana. Prints the
 * resolved OAuth facts per provider. Requires GEMINI_API_KEY, GEMINI_MODEL, and
 * TAVILY_API_KEY (loaded via tsx's --env-file; never hardcoded).
 */

// Standalone tsx doesn't auto-load .env.local the way Next.js does. We pass it
// via tsx's built-in `--env-file=.env.local` flag (see the invocation), so no
// dotenv dependency is needed. Guard that the keys actually arrived.
function requireEnv() {
  const missing = ["GEMINI_API_KEY", "GEMINI_MODEL", "TAVILY_API_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(
      `Missing env: ${missing.join(", ")}. Run with: npx tsx --env-file=.env.local scripts/regen.ts`,
    );
    process.exit(1);
  }
}

async function main() {
  requireEnv();
  const { runGraph } = await import("@/lib/graph/run");

  const targets = process.argv.slice(2);
  const providers = targets.length ? targets : ["Basecamp", "BoldSign", "Asana"];

  for (const name of providers) {
    process.stdout.write(`\n── Regenerating ${name} ...\n`);
    const started = Date.now();
    const result = await runGraph({ providerNameOrUrl: name });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (result.ok) {
      const g = result.guide;
      const impl = g.implementation;
      console.log(`✓ ${name} → /guides/${g.slug} (${secs}s)`);
      console.log(`   recommendedPath: ${g.recommendedPath}`);
      console.log(`   authorizeUrl:    ${impl?.authorizeUrl ?? "null"}`);
      console.log(`   tokenUrl:        ${impl?.tokenUrl ?? "null"}`);
      console.log(`   refreshUrl:      ${impl?.refreshUrl ?? "null"}`);
      console.log(`   revokeUrl:       ${impl?.revokeUrl ?? "null"}`);
      console.log(`   pkce:            ${impl?.pkce ?? "null"}`);
      console.log(
        `   tokenLifetime:   ${impl?.tokenLifetime ? `${impl.tokenLifetime.kind} ${impl.tokenLifetime.value} ${impl.tokenLifetime.unit}` : "null"}`,
      );
      console.log(`   developerPortal: ${impl?.developerPortalUrl ?? "null"}`);
      console.log(`   facts:           ${g.facts?.length ?? 0} ledger entries`);
      if (result.warnings?.length) {
        for (const w of result.warnings) console.log(`   ⚠ ${w}`);
      }
    } else {
      console.error(`✗ ${name} FAILED at stage=${result.stage}: ${result.error}`);
      if (result.searchErrors?.length) {
        console.error(`   search errors: ${result.searchErrors.join("; ")}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
