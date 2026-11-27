import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { newFakeState } from "@/test/fake-store";

const db = vi.hoisted(() => ({ state: undefined as unknown as import("@/test/fake-store").FakeState }));
vi.mock("@/lib/store", async () => {
  const { createFakeStore } = await import("@/test/fake-store");
  return { isUniqueViolation: () => false, getStore: () => createFakeStore(db.state) };
});
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { DELETE as remove } from "./recipes/[slug]/route";

const SECRET = "test-secret-test-secret-test-secret-0123";
const SALT = "test-salt-test-salt-0123";
const HOST = "fakanal.test";
const ORIGIN = `https://${HOST}`;

type Opts = { origin?: string | null; cookie?: string | null; ip?: string };
const session = (exp = Date.now() + 60_000, secret = SECRET) => `${SESSION_COOKIE}=${signSession(exp, secret)}`;
function call(slug: string, o: Opts = {}) {
  const headers: Record<string, string> = { host: HOST, "x-forwarded-for": o.ip ?? "203.0.113.7" };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.cookie !== null) headers.cookie = o.cookie ?? session();
  return remove(new Request(`${ORIGIN}/api/recipes/${slug}`, { method: "DELETE", headers }), { params: Promise.resolve({ slug }) });
}

const seed = (slug: string, ingredients = 2) =>
  db.state.recipes.push({ row: { id: `id-${slug}`, slug, nameSearch: slug }, ingredients: Array.from({ length: ingredients }, (_, i) => ({ position: i, amount: null, name: `i${i}` })), at: new Date() });

beforeEach(() => {
  db.state = newFakeState();
  revalidatePath.mockClear();
  vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
  vi.stubEnv("RECIPE_IP_SALT", SALT);
});
afterEach(() => vi.unstubAllEnvs());

describe("DELETE /api/recipes/[slug]: who may call it", () => {
  it("answers 401 without a session, with a bad, an expired and a foreign-secret one; nothing is deleted", async () => {
    seed("leves-abc123");
    for (const cookie of [null, `${SESSION_COOKIE}=garbage`, session(Date.now() - 1), session(undefined, "another-secret-another-secret-another-0")]) {
      expect((await call("leves-abc123", { cookie })).status, String(cookie)).toBe(401);
    }
    expect(db.state.recipes).toHaveLength(1);
    expect(db.state.attempts).toHaveLength(0); // an unauthenticated call does not touch the counters
  });

  it("answers 403 for a foreign or missing Origin, even with a valid session", async () => {
    seed("leves-abc123");
    for (const origin of ["https://evil.example", null, `https://${HOST}.evil.example`, "null"]) {
      expect((await call("leves-abc123", { origin })).status, String(origin)).toBe(403);
    }
    expect(db.state.recipes).toHaveLength(1);
  });

  it("answers 503 when the secret or the salt is not configured", async () => {
    seed("leves-abc123");
    vi.stubEnv("RECIPE_SESSION_SECRET", "");
    expect((await call("leves-abc123")).status).toBe(503);
    vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
    vi.stubEnv("RECIPE_IP_SALT", "");
    expect((await call("leves-abc123")).status).toBe(503);
    expect(db.state.recipes).toHaveLength(1);
  });
});

describe("DELETE /api/recipes/[slug]: the deletion", () => {
  it("answers 204, deletes exactly that recipe with its ingredients, and refreshes the list", async () => {
    seed("leves-abc123", 3);
    seed("torta-def456", 2);
    const res = await call("leves-abc123");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(db.state.recipes.map((r) => r.row.slug)).toEqual(["torta-def456"]);
    expect(db.state.recipes[0]!.ingredients).toHaveLength(2); // the other recipe is untouched
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("answers 404 for a recipe that is not there (also the second time), and for a malformed address (that one before the limit)", async () => {
    seed("leves-abc123");
    expect((await call("nincs-ilyen-1")).status).toBe(404);
    expect((await call("leves-abc123")).status).toBe(204);
    expect((await call("leves-abc123")).status).toBe(404);
    for (const slug of ["A%20b", "x".repeat(81), "../etc", "a b", "Leves", ""]) expect((await call(slug)).status, slug).toBe(404);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("does not touch other recipes with a similar address", async () => {
    seed("leves-abc123");
    seed("leves-abc1234");
    seed("leves");
    expect((await call("leves-abc123")).status).toBe(204);
    expect(db.state.recipes.map((r) => r.row.slug).sort()).toEqual(["leves", "leves-abc1234"]);
  });

  it("answers only with a code, never with details", async () => {
    const res = await call("nincs-ilyen-1");
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("DELETE /api/recipes/[slug]: the limit (7 per 15 minutes, under the 30 an hour of saving)", () => {
  it("allows 7 deletions, then answers 429 with Retry-After and deletes nothing more", async () => {
    for (let i = 0; i < 10; i++) seed(`r${i}-aaaaaa`);
    for (let i = 0; i < 7; i++) expect((await call(`r${i}-aaaaaa`)).status, `deletion ${i + 1}`).toBe(204);
    const eighth = await call("r7-aaaaaa");
    expect(eighth.status).toBe(429);
    expect(await eighth.json()).toEqual({ error: "too_many_deletes" });
    expect(Number(eighth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(db.state.recipes).toHaveLength(3);
  });

  it("the whole site shares the allowance: other addresses cannot add more", async () => {
    for (let i = 0; i < 10; i++) seed(`r${i}-aaaaaa`);
    for (let i = 0; i < 7; i++) expect((await call(`r${i}-aaaaaa`, { ip: `198.51.100.${i + 1}` })).status).toBe(204);
    expect((await call("r7-aaaaaa", { ip: "198.51.100.99" })).status).toBe(429);
    expect(db.state.recipes).toHaveLength(3);
  });

  it("holds under simultaneous requests: 30 at once, at most 7 recipes are deleted", async () => {
    for (let i = 0; i < 30; i++) seed(`r${i}-aaaaaa`);
    db.state.delayMs = 8;
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call(`r${i}-aaaaaa`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 204 || s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 204).length).toBeLessThanOrEqual(7);
    expect(db.state.recipes.length).toBe(30 - statuses.filter((s) => s === 204).length);
  });

  it("does not share its counter with imports or logins", async () => {
    for (let i = 0; i < 8; i++) seed(`r${i}-aaaaaa`);
    for (let i = 0; i < 7; i++) await call(`r${i}-aaaaaa`);
    expect(db.state.attempts.every((a) => a.ip.startsWith("delete:"))).toBe(true);
    expect((await call("r7-aaaaaa")).status).toBe(429);
  });
});
