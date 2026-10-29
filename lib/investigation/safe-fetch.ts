/**
 * Safe web probe utilities for investigator agents.
 *
 * Rules enforced here:
 *   - http(s) only; no file:/data:/javascript:/private-IP destinations.
 *   - Bounded timeouts (5s head, 10s get).
 *   - Response bodies capped (512 KiB) to prevent prompt-injection blowups
 *     while still capturing large JS-framework doc pages (the 16 KiB cap used
 *     to truncate them, losing endpoint/scope content further down the HTML).
 *   - No request body ever carries a credential-shaped payload (we strip
 *     fields that look like client_secret/password/token on probes).
 *   - User-Agent identifies the tool, honoring robots.txt informally by
 *     keeping requests to public documentation and known API endpoints only.
 */

const HEAD_TIMEOUT_MS = 7_000;
const GET_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 512 * 1024;
const USER_AGENT = "OAuthReadinessGuide/0.2 (+investigation agent, no credentials)";

/** True if `url` is a safe http(s) URL on a non-private host. */
export function isSafeHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  // Reject obvious private / loopback hosts. We don't do full RFC-1918
  // literal checks here because agents only pass domain names in practice.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true;
}

/** Probe outcome. Note: a 2xx/3xx on an existing docs page is a confirmation. */
export type HeadProbe = {
  url: string;
  finalUrl: string | null;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  /** Null means the probe failed before we got a response. */
  error: string | null;
};

/**
 * HEAD-probe a URL. We follow redirects (manual-mode would be stricter but
 * our use case is "is this real docs page served?"). Returns status + final
 * URL. Fails safely with error field populated.
 */
export async function headProbe(url: string, timeoutMs = HEAD_TIMEOUT_MS): Promise<HeadProbe> {
  if (!isSafeHttpUrl(url)) {
    return { url, finalUrl: null, ok: false, status: null, contentType: null, error: "unsafe-url" };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    return {
      url,
      finalUrl: res.url || null,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      error: null,
    };
  } catch (err) {
    return {
      url,
      finalUrl: null,
      ok: false,
      status: null,
      contentType: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

export type GetProbe = HeadProbe & {
  /** Truncated body (at most MAX_BODY_BYTES bytes, UTF-8 decoded). */
  body: string;
  /** True if the body was truncated. */
  truncated: boolean;
};

/**
 * GET a URL and return a bounded body excerpt. Caller is responsible for
 * passing a conservative URL; we DO NOT fetch arbitrary user-supplied URLs.
 */
export async function getProbe(url: string, timeoutMs = GET_TIMEOUT_MS): Promise<GetProbe> {
  if (!isSafeHttpUrl(url)) {
    return {
      url,
      finalUrl: null,
      ok: false,
      status: null,
      contentType: null,
      error: "unsafe-url",
      body: "",
      truncated: false,
    };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,*/*;q=0.8" },
    });

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (reader) {
      while (total < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      if (!(await reader.read()).done) truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const body = buf.subarray(0, MAX_BODY_BYTES).toString("utf8");

    return {
      url,
      finalUrl: res.url || null,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      error: null,
      body,
      truncated,
    };
  } catch (err) {
    return {
      url,
      finalUrl: null,
      ok: false,
      status: null,
      contentType: null,
      error: err instanceof Error ? err.message : String(err),
      body: "",
      truncated: false,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST to an API endpoint with a BOGUS/public params payload to inspect the
 * error contract. Never includes a real credential.
 *
 * The caller passes a plain object; we strip any key that looks credential-
 * shaped as a defense-in-depth measure. Returns status + bounded body.
 */
export async function errorProbePost(
  url: string,
  params: Record<string, string>,
  timeoutMs = GET_TIMEOUT_MS,
): Promise<GetProbe> {
  if (!isSafeHttpUrl(url)) {
    return {
      url,
      finalUrl: null,
      ok: false,
      status: null,
      contentType: null,
      error: "unsafe-url",
      body: "",
      truncated: false,
    };
  }
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (/secret|password|token|refresh|private[-_]?key/i.test(k)) {
      // Caller passed a credential-shaped key — reject the probe loudly.
      return {
        url,
        finalUrl: null,
        ok: false,
        status: null,
        contentType: null,
        error: `refused: credential-shaped key "${k}"`,
        body: "",
        truncated: false,
      };
    }
    sanitized[k] = v;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams(sanitized).toString();
    const res = await fetch(url, {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (reader) {
      while (total < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      if (!(await reader.read()).done) truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const respBody = buf.subarray(0, MAX_BODY_BYTES).toString("utf8");
    return {
      url,
      finalUrl: res.url || null,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      error: null,
      body: respBody,
      truncated,
    };
  } catch (err) {
    return {
      url,
      finalUrl: null,
      ok: false,
      status: null,
      contentType: null,
      error: err instanceof Error ? err.message : String(err),
      body: "",
      truncated: false,
    };
  } finally {
    clearTimeout(t);
  }
}

/** Strip HTML tags for coarse text extraction from a docs page. */
export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
