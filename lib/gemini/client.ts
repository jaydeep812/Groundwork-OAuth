import { GoogleGenAI } from "@google/genai";
import { MissingApiKeyError } from "@/lib/search/tavily";

/**
 * Gemini access via the official @google/genai SDK.
 *
 * The model id is ALWAYS read from GEMINI_MODEL — never hardcoded. The API key
 * is validated at this boundary. Callers are responsible for validating the
 * returned text with Zod; model-side constraints are best-effort only.
 */

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

function getClient(): { ai: GoogleGenAI; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL;
  if (!model) throw new MissingApiKeyError("GEMINI_MODEL");
  return { ai: new GoogleGenAI({ apiKey }), model };
}

export type GenerateJsonOptions = {
  system: string;
  prompt: string;
  /** JSON schema passed to the SDK for structured output (best-effort). */
  responseJsonSchema?: unknown;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

/**
 * Ask Gemini for a JSON response. Returns the raw text; the caller validates.
 * Retries once on transient (5xx / rate-limit) errors with a short backoff.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<string> {
  const { ai, model } = getClient();
  const maxOutputTokens = opts.maxOutputTokens ?? 16384;

  const run = async (): Promise<string> => {
    const res = await ai.models.generateContent({
      model,
      contents: opts.prompt,
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        ...(opts.responseJsonSchema
          ? { responseJsonSchema: opts.responseJsonSchema }
          : {}),
        maxOutputTokens,
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      },
    });
    const text = res.text;
    const finish = res.candidates?.[0]?.finishReason;
    if (!text || !text.trim()) {
      throw new GeminiError(
        `Gemini returned an empty response (finishReason=${finish ?? "unknown"}). ` +
          `If finishReason is MAX_TOKENS, increase maxOutputTokens or disable thinking.`,
      );
    }
    if (finish && finish !== "STOP") {
      // Likely truncated — JSON will be unparseable. Surface this clearly.
      throw new GeminiError(
        `Gemini response finished with ${finish} (expected STOP) — output is likely truncated. ` +
          `First 200 chars: ${text.slice(0, 200)}`,
      );
    }
    return text;
  };

  try {
    return await run();
  } catch (err) {
    if (isTransient(err)) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        return await run();
      } catch (err2) {
        throw new GeminiError(`Gemini request failed after retry: ${message(err2)}`, err2);
      }
    }
    if (err instanceof GeminiError || err instanceof MissingApiKeyError) throw err;
    throw new GeminiError(`Gemini request failed: ${message(err)}`, err);
  }
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
