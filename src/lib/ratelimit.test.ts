import { describe, expect, it } from "vitest";
import { createFakeStore, newFakeState } from "@/test/fake-store";
import { checkWriteLimit, confirmWrite, enterImport, enterLogin, IMPORT_MAX_PER_IP, IMPORT_MAX_TOTAL, IMPORT_WINDOW_MS, LOGIN_MAX_FAILED, LOGIN_WINDOW_MS, WRITE_MAX_PER_WINDOW } from "./ratelimit";

const NOW = new Date("2026-11-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const attempt = (ip: string, at: Date) => ({ id: crypto.randomUUID(), ip, at });
const fixed = () => {
  const s = newFakeState();
  s.now = () => NOW;
  return s;
};
const recipeAt = (at: Date) => ({ row: { id: crypto.randomUUID() }, ingredients: [], at });

describe("enterLogin", () => {
  it("lets the first 5 attempts through (each is recorded as a failure) and refuses the 6th", async () => {
    const s = fixed();
    const store = createFakeStore(s);
    for (let n = 1; n <= LOGIN_MAX_FAILED; n++) {
      const gate = await enterLogin(store, "h", NOW);
      expect(gate.allowed, `attempt ${n}`).toBe(true);
    }
    expect(s.attempts).toHaveLength(LOGIN_MAX_FAILED);
    const sixth = await enterLogin(store, "h", NOW);
    expect(sixth.allowed).toBe(false);
    // a refused attempt takes its own row back: it does not count and does not extend the lock
    expect(s.attempts).toHaveLength(LOGIN_MAX_FAILED);
  });

  it("release() (a correct password) removes just that attempt's row", async () => {
    const s = fixed();
    const store = createFakeStore(s);
    await enterLogin(store, "h", NOW);
    const gate = await enterLogin(store, "h", NOW);
    expect(s.attempts).toHaveLength(2);
    if (gate.allowed) await gate.release();
    expect(s.attempts).toHaveLength(1);
  });

  it("reports when the oldest failure leaves the window", async () => {
    const s = fixed();
    s.attempts = [attempt("h", ago(10 * 60 * 1000)), ...Array.from({ length: 4 }, () => attempt("h", ago(1000)))];
    const gate = await enterLogin(createFakeStore(s), "h", NOW);
    // 4 + the old one = 5 rows -> this attempt is the 6th and is refused; the old row frees in 5 minutes
    expect(gate).toEqual({ allowed: false, retryAfterSeconds: 5 * 60 });
  });

  it("does not count other addresses or failures older than the window, and deletes the old rows", async () => {
    const s = fixed();
    s.attempts = [
      ...Array.from({ length: 10 }, () => attempt("h", ago(LOGIN_WINDOW_MS + 1000))),
      ...Array.from({ length: 10 }, () => attempt("other", ago(1000))),
    ];
    expect((await enterLogin(createFakeStore(s), "h", NOW)).allowed).toBe(true);
    expect(s.attempts.every((a) => a.at >= ago(LOGIN_WINDOW_MS))).toBe(true);
  });

  it("holds under simultaneous attempts: 40 at once, at most 5 get to compare a password", async () => {
    const s = newFakeState();
    s.delayMs = 8;
    const store = createFakeStore(s);
    const gates = await Promise.all(Array.from({ length: 40 }, () => enterLogin(store, "h")));
    const allowed = gates.filter((g) => g.allowed).length;
    expect(allowed).toBeLessThanOrEqual(LOGIN_MAX_FAILED);
    expect(s.attempts.length).toBeLessThanOrEqual(LOGIN_MAX_FAILED);
  });
});

describe("write limit", () => {
  it("checkWriteLimit: the early check allows 29 and refuses 30 within the hour", async () => {
    const make = (n: number, at: Date) => {
      const s = newFakeState();
      s.recipes = Array.from({ length: n }, () => recipeAt(at));
      return createFakeStore(s);
    };
    expect(await checkWriteLimit(make(WRITE_MAX_PER_WINDOW - 1, ago(60_000)), NOW)).toBe(true);
    expect(await checkWriteLimit(make(WRITE_MAX_PER_WINDOW, ago(60_000)), NOW)).toBe(false);
    expect(await checkWriteLimit(make(99, ago(2 * 3600 * 1000)), NOW)).toBe(true);
  });

  it("confirmWrite keeps the 30th recipe and deletes the 31st", async () => {
    const s = fixed();
    s.recipes = Array.from({ length: WRITE_MAX_PER_WINDOW }, () => recipeAt(ago(60_000)));
    const store = createFakeStore(s);
    expect(await confirmWrite(store, s.recipes[0]!.row.id, NOW)).toBe(true);
    s.recipes.push(recipeAt(ago(1)));
    const extra = s.recipes[s.recipes.length - 1]!.row.id;
    expect(await confirmWrite(store, extra, NOW)).toBe(false);
    expect(s.recipes.some((r) => r.row.id === extra)).toBe(false);
    expect(s.recipes).toHaveLength(WRITE_MAX_PER_WINDOW);
  });

  it("holds under simultaneous writes: 80 at once, at most 30 recipes survive", async () => {
    const s = newFakeState();
    s.delayMs = 8;
    const store = createFakeStore(s);
    const results = await Promise.all(
      Array.from({ length: 80 }, async () => {
        const id = crypto.randomUUID();
        await store.insertRecipe({ id } as never, []);
        return confirmWrite(store, id);
      }),
    );
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(WRITE_MAX_PER_WINDOW);
    expect(s.recipes.length).toBeLessThanOrEqual(WRITE_MAX_PER_WINDOW);
  });
});

describe("enterImport", () => {
  it("lets IMPORT_MAX_PER_IP imports per address through (each counts) and refuses the next with a wait time", async () => {
    const s = fixed();
    const store = createFakeStore(s);
    for (let n = 1; n <= IMPORT_MAX_PER_IP; n++) expect(await enterImport(store, "h", NOW), `import ${n}`).toBeNull();
    const refused = await enterImport(store, "h", NOW);
    expect(refused).not.toBeNull();
    expect(refused?.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused?.retryAfterSeconds).toBeLessThanOrEqual(IMPORT_WINDOW_MS / 1000);
    // the refused one left no row behind, neither for the address nor for the whole site
    expect(s.attempts.filter((a) => a.ip === "import:h")).toHaveLength(IMPORT_MAX_PER_IP);
    expect(s.attempts.filter((a) => a.ip === "import:all")).toHaveLength(IMPORT_MAX_PER_IP);
  });

  it("limits the whole site as well, and a request refused for that reason gives back its address row", async () => {
    const s = fixed();
    const store = createFakeStore(s);
    for (let n = 0; n < IMPORT_MAX_TOTAL; n++) expect(await enterImport(store, `ip${n}`, NOW)).toBeNull();
    expect(await enterImport(store, "another", NOW)).not.toBeNull();
    expect(s.attempts.filter((a) => a.ip === "import:another")).toHaveLength(0);
    expect(s.attempts.filter((a) => a.ip === "import:all")).toHaveLength(IMPORT_MAX_TOTAL);
  });

  it("forgets imports older than the window", async () => {
    const s = fixed();
    s.attempts = Array.from({ length: 50 }, () => attempt("import:h", ago(IMPORT_WINDOW_MS + 1000)));
    s.attempts.push(...Array.from({ length: 50 }, () => attempt("import:all", ago(IMPORT_WINDOW_MS + 1000))));
    expect(await enterImport(createFakeStore(s), "h", NOW)).toBeNull();
  });

  it("shares nothing with the login counter of the same address", async () => {
    const s = fixed();
    const store = createFakeStore(s);
    for (let n = 0; n < IMPORT_MAX_PER_IP; n++) await enterImport(store, "h", NOW);
    expect((await enterLogin(store, "h", NOW)).allowed).toBe(true); // 10 imports did not use up the login allowance
    for (let n = 0; n < LOGIN_MAX_FAILED; n++) await enterLogin(store, "g", NOW);
    expect(await enterImport(store, "g", NOW)).toBeNull(); // and failed logins do not count as imports
  });

  it("holds under simultaneous imports: 40 at once from one address, at most 10 get through", async () => {
    const s = newFakeState();
    s.delayMs = 8;
    const store = createFakeStore(s);
    const results = await Promise.all(Array.from({ length: 40 }, () => enterImport(store, "h")));
    expect(results.filter((r) => r === null).length).toBeLessThanOrEqual(IMPORT_MAX_PER_IP);
  });
});
