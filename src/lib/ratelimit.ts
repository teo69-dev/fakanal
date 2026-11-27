import { randomUUID } from "node:crypto";
import type { Store } from "./store";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILED = 5;
export const WRITE_WINDOW_MS = 60 * 60 * 1000;
export const WRITE_MAX_PER_WINDOW = 30;

/*
 * Both limits are RESERVE-THEN-CHECK, not check-then-act. A check-then-act limit (count, decide, record later) lets any
 * number of simultaneous requests through, because none of them can see the others yet (measured by the reviewer: 40
 * parallel wrong passwords all got compared). Here a request first writes its own row, then counts the rows including
 * its own, and only the requests that still fit go on:
 *   - the j-th request to pass saw at least j rows (the rows of the earlier passers stay), so at most MAX can pass;
 *   - a request that does not fit removes its own row again, so a refused attempt neither extends the lock nor counts.
 * The counters live in the database because serverless instances share no memory.
 *
 * This only works while EVERY Store call stays a separate, immediately committed statement (the neon-http driver
 * behaves that way). Do not wrap enterLogin or confirmWrite in a database transaction: the rows written inside it
 * would stay invisible to the other requests until it ends, and the limits could be bypassed again.
 * A request that is cut off (serverless timeout) between its insert and its check leaves its row behind: for the login
 * that counts as a failed guess (expires after the window), for a recipe the limit may be exceeded by that one.
 */

export type WindowGate =
  | { allowed: true; release: () => Promise<void> }
  | { allowed: false; retryAfterSeconds: number };

/**
 * One reserve-then-check counter: at most `max` attempts per `key` within the window. The attempt is written first
 * (a row with its own id), then the rows of the key are counted including the new one; a request that does not fit
 * removes its own row again. `release()` takes the attempt back (a correct password). Rows older than the LOGIN
 * window are purged on every call, so every counter here must use a window no longer than that.
 */
export async function enterWindow(store: Store, key: string, max: number, windowMs: number, now = new Date()): Promise<WindowGate> {
  const since = new Date(now.getTime() - windowMs);
  await store.purgeAttempts(new Date(now.getTime() - LOGIN_WINDOW_MS));
  const id = randomUUID();
  await store.addAttempt(key, id);
  const { count, oldest } = await store.recentAttempts(key, since);
  if (count > max) {
    await store.deleteAttempt(id);
    const frees = (oldest ?? now).getTime() + windowMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((frees - now.getTime()) / 1000)) };
  }
  return { allowed: true, release: () => store.deleteAttempt(id) };
}

export type LoginGate = WindowGate;

/**
 * Login limit per IP hash: at most LOGIN_MAX_FAILED wrong guesses within the window. Call it BEFORE comparing the
 * password; when it answers `allowed`, the attempt is already counted as a failure, and `release()` (only on a
 * correct password) takes the row back.
 */
export function enterLogin(store: Store, ipHash: string, now = new Date()): Promise<LoginGate> {
  return enterWindow(store, ipHash, LOGIN_MAX_FAILED, LOGIN_WINDOW_MS, now);
}

export const IMPORT_WINDOW_MS = LOGIN_WINDOW_MS;
export const IMPORT_MAX_PER_IP = 10;
export const IMPORT_MAX_TOTAL = 30;

/**
 * Link imports fetch a foreign page, so they are limited twice: per address and for the whole site (one shared
 * password). Every import counts, successful or not; nothing is released. The keys cannot collide with a login key
 * (those are hex digests). Returns the first refusal, or null when both fit.
 */
export async function enterImport(store: Store, ipHash: string, now = new Date()): Promise<{ retryAfterSeconds: number } | null> {
  const perIp = await enterWindow(store, `import:${ipHash}`, IMPORT_MAX_PER_IP, IMPORT_WINDOW_MS, now);
  if (!perIp.allowed) return { retryAfterSeconds: perIp.retryAfterSeconds };
  const total = await enterWindow(store, "import:all", IMPORT_MAX_TOTAL, IMPORT_WINDOW_MS, now);
  if (!total.allowed) {
    await perIp.release(); // this refused request does not count against the address either
    return { retryAfterSeconds: total.retryAfterSeconds };
  }
  return null;
}

/** Cheap early refusal for the sequential case; the authoritative check is `confirmWrite` after the insert. */
export async function checkWriteLimit(store: Store, now = new Date()): Promise<boolean> {
  const n = await store.countRecipesSince(new Date(now.getTime() - WRITE_WINDOW_MS));
  return n < WRITE_MAX_PER_WINDOW;
}

/**
 * Call AFTER the recipe is inserted: counts the recipes of the last hour including the new one. If it does not fit,
 * the new recipe is deleted again and false is returned. At most WRITE_MAX_PER_WINDOW recipes per hour survive in
 * total (one shared password, so one shared budget), however many requests arrive at once. A refused recipe may be
 * visible for a few milliseconds before it is removed.
 */
export async function confirmWrite(store: Store, recipeId: string, now = new Date()): Promise<boolean> {
  const n = await store.countRecipesSince(new Date(now.getTime() - WRITE_WINDOW_MS));
  if (n <= WRITE_MAX_PER_WINDOW) return true;
  await store.deleteRecipe(recipeId);
  return false;
}
