import { readCookie, SESSION_COOKIE, verifySession } from "./auth";
import { sessionSecret } from "./env";

export type SessionCheck = "ok" | "unauthorized" | "not_configured";

/** For route handlers: checks the session cookie of the request. A missing secret fails closed. */
export function checkRequestSession(request: Request): SessionCheck {
  const secret = sessionSecret();
  if (!secret) return "not_configured";
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return verifySession(token, secret) ? "ok" : "unauthorized";
}
