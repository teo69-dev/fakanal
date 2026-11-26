import type { Store } from "./store";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILED = 5;
export const WRITE_WINDOW_MS = 60 * 60 * 1000;
export const WRITE_MAX_PER_WINDOW = 30;

export type LimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

/**
 * Login limit per IP hash: after LOGIN_MAX_FAILED failures within the window the next attempt is refused (429) before
 * the password is even compared. The counter lives in the database because serverless instances share no memory.
 * Rows older than the window are deleted on every attempt.
 */
export async function checkLoginLimit(store: Store, ipHash: string, now = new Date()): Promise<LimitResult> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  await store.purgeAttempts(since);
  const { count, oldest } = await store.recentAttempts(ipHash, since);
  if (count < LOGIN_MAX_FAILED) return { limited: false };
  const frees = (oldest ?? now).getTime() + LOGIN_WINDOW_MS;
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((frees - now.getTime()) / 1000)) };
}

/** At most WRITE_MAX_PER_WINDOW new recipes per hour in total (one shared password, so one shared budget). */
export async function checkWriteLimit(store: Store, now = new Date()): Promise<boolean> {
  const n = await store.countRecipesSince(new Date(now.getTime() - WRITE_WINDOW_MS));
  return n < WRITE_MAX_PER_WINDOW;
}
