import { describe, expect, it } from "vitest";
import { isAllowedImageUrl, isPublicHostname } from "./url";

describe("isAllowedImageUrl", () => {
  it("accepts ordinary public https image addresses", () => {
    for (const ok of [
      "https://example.com/gulyas.jpg",
      "https://images.example.co.uk/a/b.png?w=400&q=80",
      "https://cdn.mysite.hu/kep.webp#x",
      "https://EXAMPLE.com./a.jpg", // trailing dot and capitals are fine
      "https://pörkölt.hu/a.jpg", // an IDN host becomes punycode
      "https://example.com:8443/a.jpg",
    ]) {
      expect(isAllowedImageUrl(ok), ok).toBe(true);
    }
  });

  it("refuses everything that is not https", () => {
    for (const bad of [
      "http://example.com/a.jpg",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/png;base64,AAAA",
      "ftp://example.com/a.jpg",
      "file:///etc/passwd",
      "//example.com/a.jpg",
      "example.com/a.jpg",
      "not a url",
      "",
    ]) {
      expect(isAllowedImageUrl(bad), bad).toBe(false);
    }
  });

  it("refuses IPv4 literals in every spelling the URL parser knows", () => {
    for (const bad of [
      "https://1.2.3.4/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://10.0.0.5/a.jpg",
      "https://192.168.1.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://0.0.0.0/a.jpg",
      "https://2130706433/a.jpg", // decimal form of 127.0.0.1
      "https://0x7f000001/a.jpg", // hex
      "https://0x7f.0.0.1/a.jpg",
      "https://017700000001/a.jpg", // octal
      "https://127.1/a.jpg", // short form
      "https://8.8.8.8:443/a.jpg",
    ]) {
      expect(isAllowedImageUrl(bad), bad).toBe(false);
    }
  });

  it("refuses IPv6 literals, mapped IPv4 included", () => {
    for (const bad of [
      "https://[::1]/a.jpg",
      "https://[2001:db8::1]/a.jpg",
      "https://[::ffff:127.0.0.1]/a.jpg",
      "https://[fe80::1]/a.jpg",
      "https://[::]:8443/a.jpg",
    ]) {
      expect(isAllowedImageUrl(bad), bad).toBe(false);
    }
  });

  it("refuses localhost, single-word and internal or reserved host names", () => {
    for (const bad of [
      "https://localhost/a.jpg",
      "https://LOCALHOST:3000/a.jpg",
      "https://localhost./a.jpg",
      "https://foo.localhost/a.jpg",
      "https://intranet/a.jpg",
      "https://router/a.jpg",
      "https://printer.local/a.jpg",
      "https://nas.home/a.jpg",
      "https://db.internal/a.jpg",
      "https://wiki.corp/a.jpg",
      "https://host.lan/a.jpg",
      "https://x.localdomain/a.jpg",
      "https://1.0.0.127.in-addr.arpa/a.jpg",
      "https://router.home.arpa/a.jpg",
      "https://thing.invalid/a.jpg",
      "https://thing.test/a.jpg",
      "https://abc.onion/a.jpg",
    ]) {
      expect(isAllowedImageUrl(bad), bad).toBe(false);
    }
  });

  it("refuses credentials in the address", () => {
    for (const bad of ["https://user:pw@example.com/a.jpg", "https://user@example.com/a.jpg", "https://:pw@example.com/a.jpg"]) {
      expect(isAllowedImageUrl(bad), bad).toBe(false);
    }
  });

  it("is not fooled by a public-looking name in the path, query or user part", () => {
    expect(isAllowedImageUrl("https://127.0.0.1/example.com/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://example.com@127.0.0.1/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://localhost/?u=https://example.com")).toBe(false);
    // a backslash is a slash for https URLs: the host the browser uses is example.com, the rest is path
    expect(isAllowedImageUrl("https://example.com\\@127.0.0.1/a.jpg")).toBe(true);
  });
});

describe("isPublicHostname", () => {
  it("looks at the host name only", () => {
    expect(isPublicHostname("example.com")).toBe(true);
    expect(isPublicHostname("a.b.example.com")).toBe(true);
    expect(isPublicHostname("")).toBe(false);
    expect(isPublicHostname("com")).toBe(false);
    expect(isPublicHostname("a..com")).toBe(false);
    expect(isPublicHostname("[::1]")).toBe(false);
    expect(isPublicHostname("::1")).toBe(false);
    expect(isPublicHostname("127.0.0.1")).toBe(false);
  });
});
