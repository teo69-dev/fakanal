import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "rk_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * Compares the two passwords through their SHA-256 digests, so the comparison takes the same time for any lengths
 * and the length of the real password does not leak.
 */
export function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function mac(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

/** `<base64url {"exp": ms}>.<base64url HMAC-SHA256>` */
export function signSession(expiresAtMs: number, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ exp: expiresAtMs }), "utf8"));
  return `${payload}.${b64url(mac(payload, secret))}`;
}

/** True only for a token this server signed with this secret that has not expired. */
export function verifySession(token: string | undefined | null, secret: string, nowMs = Date.now()): boolean {
  if (!token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts as [string, string];
  const given = Buffer.from(signature, "base64url");
  const expected = mac(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof exp === "number" && Number.isFinite(exp) && exp > nowMs;
  } catch {
    return false;
  }
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
