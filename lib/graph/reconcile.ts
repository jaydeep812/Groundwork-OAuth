import type {
  GeneratedGuide,
  NormalizedFact,
  ManagedAuth,
  Finding,
  Implementation,
} from "@/lib/schema/guide";
import { factFor, parseScopes } from "@/lib/graph/facts";

/**
 * Deterministic reconciliation: make the canonical fact ledger authoritative
 * over the model's synthesized implementation pack, so the overview, checklist,
 * implementation pack, and agent brief all reflect the SAME values.
 *
 * Rules:
 *  - A ledger fact with status verified/observed WINS over the model's value
 *    for that field (the model may have missed or mis-stated it). We never
 *    downgrade a ledger-established endpoint to null.
 *  - We never invent: a fact whose status is unknown leaves the field as-is
 *    (which the "never fabricate" synthesis rules already keep honest).
 *  - PKCE support and requirement are independent; the legacy `pkce` summary is
 *    derived from them without claiming a requirement the ledger didn't find.
 *  - Conflicts are preserved on the fact; the field takes the best value but the
 *    conflict remains visible in `facts`.
 */
export function reconcileWithLedger(
  guide: GeneratedGuide,
  facts: NormalizedFact[],
  opts: { tokenLifetimeSeconds?: number | null } = {},
): { guide: GeneratedGuide; changed: string[] } {
  const changed: string[] = [];
  const impl: Implementation = {
    ...emptyImplementation(),
    ...(guide.implementation ?? {}),
  };

  const applyUrl = (fieldPath: string, key: keyof Implementation) => {
    const f = factFor(facts, fieldPath);
    if (!f || f.value == null) return;
    if (f.status === "unknown") return;
    if (typeof f.value !== "string") return;
    if (impl[key] !== f.value) {
      // Only override when the ledger is at least as authoritative as a blank or
      // a model guess. Endpoints/portal are strings on Implementation.
      (impl as Record<string, unknown>)[key] = f.value;
      changed.push(fieldPath);
    }
  };

  applyUrl("implementation.authorizeUrl", "authorizeUrl");
  applyUrl("implementation.tokenUrl", "tokenUrl");
  applyUrl("implementation.revokeUrl", "revokeUrl");
  applyUrl("implementation.developerPortalUrl", "developerPortalUrl");

  // Supported scopes (RFC 8414 scopes_supported) are the authorization server's
  // advertised catalog — authoritative and ledger-owned. This is SEPARATE from
  // `scopes` (the use-case recommendations the model authors). We:
  //  1. set `supportedScopes` to the metadata-advertised names (authoritative), and
  //  2. ensure every recommended scope name the model used is actually in that
  //     catalog is left untouched, but we do NOT inject the whole catalog into
  //     `scopes` — being supported ≠ being needed. We only surface the catalog.
  // A metadata scope the model also recommended keeps the model's description +
  // required flag; the catalog just proves the name exists.
  const scopesFact = factFor(facts, "implementation.supportedScopes");
  if (scopesFact && scopesFact.status !== "unknown" && scopesFact.value != null) {
    const supported = parseScopes(scopesFact.value);
    if (supported.length > 0) {
      impl.supportedScopes = supported;
      changed.push("implementation.supportedScopes");
      // Tag any model-recommended scope that the catalog confirms with the
      // metadata evidence id, so "why we know this scope exists" is backed.
      const metaEvidence = scopesFact.evidenceRefs;
      if (metaEvidence.length > 0) {
        impl.scopes = impl.scopes.map((s) =>
          supported.includes(s.name)
            ? { ...s, evidenceIds: Array.from(new Set([...s.evidenceIds, ...metaEvidence])) }
            : s,
        );
      }
    }
  }

  // Documented access-token lifetime parsed from an official token-response
  // example (expires_in). Verified fact — apply ONLY when the model didn't
  // already capture one (never override the model's documented value, never
  // fabricate when seconds is absent).
  const secs = opts.tokenLifetimeSeconds;
  if (secs != null && secs > 0 && (impl.tokenLifetime == null || impl.tokenLifetime.value == null)) {
    impl.tokenLifetime = secondsToEstimate(secs);
    changed.push("implementation.tokenLifetime");
  }

  // Refresh happens at the token endpoint for the standard authorization-code /
  // refresh_token grant. When the token lifecycle says refresh tokens are
  // issued and the model left refreshUrl null (or equal to the token URL), make
  // that explicit rather than leaving "refresh URL: unknown" when it's known.
  const refreshIssued = impl.tokenLifecycle?.refreshTokenIssued;
  if (impl.tokenUrl && !impl.refreshUrl && refreshIssued === "yes") {
    impl.refreshUrl = impl.tokenUrl;
    changed.push("implementation.refreshUrl");
  }

  // PKCE — support and requirement are independent facts. The ledger (from
  // provider metadata) can establish SUPPORT; the model's pkceDetail can carry
  // a conditional REQUIREMENT (e.g. required for localhost/native redirects).
  // Merge both, then derive the legacy `pkce` summary from whichever is known —
  // never losing a model-stated requirement just because the ledger was silent.
  const supported = factFor(facts, "implementation.pkce.supported");
  const required = factFor(facts, "implementation.pkce.required");
  const existing = impl.pkceDetail;
  const hasLedger =
    (supported && supported.value === true && supported.status !== "unknown") ||
    (required && required.value === true && required.status !== "unknown");

  if (existing || hasLedger) {
    const merged = { ...(existing ?? {}) } as NonNullable<Implementation["pkceDetail"]>;
    if (supported && supported.value === true && supported.status !== "unknown") merged.supported = "yes";
    if (required && required.value === true && required.status !== "unknown") merged.required = "yes";
    impl.pkceDetail = {
      supported: merged.supported ?? "unknown",
      required: merged.required ?? "unknown",
      methods: merged.methods ?? [],
      appliesTo: merged.appliesTo ?? "",
      evidenceIds: Array.from(
        new Set([
          ...(merged.evidenceIds ?? []),
          ...(supported?.evidenceRefs ?? []),
          ...(required?.evidenceRefs ?? []),
        ]),
      ),
      findingIds: merged.findingIds ?? [],
    };
    // Derive the legacy summary. A conditional requirement ("required" with an
    // appliesTo condition) still summarizes as "required" — the condition is
    // preserved in pkceDetail.appliesTo for the UI/brief to explain.
    const derived =
      impl.pkceDetail.required === "yes"
        ? "required"
        : impl.pkceDetail.supported === "yes"
          ? "supported"
          : impl.pkce;
    if (derived !== impl.pkce) {
      impl.pkce = derived;
      changed.push("implementation.pkce");
    }
  }

  return { guide: { ...guide, implementation: impl }, changed };
}

/**
 * Derive managed-auth availability metadata from the catalog-agent finding.
 * SEPARATE from the primary custom-OAuth guide. A confirmed toolkit page =>
 * available; an insufficient/failed probe => unknown (NOT unavailable).
 */
export function deriveManagedAuth(findings: Finding[]): ManagedAuth {
  const catalog = findings.find((f) => f.agent === "catalog-agent");
  if (!catalog) {
    return { availability: "unknown", integrationUrl: null, sourceEvidenceIds: [], findingIds: [], caveats: "" };
  }
  if (catalog.outcome === "confirmed") {
    const url = catalog.evidence[0]?.url ?? null;
    return {
      availability: "available",
      integrationUrl: isHttpUrl(url) ? url : null,
      sourceEvidenceIds: [],
      findingIds: [catalog.id],
      // A toolkit page existing does not prove managed OAuth *credentials* are
      // provided — flag that caveat honestly.
      caveats:
        "A Composio toolkit page resolved for this provider. Confirm in Composio whether managed OAuth credentials are offered (vs bring-your-own) and which scopes they cover.",
    };
  }
  // insufficient / failed / skipped — honest unknown, never "unavailable".
  return {
    availability: "unknown",
    integrationUrl: null,
    sourceEvidenceIds: [],
    findingIds: [catalog.id],
    caveats: catalog.uncertainty || "Composio coverage could not be confirmed under the probed slugs.",
  };
}

function isHttpUrl(u: string | null): u is string {
  if (!u) return false;
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

function emptyImplementation(): Implementation {
  return {
    developerPortalUrl: null,
    authorizeUrl: null,
    tokenUrl: null,
    refreshUrl: null,
    revokeUrl: null,
    scopes: [],
    supportedScopes: [],
    redirectUriRule: "",
    pkce: "unknown",
    tokenLifetime: null,
    rateLimits: [],
    testMode: "",
    evidenceIds: [],
    findingIds: [],
  };
}

/** Convert a documented expires_in (seconds) to a verified Estimate, choosing
 * the largest whole unit (days/hours/minutes) the schema allows. */
function secondsToEstimate(seconds: number): NonNullable<Implementation["tokenLifetime"]> {
  const minutes = seconds / 60;
  let value: number;
  let unit: "minutes" | "hours" | "days";
  if (minutes % 1440 === 0 && minutes >= 1440) {
    value = minutes / 1440;
    unit = "days";
  } else if (minutes % 60 === 0 && minutes >= 60) {
    value = minutes / 60;
    unit = "hours";
  } else {
    value = Math.max(1, Math.round(minutes));
    unit = "minutes";
  }
  return {
    kind: "verified",
    value,
    unit,
    rationale: `Documented access-token lifetime (expires_in: ${seconds} seconds) from the provider's official token-response example.`,
    evidenceIds: [],
    findingIds: [],
  };
}
