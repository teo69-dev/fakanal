import { describe, expect, it } from "vitest";
import { clientIp, hashIp, readJsonBody, sameOrigin } from "./http";

const req = (headers: Record<string, string>, body = "{}", url = "https://fakanal.test/api/x") =>
  new Request(url, { method: "POST", headers, body });

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for, then the first x-forwarded-for entry, then x-real-ip", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-forwarded-for": "2.2.2.2, 9.9.9.9", "x-real-ip": "3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(req({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("is salted and never contains the address", () => {
    const a = hashIp("1.2.3.4", "salt-one-salt-one");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("1.2.3.4");
    expect(hashIp("1.2.3.4", "salt-two-salt-two")).not.toBe(a);
    expect(hashIp("1.2.3.5", "salt-one-salt-one")).not.toBe(a);
  });
});

describe("sameOrigin", () => {
  const h = (origin: string | null, host = "fakanal.test") => req({ host, ...(origin ? { origin } : {}) });
  it("accepts only the site's own host, rejects look-alikes and a missing or null Origin", () => {
    expect(sameOrigin(h("https://fakanal.test"))).toBe(true);
    expect(sameOrigin(h("https://fakanal.test.evil.example"))).toBe(false);
    expect(sameOrigin(h("https://sub.fakanal.test"))).toBe(false);
    expect(sameOrigin(h("https://fakanal.test:8443"))).toBe(false);
    expect(sameOrigin(h("null"))).toBe(false);
    expect(sameOrigin(h("not a url"))).toBe(false);
    expect(sameOrigin(h(null))).toBe(false);
  });
});

describe("readJsonBody", () => {
  const json = { "content-type": "application/json" };
  it("reads JSON up to the limit and refuses bigger bodies by counting what arrives", async () => {
    expect(await readJsonBody(req(json, '{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJsonBody(req(json, JSON.stringify({ a: "x".repeat(200) })), 100)).toEqual({ ok: false, status: 413 });
  });
  it("refuses by the declared length without reading", async () => {
    expect(await readJsonBody(req({ ...json, "content-length": "999999" }, "{}"), 100)).toEqual({ ok: false, status: 413 });
  });
  it("answers 415 for other content types and 400 for broken JSON", async () => {
    expect(await readJsonBody(req({ "content-type": "text/plain" }, "{}"))).toEqual({ ok: false, status: 415 });
    expect(await readJsonBody(req(json, "{nope"))).toEqual({ ok: false, status: 400 });
  });
});
