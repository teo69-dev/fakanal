import { describe, expect, it } from "vitest";
import { checkLoginLimit, checkWriteLimit, LOGIN_MAX_FAILED, LOGIN_WINDOW_MS, WRITE_MAX_PER_WINDOW } from "./ratelimit";
import type { Store } from "./store";

function fakeStore(attempts: { ip: string; at: Date }[] = [], recipeTimes: Date[] = []) {
  const store: Store = {
    async purgeAttempts(before) {
      for (let i = attempts.length - 1; i >= 0; i--) if ((attempts[i] as { at: Date }).at < before) attempts.splice(i, 1);
    },
    async recentAttempts(ipHash, since) {
      const mine = attempts.filter((a) => a.ip === ipHash && a.at >= since).sort((a, b) => a.at.getTime() - b.at.getTime());
      return { count: mine.length, oldest: mine[0]?.at ?? null };
    },
    async addAttempt(ipHash) {
      attempts.push({ ip: ipHash, at: new Date() });
    },
    async countRecipesSince(since) {
      return recipeTimes.filter((t) => t >= since).length;
    },
    async insertRecipe() {},
  };
  return { store, attempts };
}

const NOW = new Date("2026-11-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("checkLoginLimit", () => {
  it("allows up to 5 failures and blocks from the next attempt", async () => {
    for (let n = 0; n < LOGIN_MAX_FAILED; n++) {
      const { store } = fakeStore(Array.from({ length: n }, () => ({ ip: "h", at: ago(1000) })));
      expect((await checkLoginLimit(store, "h", NOW)).limited, `after ${n} failures`).toBe(false);
    }
    const { store } = fakeStore(Array.from({ length: LOGIN_MAX_FAILED }, () => ({ ip: "h", at: ago(1000) })));
    expect((await checkLoginLimit(store, "h", NOW)).limited).toBe(true);
  });

  it("reports when the oldest failure leaves the window", async () => {
    const { store } = fakeStore([
      { ip: "h", at: ago(10 * 60 * 1000) },
      ...Array.from({ length: 4 }, () => ({ ip: "h", at: ago(1000) })),
    ]);
    const r = await checkLoginLimit(store, "h", NOW);
    expect(r).toEqual({ limited: true, retryAfterSeconds: 5 * 60 });
  });

  it("does not count other addresses or failures older than the window, and deletes the old rows", async () => {
    const old = Array.from({ length: 10 }, () => ({ ip: "h", at: ago(LOGIN_WINDOW_MS + 1000) }));
    const other = Array.from({ length: 10 }, () => ({ ip: "other", at: ago(1000) }));
    const { store, attempts } = fakeStore([...old, ...other]);
    expect((await checkLoginLimit(store, "h", NOW)).limited).toBe(false);
    expect(attempts.every((a) => a.at >= ago(LOGIN_WINDOW_MS))).toBe(true);
  });
});

describe("checkWriteLimit", () => {
  it("allows 30 recipes per hour in total and blocks the 31st", async () => {
    const times = (n: number) => Array.from({ length: n }, () => ago(60_000));
    expect(await checkWriteLimit(fakeStore([], times(WRITE_MAX_PER_WINDOW - 1)).store, NOW)).toBe(true);
    expect(await checkWriteLimit(fakeStore([], times(WRITE_MAX_PER_WINDOW)).store, NOW)).toBe(false);
    expect(await checkWriteLimit(fakeStore([], Array.from({ length: 99 }, () => ago(2 * 3600 * 1000))).store, NOW)).toBe(true);
  });
});
