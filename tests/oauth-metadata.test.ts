import { describe, it, expect } from "vitest";
import { parseOAuthMetadata, metadataCandidateHosts } from "@/lib/research/oauth-metadata";

const SRC = "https://airtable.com/.well-known/oauth-authorization-server";

describe("parseOAuthMetadata", () => {
  it("parses a real RFC 8414 document (Airtable-shaped)", () => {
    const body = JSON.stringify({
      issuer: "https://airtable.com/oauth2/v1",
      authorization_endpoint: "https://airtable.com/oauth2/v1/authorize",
      token_endpoint: "https://airtable.com/oauth2/v1/token",
      registration_endpoint: "https://airtable.com/oauth2/v1/register",
      scopes_supported: ["data.records:read", "data.records:write", "schema.bases:read"],
      code_challenge_methods_supported: ["S256"],
    });
    const { meta: m, reason } = parseOAuthMetadata(body, SRC);
    expect(reason).toBe("metadata");
    expect(m).not.toBeNull();
    expect(m!.authorizeUrl).toBe("https://airtable.com/oauth2/v1/authorize");
    expect(m!.tokenUrl).toBe("https://airtable.com/oauth2/v1/token");
    expect(m!.registrationUrl).toBe("https://airtable.com/oauth2/v1/register");
    expect(m!.supportedScopes).toContain("data.records:read");
    expect(m!.pkceMethods).toEqual(["S256"]);
    expect(m!.pkce).toBe("supported");
    expect(m!.sourceUrl).toBe(SRC);
  });

  it("reports pkce 'unknown' and null supportedScopes when neither field is present", () => {
    const { meta: m } = parseOAuthMetadata(
      JSON.stringify({
        authorization_endpoint: "https://airtable.com/authorize",
        token_endpoint: "https://airtable.com/token",
      }),
      SRC,
    );
    expect(m!.pkce).toBe("unknown");
    expect(m!.pkceMethods).toBeNull();
    // Absent scopes_supported must be null (undetermined), NOT [] (explicitly empty).
    expect(m!.supportedScopes).toBeNull();
  });

  it("distinguishes an explicitly empty scopes_supported from an absent one", () => {
    const { meta: m } = parseOAuthMetadata(
      JSON.stringify({
        issuer: "https://airtable.com",
        authorization_endpoint: "https://airtable.com/authorize",
        token_endpoint: "https://airtable.com/token",
        scopes_supported: [],
      }),
      SRC,
    );
    expect(m!.supportedScopes).toEqual([]); // present-but-empty, not null
  });

  it("rejects a document whose issuer belongs to a different host (RFC 8414 §3.3)", () => {
    const { meta: m, reason } = parseOAuthMetadata(
      JSON.stringify({
        issuer: "https://evil.example.com",
        authorization_endpoint: "https://airtable.com/authorize",
        token_endpoint: "https://airtable.com/token",
      }),
      SRC,
    );
    expect(m).toBeNull();
    expect(reason).toBe("issuer-mismatch");
  });

  it("rejects a document with no usable endpoints", () => {
    const { meta, reason } = parseOAuthMetadata(JSON.stringify({ issuer: "https://airtable.com" }), SRC);
    expect(meta).toBeNull();
    expect(reason).toBe("no-endpoints");
  });

  it("ignores non-http(s) endpoint values (no javascript: etc.)", () => {
    const { meta: m } = parseOAuthMetadata(
      JSON.stringify({
        issuer: "https://airtable.com",
        authorization_endpoint: "javascript:alert(1)",
        token_endpoint: "https://airtable.com/token",
      }),
      SRC,
    );
    expect(m!.authorizeUrl).toBeNull();
    expect(m!.tokenUrl).toBe("https://airtable.com/token");
  });

  it("returns null + reason on non-JSON (e.g. an HTML 404 page)", () => {
    const { meta, reason } = parseOAuthMetadata("<!doctype html><html>not found</html>", SRC);
    expect(meta).toBeNull();
    expect(reason).toBe("non-json");
  });
});

describe("metadataCandidateHosts", () => {
  it("tries source-derived hosts first, then common OAuth subdomains, bounded", () => {
    const hosts = metadataCandidateHosts(["asana.com"]);
    // The given host comes first.
    expect(hosts[0]).toBe("asana.com");
    // The common OAuth subdomain that actually hosts Asana's metadata is included.
    expect(hosts).toContain("app.asana.com");
    expect(hosts).toContain("auth.asana.com");
    // Bounded.
    expect(hosts.length).toBeLessThanOrEqual(16);
  });

  it("keeps an already-specific auth host and dedupes", () => {
    const hosts = metadataCandidateHosts(["account.boldsign.com", "boldsign.com"]);
    expect(hosts[0]).toBe("account.boldsign.com");
    expect(new Set(hosts).size).toBe(hosts.length); // no dupes
  });
});
