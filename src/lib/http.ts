import { createHash } from "node:crypto";

export const MAX_BODY_BYTES = 64 * 1024;

export function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function empty(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** CSRF defence next to SameSite=Strict: a write must come from our own host. A missing Origin is refused too. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 };

/** Reads a JSON body of at most `limit` bytes, counting what actually arrives (Content-Length alone can lie). */
export async function readJsonBody(request: Request, limit = MAX_BODY_BYTES): Promise<BodyResult> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return { ok: false, status: 415 };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/**
 * Client address. Vercel overwrites X-Forwarded-For with the client address and does not forward external values; its
 * docs describe x-vercel-forwarded-for as the same value that also stays right behind a proxy placed in front of
 * Vercel, so that one comes first. Without any of them (e.g. a local `next start`) everybody shares one bucket.
 */
export function clientIp(request: Request): string {
  const first = (name: string) => request.headers.get(name)?.split(",")[0]?.trim();
  return first("x-vercel-forwarded-for") || first("x-forwarded-for") || first("x-real-ip") || "unknown";
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`, "utf8").digest("hex");
}
