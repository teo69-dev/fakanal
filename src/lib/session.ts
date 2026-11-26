import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./auth";
import { sessionSecret } from "./env";

/** For Server Components: is the visitor logged in (a missing secret means nobody is). */
export async function isLoggedIn(): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, secret);
}
