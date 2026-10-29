import { describe, it, expect } from "vitest";
import { isSafeHttpUrl, stripHtml } from "@/lib/investigation/safe-fetch";

describe("safe-fetch", () => {
  describe("isSafeHttpUrl", () => {
    it("accepts http(s) URLs with a public hostname", () => {
      expect(isSafeHttpUrl("https://kite.trade/docs")).toBe(true);
      expect(isSafeHttpUrl("http://example.com")).toBe(true);
    });

    it("rejects dangerous schemes", () => {
      expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeHttpUrl("data:text/plain,x")).toBe(false);
      expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
      expect(isSafeHttpUrl("ftp://ftp.example.com")).toBe(false);
    });

    it("rejects loopback and private-range literals", () => {
      expect(isSafeHttpUrl("http://localhost/x")).toBe(false);
      expect(isSafeHttpUrl("http://127.0.0.1/x")).toBe(false);
      expect(isSafeHttpUrl("http://10.0.0.5/x")).toBe(false);
      expect(isSafeHttpUrl("http://192.168.1.1/x")).toBe(false);
      expect(isSafeHttpUrl("http://169.254.1.1/x")).toBe(false);
    });

    it("rejects .local and .internal", () => {
      expect(isSafeHttpUrl("http://foo.local/x")).toBe(false);
      expect(isSafeHttpUrl("http://foo.internal/x")).toBe(false);
    });

    it("rejects hostnames with no dot (e.g. bare labels)", () => {
      expect(isSafeHttpUrl("http://just-a-label/x")).toBe(false);
    });

    it("rejects garbage", () => {
      expect(isSafeHttpUrl("not a url")).toBe(false);
      expect(isSafeHttpUrl("")).toBe(false);
    });
  });

  describe("stripHtml", () => {
    it("removes script and style blocks and tags", () => {
      const html =
        "<html><head><style>a{color:red}</style><script>evil()</script></head><body><h1>Hi</h1><p>there &amp; here</p></body></html>";
      expect(stripHtml(html)).toBe("Hi there & here");
    });

    it("collapses whitespace and trims", () => {
      expect(stripHtml("<p>   hello   world   </p>")).toBe("hello world");
    });

    it("decodes common entities", () => {
      expect(stripHtml("5 &lt; 10 &amp; 10 &gt; 5 &quot;hi&quot; &#39;ok&#39;")).toBe(
        `5 < 10 & 10 > 5 "hi" 'ok'`,
      );
    });
  });
});
