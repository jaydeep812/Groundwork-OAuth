import { describe, it, expect } from "vitest";
import {
  classifySource,
  hostIsOnDomain,
  isAuthoritative,
  registrableHost,
  sourceTypeLabel,
} from "@/lib/search/classify";

describe("registrableHost", () => {
  it("strips www and keeps two labels for common TLDs", () => {
    expect(registrableHost("www.example.com")).toBe("example.com");
    expect(registrableHost("docs.example.com")).toBe("example.com");
    expect(registrableHost("a.b.c.example.com")).toBe("example.com");
  });

  it("keeps three labels for two-level TLDs", () => {
    expect(registrableHost("foo.co.uk")).toBe("foo.co.uk");
    expect(registrableHost("api.bar.co.in")).toBe("bar.co.in");
  });
});

describe("hostIsOnDomain", () => {
  it("accepts the same host, subdomains, and the www variant", () => {
    expect(hostIsOnDomain("kite.trade", "kite.trade")).toBe(true);
    expect(hostIsOnDomain("developers.kite.trade", "kite.trade")).toBe(true);
    expect(hostIsOnDomain("www.kite.trade", "kite.trade")).toBe(true);
  });

  it("rejects unrelated hosts even if they share a label", () => {
    expect(hostIsOnDomain("kite.zerodha.com", "kite.trade")).toBe(false);
    expect(hostIsOnDomain("example.com", "kite.trade")).toBe(false);
  });
});

describe("classifySource — without provider domain", () => {
  it("recognises Composio hosts", () => {
    expect(classifySource("https://docs.composio.dev/toolkits/github")).toBe("composio-docs");
    expect(classifySource("https://composio.dev/x")).toBe("composio-docs");
  });

  it("recognises known third-party integration platforms", () => {
    expect(classifySource("https://docs.openalgo.in/zerodha")).toBe("third-party-integration");
    expect(classifySource("https://nango.dev/docs/notion/x")).toBe("third-party-integration");
    expect(classifySource("https://clerk.com/docs/x")).toBe("third-party-integration");
  });

  it("recognises community platforms", () => {
    expect(classifySource("https://stackoverflow.com/questions/1")).toBe("community");
    expect(classifySource("https://medium.com/some-post")).toBe("community");
    expect(classifySource("https://www.reddit.com/r/x")).toBe("community");
  });

  it("does NOT credit random hosts as official or developer portals", () => {
    // These are the regressions. The old classifier marked them as
    // developer-portal or official-docs based on URL keywords.
    expect(classifySource("https://docs.openalgo.in/zerodha")).not.toBe("developer-portal");
    expect(classifySource("https://developers.google.com/identity")).toBe("unknown");
    expect(classifySource("https://api.someprovider.com/support/x")).toBe("unknown");
  });

  it("handles github.com conservatively: ComposioHQ counts, rest is unknown", () => {
    expect(classifySource("https://github.com/ComposioHQ/composio/blob/main/x.mdx")).toBe(
      "composio-docs",
    );
    expect(classifySource("https://github.com/some-user/some-repo")).toBe("unknown");
  });

  it("returns unknown for invalid URLs", () => {
    expect(classifySource("not a url")).toBe("unknown");
  });
});

describe("classifySource — with provider domain", () => {
  it("credits provider's own host as official-docs", () => {
    expect(classifySource("https://kite.trade/docs/connect/v3", ["kite.trade"])).toBe(
      "official-docs",
    );
  });

  it("credits a developers subdomain as developer-portal", () => {
    expect(
      classifySource("https://developers.kite.trade/login", ["kite.trade"]),
    ).toBe("developer-portal");
    expect(
      classifySource("https://developer.notion.com/scopes", ["notion.com"]),
    ).toBe("developer-portal");
  });

  it("does NOT upgrade third-party or community hosts even when a domain is supplied", () => {
    expect(
      classifySource("https://docs.openalgo.in/zerodha", ["kite.trade"]),
    ).toBe("third-party-integration");
    expect(
      classifySource("https://stackoverflow.com/q/1", ["kite.trade"]),
    ).toBe("community");
  });

  it("rejects a provider-adjacent host that is NOT on the provider domain", () => {
    // The current Kite guide bug: `kite.zerodha.com` is the user login page,
    // but the API/docs domain is kite.trade. If provider domain is kite.trade,
    // kite.zerodha.com is not official-docs.
    expect(
      classifySource("https://kite.zerodha.com/connect/login", ["kite.trade"]),
    ).toBe("unknown");
  });
});

describe("isAuthoritative / label", () => {
  it("marks only official-docs and developer-portal as authoritative", () => {
    expect(isAuthoritative("official-docs")).toBe(true);
    expect(isAuthoritative("developer-portal")).toBe(true);
    expect(isAuthoritative("composio-docs")).toBe(false);
    expect(isAuthoritative("third-party-integration")).toBe(false);
    expect(isAuthoritative("community")).toBe(false);
    expect(isAuthoritative("unknown")).toBe(false);
  });

  it("has a label for every type", () => {
    for (const t of [
      "official-docs",
      "developer-portal",
      "composio-docs",
      "third-party-integration",
      "community",
      "unknown",
    ] as const) {
      expect(sourceTypeLabel(t)).toBeTruthy();
    }
  });
});

describe("community subdomain on the provider's own domain", () => {
  it("classifies a provider-hosted forum as community, not official-docs", () => {
    // Regression: devforum.zoom.us was tagged official-docs because it is on the
    // zoom.us registrable domain — laundering forum content into an
    // authoritative citation. It must be community.
    expect(classifySource("https://devforum.zoom.us/t/x/1", ["zoom.us"])).toBe("community");
    expect(classifySource("https://community.foo.com/post", ["foo.com"])).toBe("community");
    expect(classifySource("https://discuss.bar.io/q", ["bar.io"])).toBe("community");
  });

  it("still credits real docs / developer subdomains on the same domain", () => {
    expect(classifySource("https://developers.zoom.us/docs/x", ["zoom.us"])).toBe("developer-portal");
    expect(classifySource("https://zoom.us/docs", ["zoom.us"])).toBe("official-docs");
  });
});
