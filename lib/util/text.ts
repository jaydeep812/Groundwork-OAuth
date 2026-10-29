/**
 * Small, dependency-free helpers for slugs, ID generation, and safe URL
 * normalization. Kept pure so they are trivial to unit test.
 */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function randomId(prefix = "id"): string {
  // crypto.randomUUID is available in Node 24 and modern browsers.
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid}`;
}

/**
 * Normalize a user-supplied provider website into a safe https URL.
 * Returns null for anything that is not a plain http(s) web URL — this guards
 * against javascript:, data:, file:, and other dangerous schemes.
 */
export function normalizeProviderUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Add a scheme if the user typed a bare domain.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null; // require a real-looking domain

  // Force https and strip any credentials.
  url.protocol = "https:";
  url.username = "";
  url.password = "";
  return url.toString();
}

/** Best-effort provider display name from a URL when the user gave only a site. */
export function providerNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const base = host.split(".")[0] ?? host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return url;
  }
}
