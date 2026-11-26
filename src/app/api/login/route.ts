import { passwordMatches, SESSION_TTL_SECONDS, sessionCookieHeader, signSession } from "@/lib/auth";
import { adminPassword, ipSalt, sessionSecret } from "@/lib/env";
import { clientIp, empty, hashIp, json, readJsonBody, sameOrigin } from "@/lib/http";
import { checkLoginLimit } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { loginSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const password = adminPassword();
  const secret = sessionSecret();
  const salt = ipSalt();
  // not configured: refuse, never let anybody in
  if (!password || !secret || !salt) return json({ error: "not_configured" }, 503);

  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  const body = await readJsonBody(request, 4096);
  if (!body.ok) return json({ error: "bad_request" }, body.status);
  const parsed = loginSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad_request" }, 400);

  const store = getStore();
  const ipHash = hashIp(clientIp(request), salt);

  const limit = await checkLoginLimit(store, ipHash);
  if (limit.limited) {
    return json({ error: "too_many_attempts" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
  }

  if (!passwordMatches(parsed.data.password, password)) {
    await store.addAttempt(ipHash);
    return json({ error: "wrong_password" }, 401);
  }

  const token = signSession(Date.now() + SESSION_TTL_SECONDS * 1000, secret);
  return empty(204, {
    "set-cookie": sessionCookieHeader(token, SESSION_TTL_SECONDS, process.env.NODE_ENV === "production"),
  });
}
