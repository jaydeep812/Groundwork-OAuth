import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

/**
 * LangChain-native Gemini access for graph nodes.
 *
 * We deliberately do NOT hand our @google/genai `Type`-enum schemas to
 * withStructuredOutput: those use uppercase type names ("OBJECT") that are not
 * standard JSON Schema. Instead we ask for JSON output and let the caller
 * validate with Zod (the real authority, unchanged from the former pipelines).
 *
 * The model id is always read from GEMINI_MODEL; the key from GEMINI_API_KEY.
 */

export class GraphLlmError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GraphLlmError";
  }
}

function getModel(opts: { maxOutputTokens?: number } = {}): ChatGoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey) throw new GraphLlmError("Missing required environment variable: GEMINI_API_KEY");
  if (!model) throw new GraphLlmError("Missing required environment variable: GEMINI_MODEL");
  return new ChatGoogleGenerativeAI({
    apiKey,
    model,
    temperature: 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 16384,
    maxRetries: 1,
    json: true,
  });
}

/**
 * Ask Gemini (via LangChain) for a JSON response. Returns the raw string; the
 * caller parses + validates with Zod. Retries transient errors, honoring any
 * provider-suggested retry delay.
 */
export async function generateJsonLC(opts: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const llm = getModel(opts);
  const messages = [
    { role: "system" as const, content: opts.system },
    { role: "user" as const, content: opts.prompt },
  ];

  const run = async (): Promise<string> => {
    const res = await llm.invoke(messages, {
      timeout: opts.timeoutMs ?? 120_000,
    });
    const text = typeof res.content === "string" ? res.content : extractText(res.content);
    if (!text || !text.trim()) {
      throw new GraphLlmError("Gemini returned an empty response.");
    }
    return text;
  };

  try {
    return await run();
  } catch (err) {
    if (!isTransient(err)) {
      if (err instanceof GraphLlmError) throw err;
      throw new GraphLlmError(`Gemini request failed: ${message(err)}`, err);
    }
    // Transient (rate limit / overload / timeout). Retry up to twice, honoring
    // Gemini's suggested retry delay when it reports one on a 429.
    let lastErr = err;
    for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      const waitMs = suggestedRetryMs(lastErr) ?? 1500 * attempt;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, MAX_RETRY_WAIT_MS)));
      try {
        return await run();
      } catch (err2) {
        lastErr = err2;
        if (!isTransient(err2)) break;
      }
    }
    throw new GraphLlmError(`Gemini request failed after retry: ${message(lastErr)}`, lastErr);
  }
}

/**
 * Ask Gemini for a plain-text / structured response and return the parsed JSON
 * value. Thin wrapper over generateJsonLC used by the planner node, which
 * expects a small { queries: string[] } object.
 */
export async function generateObjectLC<T>(opts: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<T> {
  const text = await generateJsonLC(opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GraphLlmError("Gemini returned invalid JSON.");
  }
}

function extractText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTransient(err: unknown): boolean {
  const m = message(err).toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("500") ||
    m.includes("503") ||
    m.includes("unavailable") ||
    m.includes("timeout")
  );
}

/** How many times to retry a transient error, and the per-wait ceiling. */
const MAX_TRANSIENT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 45_000;

/**
 * Parse Gemini's suggested retry delay (ms) from a rate-limit error, if any.
 * Gemini reports "retryDelay":"65s" on a 429. Returns a small buffer on top so
 * we clear the window rather than race it. A multi-hour daily-quota delay is
 * capped by MAX_RETRY_WAIT_MS so we fail fast instead of hanging.
 */
function suggestedRetryMs(err: unknown): number | null {
  const m = message(err);
  const match = m.match(/retrydelay["':\s]+([\d.]+)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500;
  return null;
}
