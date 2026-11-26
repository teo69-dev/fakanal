import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { passwordMatches, readCookie, SESSION_COOKIE, sessionCookieHeader, signSession, verifySession } from "./auth";

const SECRET = "test-secret-test-secret-test-secret-0123";
const NOW = 1_700_000_000_000;

describe("passwordMatches", () => {
  it("accepts only the exact password, whatever the lengths", () => {
    expect(passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(passwordMatches("correct horsE", "correct horse")).toBe(false);
    expect(passwordMatches("", "correct horse")).toBe(false);
    expect(passwordMatches("correct horse and more", "correct horse")).toBe(false);
    expect(passwordMatches("ő", "ő")).toBe(true);
  });
});

describe("session token", () => {
  it("verifies a fresh token", () => {
    expect(verifySession(signSession(NOW + 1000, SECRET), SECRET, NOW)).toBe(true);
  });

  it("rejects an expired token (the expiry instant itself is expired)", () => {
    expect(verifySession(signSession(NOW - 1, SECRET), SECRET, NOW)).toBe(false);
    expect(verifySession(signSession(NOW, SECRET), SECRET, NOW)).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    const other = signSession(NOW + 1000, "another-secret-another-secret-another-0");
    expect(verifySession(other, SECRET, NOW)).toBe(false);
  });

  it("rejects a token whose payload was changed (a longer expiry with the old signature)", () => {
    const [, sig] = signSession(NOW + 1000, SECRET).split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ exp: NOW + 10 ** 12 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of [undefined, null, "", "a", "a.b.c", ".", "x.y", `${"a".repeat(600)}.b`]) {
      expect(verifySession(bad as string | undefined, SECRET, NOW)).toBe(false);
    }
  });

  it("rejects a correctly signed payload that has no numeric expiry", () => {
    const sign = (obj: unknown) => {
      const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
      return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    };
    expect(verifySession(sign({ exp: NOW + 1000 }), SECRET, NOW)).toBe(true);
    expect(verifySession(sign({ exp: "never" }), SECRET, NOW)).toBe(false);
    expect(verifySession(sign({}), SECRET, NOW)).toBe(false);
    expect(verifySession(sign({ exp: null }), SECRET, NOW)).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("builds an HttpOnly, SameSite=Strict, Path=/ cookie, Secure when asked", () => {
    const secure = sessionCookieHeader("tok", 43200, true);
    expect(secure).toBe(`${SESSION_COOKIE}=tok; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
    expect(sessionCookieHeader("tok", 43200, false)).not.toContain("Secure");
  });

  it("reads one cookie out of a Cookie header", () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=abc.def; b=2`, SESSION_COOKIE)).toBe("abc.def");
    expect(readCookie("a=1", SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined();
  });
});
