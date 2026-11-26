// Secrets come from the environment only (Vercel project settings). They are read at call time, never at import time, and
// a missing or too weak value makes the caller fail CLOSED (the routes answer 503), it never lets a request through.

export const MIN_SESSION_SECRET = 32;
export const MIN_IP_SALT = 16;

export function adminPassword(): string | undefined {
  const v = process.env.RECIPE_ADMIN_PASSWORD;
  return v ? v : undefined;
}

export function sessionSecret(): string | undefined {
  const v = process.env.RECIPE_SESSION_SECRET;
  return v && v.length >= MIN_SESSION_SECRET ? v : undefined;
}

export function ipSalt(): string | undefined {
  const v = process.env.RECIPE_IP_SALT;
  return v && v.length >= MIN_IP_SALT ? v : undefined;
}
