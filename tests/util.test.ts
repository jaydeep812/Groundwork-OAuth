import { describe, it, expect } from "vitest";
import { normalizeProviderUrl, providerNameFromUrl, slugify } from "@/lib/util/text";

describe("normalizeProviderUrl", () => {
  it("adds https to a bare domain", () => {
    expect(normalizeProviderUrl("notion.so")).toBe("https://notion.so/");
  });

  it("upgrades http to https and strips credentials", () => {
    expect(normalizeProviderUrl("http://user:pass@example.com/x")).toBe("https://example.com/x");
  });

  it("rejects dangerous schemes", () => {
    expect(normalizeProviderUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeProviderUrl("data:text/html,x")).toBeNull();
    expect(normalizeProviderUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects bare words without a dot", () => {
    expect(normalizeProviderUrl("notion")).toBeNull();
    expect(normalizeProviderUrl("   ")).toBeNull();
  });
});

describe("providerNameFromUrl", () => {
  it("extracts a capitalized base name", () => {
    expect(providerNameFromUrl("https://www.notion.so")).toBe("Notion");
    expect(providerNameFromUrl("https://api.slack.com")).toBe("Api"); // honest: takes first label
  });
});

describe("slugify", () => {
  it("produces kebab-case", () => {
    expect(slugify("Google APIs")).toBe("google-apis");
    expect(slugify("  Hello,  World! ")).toBe("hello-world");
  });
});
