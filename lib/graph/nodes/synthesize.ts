import type { GraphStateType } from "@/lib/graph/state";
import { GeneratedGuide } from "@/lib/schema/guide";
import { reclassifyResults } from "@/lib/search/tavily";
import { generateJsonLC } from "@/lib/graph/llm";
import {
  buildDeepGuideUserPrompt,
  DEEP_GUIDE_SYSTEM_PROMPT,
} from "@/lib/investigation/deep-guide-prompt";
import { rankEvidence } from "@/lib/research/helpers";

/**
 * Synthesize a draft guide from the agent Findings plus the accumulated web
 * evidence. Writes `draftGuide`; the critic + ground nodes run after.
 */
export async function synthesizeNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (state.error) return {};

  const evidence = reclassifyResults(state.evidence, state.providerDomains, state.providerName);

  const system = DEEP_GUIDE_SYSTEM_PROMPT;
  // Rank + cap the accumulated evidence so re-planned searches can fill the
  // implementation pack even when the agents returned "insufficient".
  const rankedForDeep = rankEvidence(evidence).slice(0, 12);
  const prompt = buildDeepGuideUserPrompt({
    providerName: state.providerName,
    providerUrl: state.providerUrl,
    providerDomains: state.providerDomains,
    useCase: state.useCase,
    findings: state.findings,
    evidence: rankedForDeep.map((r, idx) => ({
      id: `ev-${idx + 1}`,
      sourceType: r.sourceType,
      url: r.url,
      title: r.title,
      content: r.content,
    })),
  });

  let text: string;
  try {
    text = await generateJsonLC({ system, prompt, maxOutputTokens: 32768 });
  } catch (err) {
    return { error: `Guide synthesis failed: ${(err as Error).message}`, stage: "synthesis" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripFences(text));
  } catch {
    // The cheap flash model occasionally returns malformed JSON. A fresh sample
    // almost always parses, so retry synthesis once before giving up rather than
    // discarding an otherwise-answerable provider.
    try {
      const retry = await generateJsonLC({ system, prompt, maxOutputTokens: 32768 });
      parsedJson = JSON.parse(stripFences(retry));
    } catch {
      return { error: "Gemini returned invalid JSON.", stage: "validation" };
    }
  }

  sanitizeDraft(parsedJson);

  const parsed = GeneratedGuide.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      error: `Generated guide failed schema validation: ${parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      stage: "validation",
    };
  }

  return { draftGuide: parsed.data };
}

/** Defensive: some models wrap JSON in ```json fences despite instructions. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return trimmed;
}

/**
 * Drop claim-array entries that are missing their required fields. Without a
 * response schema passed to the SDK (we use JSON mode + Zod), the model may
 * occasionally emit, say, a knownBlocker with no title. Rather than discard an
 * otherwise-good guide, prune the malformed entries so the rest validates.
 */
export function sanitizeDraft(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const g = json as Record<string, unknown>;

  const hasStr = (o: unknown, k: string) =>
    !!o && typeof o === "object" && typeof (o as Record<string, unknown>)[k] === "string" && ((o as Record<string, unknown>)[k] as string).trim() !== "";

  const prune = (key: string, required: string[]) => {
    if (!Array.isArray(g[key])) return;
    g[key] = (g[key] as unknown[]).filter((item) => required.every((r) => hasStr(item, r)));
  };

  prune("knownBlockers", ["id", "title", "description"]);
  prune("approvalRequirements", ["id", "title", "description"]);
  prune("prerequisites", ["id", "description"]);
  prune("uncertainties", ["id", "question"]);
  prune("setupSteps", ["id", "title", "instructions"]);
  prune("evidence", ["id", "title", "url"]);

  // setupSteps require executionMode (enum, no schema default). Backfill a safe
  // default rather than drop a step that is otherwise complete.
  if (Array.isArray(g.setupSteps)) {
    for (const s of g.setupSteps as Record<string, unknown>[]) {
      if (s && typeof s === "object" && typeof s.executionMode !== "string") {
        s.executionMode = "manual";
      }
    }
  }

  coerceEnums(g);
  normalizeUnits(g);
  repairEstimates(g);
  enforceEstimateHonesty(g);
  coerceNewEnums(g);

  // Scopes inside implementation require a name.
  const impl = g.implementation as Record<string, unknown> | undefined;
  if (impl && Array.isArray(impl.scopes)) {
    impl.scopes = (impl.scopes as unknown[]).filter((s) => hasStr(s, "name"));
  }
  if (impl && Array.isArray(impl.rateLimits)) {
    impl.rateLimits = (impl.rateLimits as unknown[]).filter((r) => hasStr(r, "limit"));
  }
}

/**
 * A hands-on setup estimate is a planning estimate by nature — never a
 * documented fact. Deterministically downgrade an over-confident activeEffort
 * so the critic's honesty check passes and the UI never implies it's verified.
 */
function enforceEstimateHonesty(g: Record<string, unknown>): void {
  const ae = g.activeEffort as Record<string, unknown> | undefined;
  if (ae && (ae.kind === "verified" || ae.kind === "observed")) {
    ae.kind = "estimate";
  }
}

const TRISTATE = new Set(["yes", "no", "unknown"]);
const CLIENT_TYPES = new Set(["public", "confidential", "unknown"]);
const BLOCKER_ASSESSMENT = new Set(["assessed-none-found", "blockers-found", "incomplete"]);

/**
 * Coerce the newer structured-OAuth enums to safe defaults ONLY on their own
 * container objects, so a bare key like `required` (a boolean elsewhere) is
 * never mis-coerced. Keeps an otherwise-valid guide from being discarded over a
 * stray enum the model emitted in a new sub-object.
 */
function coerceNewEnums(g: Record<string, unknown>): void {
  const triFix = (obj: unknown, keys: string[]) => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      if (typeof o[k] === "string" && !TRISTATE.has(o[k] as string)) o[k] = "unknown";
    }
  };
  if (typeof g.blockerAssessment === "string" && !BLOCKER_ASSESSMENT.has(g.blockerAssessment as string)) {
    g.blockerAssessment = "incomplete";
  }
  const impl = g.implementation as Record<string, unknown> | undefined;
  if (!impl) return;
  triFix(impl.pkceDetail, ["supported", "required"]);
  triFix(impl.tokenLifecycle, [
    "refreshTokenIssued",
    "refreshTokenRotates",
    "refreshTokenSingleUse",
    "revocationSupported",
  ]);
  triFix(impl.appReadiness, ["scopeApproval"]);
  const flow = impl.flow as Record<string, unknown> | undefined;
  if (flow && typeof flow.clientType === "string" && !CLIENT_TYPES.has(flow.clientType as string)) {
    flow.clientType = "unknown";
  }
}

const CLAIM_KINDS = new Set(["verified", "observed", "estimate", "inference", "unknown"]);
const EXEC_MODES = new Set(["manual", "agent-assisted", "automatable"]);
const PATHS = new Set(["managed-auth", "custom-oauth", "other"]);
const DIFFICULTIES = new Set(["easy", "moderate", "hard", "unknown"]);
const PKCE = new Set(["required", "supported", "not-supported", "unknown"]);
const CATEGORIES = new Set([
  "register-provider-app",
  "configure-integration",
  "authorize-user",
  "verify-data-access",
  "provider-approval",
]);

/**
 * Coerce out-of-enum string values the model occasionally emits (e.g.
 * uncertainties[].kind = "open-question") to safe defaults, so one stray enum
 * doesn't discard an otherwise-valid guide. Walks the whole object.
 */
function coerceEnums(root: Record<string, unknown>): void {
  const fix = (obj: Record<string, unknown>, key: string, allowed: Set<string>, fallback: string) => {
    if (typeof obj[key] === "string" && !allowed.has(obj[key] as string)) obj[key] = fallback;
  };
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    fix(obj, "kind", CLAIM_KINDS, "unknown");
    fix(obj, "executionMode", EXEC_MODES, "manual");
    fix(obj, "recommendedPath", PATHS, "other");
    fix(obj, "rating", DIFFICULTIES, "unknown");
    fix(obj, "pkce", PKCE, "unknown");
    fix(obj, "category", CATEGORIES, "configure-integration");
    for (const v of Object.values(obj)) walk(v);
  };
  walk(root);
}

/**
 * Estimate.unit only allows minutes|hours|days, but the model legitimately
 * reaches for "seconds" (e.g. a 21600s token lifetime) or "weeks"/"months"
 * (e.g. an app-review timeline). Those are real facts — discarding the whole
 * guide over a unit label would violate the honesty contract. Instead, rescale
 * the value into the nearest in-enum unit so the magnitude is preserved.
 *
 * Walks every object; any node with a string `unit` + numeric `value` that
 * carries an out-of-enum time unit is converted in place. In-enum units and
 * non-time units (which stay null-coerced elsewhere) are left untouched.
 */
function normalizeUnits(root: Record<string, unknown>): void {
  // Conversion factor to the target in-enum unit, chosen to keep the value
  // human-readable (seconds → hours when it divides cleanly, else minutes).
  const toMinutes: Record<string, number> = {
    second: 1 / 60,
    seconds: 1 / 60,
    sec: 1 / 60,
    secs: 1 / 60,
    minute: 1,
    minutes: 1,
    min: 1,
    mins: 1,
    hour: 60,
    hours: 60,
    hr: 60,
    hrs: 60,
    day: 1440,
    days: 1440,
    week: 10080,
    weeks: 10080,
    month: 43200,
    months: 43200,
    year: 525600,
    years: 525600,
  };

  const convert = (obj: Record<string, unknown>) => {
    const unit = obj.unit;
    if (typeof unit !== "string") return;
    const u = unit.trim().toLowerCase();
    if (u === "minutes" || u === "hours" || u === "days") return; // already valid
    const factor = toMinutes[u];
    if (factor === undefined) return; // unknown unit — leave for enum coercion → null
    const value = typeof obj.value === "number" ? obj.value : null;
    if (value === null) {
      obj.unit = "minutes";
      return;
    }
    const minutes = value * factor;
    // Pick the largest unit that yields a whole, readable number.
    if (minutes % 1440 === 0 && minutes >= 1440) {
      obj.value = minutes / 1440;
      obj.unit = "days";
    } else if (minutes % 60 === 0 && minutes >= 60) {
      obj.value = minutes / 60;
      obj.unit = "hours";
    } else {
      obj.value = Math.max(1, Math.round(minutes));
      obj.unit = "minutes";
    }
  };

  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if ("unit" in obj) convert(obj);
    for (const v of Object.values(obj)) walk(v);
  };
  walk(root);
}

/**
 * Estimate requires { kind, rationale }. The model sometimes emits an estimate
 * (a timeline, a token lifetime) with a value+unit but no rationale, or with a
 * missing kind — which would fail validation and discard the entire guide.
 * Rather than drop a real datum, backfill the structural fields at the known
 * Estimate-bearing slots so the honest value survives. We target slots
 * precisely (not any object with a `kind`) to avoid corrupting other claims.
 */
function repairEstimates(root: Record<string, unknown>): void {
  const repair = (val: unknown) => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return;
    const e = val as Record<string, unknown>;
    // Only touch things that actually look like an Estimate payload.
    const looksLikeEstimate =
      "value" in e || "unit" in e || "kind" in e || "rationale" in e;
    if (!looksLikeEstimate) return;
    if (typeof e.kind !== "string") {
      e.kind = typeof e.value === "number" ? "estimate" : "unknown";
    }
    if (typeof e.rationale !== "string" || e.rationale.trim() === "") {
      e.rationale = "Not stated in the retrieved sources.";
    }
  };

  repair(root.activeEffort);
  repair(root.externalWaiting);
  const impl = root.implementation as Record<string, unknown> | undefined;
  if (impl) repair(impl.tokenLifetime);
  if (Array.isArray(root.approvalRequirements)) {
    for (const a of root.approvalRequirements as Record<string, unknown>[]) {
      if (a && typeof a === "object") repair(a.timeline);
    }
  }
}
