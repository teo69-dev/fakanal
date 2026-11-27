import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { searchKey } from "@/lib/text";
import { newFakeState } from "@/test/fake-store";

const db = vi.hoisted(() => ({ state: undefined as unknown as import("@/test/fake-store").FakeState }));
vi.mock("@/lib/store", async () => {
  const { createFakeStore } = await import("@/test/fake-store");
  return { isUniqueViolation: () => false, getStore: () => createFakeStore(db.state) };
});
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { PUT as edit } from "./recipes/[slug]/route";

const SECRET = "test-secret-test-secret-test-secret-0123";
const SALT = "test-salt-test-salt-0123";
const HOST = "fakanal.test";
const ORIGIN = `https://${HOST}`;

type Opts = { body?: unknown; raw?: string; origin?: string | null; cookie?: string | null; ip?: string; type?: string | null };
const session = (exp = Date.now() + 60_000, secret = SECRET) => `${SESSION_COOKIE}=${signSession(exp, secret)}`;
function call(slug: string, o: Opts = {}) {
  const headers: Record<string, string> = { host: HOST, "x-forwarded-for": o.ip ?? "203.0.113.7" };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.type !== null) headers["content-type"] = o.type ?? "application/json";
  if (o.cookie !== null) headers.cookie = o.cookie ?? session();
  return edit(new Request(`${ORIGIN}/api/recipes/${slug}`, { method: "PUT", headers, body: o.raw ?? JSON.stringify(o.body ?? fields) }), { params: Promise.resolve({ slug }) });
}

// what the form sends
const fields = {
  name: "Gulyásleves",
  servings: 4,
  totalMinutes: 90,
  category: "leves",
  imageUrl: "https://example.com/gulyas.jpg",
  sourceUrl: null,
  description: "Pirítsd meg a hagymát.",
  ingredients: [
    { amount: "500 g", name: "marhahús" },
    { amount: null, name: "só" },
  ],
};

type Seed = { slug: string; name?: string; description?: string; servings?: number | null; ingredients?: { amount: string | null; name: string }[] };
const created = new Date("2026-01-01T10:00:00Z");
const seed = ({ slug, name = "Gulyásleves", description = "Régi leírás.", servings = 2, ingredients = [{ amount: "1 kg", name: "régi hozzávaló" }] }: Seed) =>
  db.state.recipes.push({
    row: { id: `id-${slug}`, slug, name, nameSearch: searchKey(name), description, servings, totalMinutes: null, category: null, imageUrl: null, sourceUrl: null },
    ingredients: ingredients.map((i, position) => ({ position, ...i })),
    at: created,
  });
const get = (slug: string) => db.state.recipes.find((r) => r.row.slug === slug);

beforeEach(() => {
  db.state = newFakeState();
  revalidatePath.mockClear();
  vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
  vi.stubEnv("RECIPE_IP_SALT", SALT);
});
afterEach(() => vi.unstubAllEnvs());

describe("PUT /api/recipes/[slug]: who may call it", () => {
  it("answers 401 without a session, with a bad, an expired and a foreign-secret one; nothing changes", async () => {
    seed({ slug: "leves-abc123" });
    for (const cookie of [null, `${SESSION_COOKIE}=garbage`, session(Date.now() - 1), session(undefined, "another-secret-another-secret-another-0")]) {
      expect((await call("leves-abc123", { cookie })).status, String(cookie)).toBe(401);
    }
    expect(get("leves-abc123")?.row.description).toBe("Régi leírás.");
    expect(db.state.attempts).toHaveLength(0); // an unauthenticated call does not touch the counters
  });

  it("answers 403 for a foreign or missing Origin, even with a valid session", async () => {
    seed({ slug: "leves-abc123" });
    for (const origin of ["https://evil.example", null, `https://${HOST}.evil.example`, "null"]) expect((await call("leves-abc123", { origin })).status, String(origin)).toBe(403);
    expect(get("leves-abc123")?.row.description).toBe("Régi leírás.");
  });

  it("answers 503 when the secret or the salt is not configured", async () => {
    seed({ slug: "leves-abc123" });
    vi.stubEnv("RECIPE_SESSION_SECRET", "");
    expect((await call("leves-abc123")).status).toBe(503);
    vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
    vi.stubEnv("RECIPE_IP_SALT", "");
    expect((await call("leves-abc123")).status).toBe(503);
    expect(get("leves-abc123")?.row.description).toBe("Régi leírás.");
  });
});

describe("PUT /api/recipes/[slug]: the request", () => {
  it("answers 404 for a malformed address (before anything else) and for a recipe that is not there", async () => {
    for (const slug of ["A%20b", "x".repeat(81), "../etc", "Leves"]) expect((await call(slug)).status, slug).toBe(404);
    expect((await call("nincs-ilyen-1")).status).toBe(404);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a malformed address is refused before the limit: it leaves no trace in the counters", async () => {
    for (const slug of ["A%20b", "x".repeat(81), "../etc", "Leves"]) await call(slug);
    expect(db.state.attempts).toHaveLength(0);
  });

  it("answers 415, 400 and 413 for bad bodies", async () => {
    seed({ slug: "leves-abc123" });
    expect((await call("leves-abc123", { raw: "x", type: "text/plain" })).status).toBe(415);
    expect((await call("leves-abc123", { raw: "{" })).status).toBe(400);
    expect((await call("leves-abc123", { body: { ...fields, description: "a".repeat(70_000) } })).status).toBe(413);
    expect(get("leves-abc123")?.row.description).toBe("Régi leírás.");
  });

  it("validates like saving a new recipe, and names the problem fields", async () => {
    seed({ slug: "leves-abc123" });
    const res = await call("leves-abc123", { body: { ...fields, imageUrl: "javascript:alert(1)", ingredients: [], servings: 0 } });
    expect(res.status).toBe(400);
    const { issues } = (await res.json()) as { issues: { field: string }[] };
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["imageUrl", "ingredients", "servings"]));
    expect(get("leves-abc123")?.row.description).toBe("Régi leírás.");
  });

  it("refuses fields that are not the form's: the address, the id and the time of creation cannot be changed", async () => {
    seed({ slug: "leves-abc123" });
    for (const extra of [{ slug: "masik-cim" }, { id: "x" }, { createdAt: "2020-01-01" }, { nameSearch: "x" }]) {
      expect((await call("leves-abc123", { body: { ...fields, ...extra } })).status, JSON.stringify(extra)).toBe(400);
    }
    expect(get("leves-abc123")?.row.slug).toBe("leves-abc123");
  });
});

describe("PUT /api/recipes/[slug]: the edit", () => {
  it("replaces the fields and ALL the ingredients, keeps the address, the id and the time, and refreshes the list", async () => {
    seed({ slug: "leves-abc123", ingredients: [{ amount: "1 kg", name: "régi A" }, { amount: null, name: "régi B" }, { amount: "2", name: "régi C" }] });
    const res = await call("leves-abc123");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "leves-abc123" });
    const r = get("leves-abc123")!;
    expect(r.row).toMatchObject({ id: "id-leves-abc123", slug: "leves-abc123", name: "Gulyásleves", servings: 4, totalMinutes: 90, category: "leves", description: "Pirítsd meg a hagymát.", imageUrl: "https://example.com/gulyas.jpg" });
    expect(r.ingredients).toEqual([
      { position: 0, amount: "500 g", name: "marhahús" },
      { position: 1, amount: null, name: "só" },
    ]);
    expect(r.at).toEqual(created);
    expect(db.state.recipes).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("a rename keeps the address (no link breaks) and updates the search name", async () => {
    seed({ slug: "gulyasleves-abc123", name: "Gulyásleves" });
    expect((await call("gulyasleves-abc123", { body: { ...fields, name: "Marhagulyás Őszi változat" } })).status).toBe(200);
    const r = get("gulyasleves-abc123")!;
    expect(r.row.slug).toBe("gulyasleves-abc123");
    expect(r.row.name).toBe("Marhagulyás Őszi változat");
    expect(r.row.nameSearch).toBe("marhagulyas oszi valtozat");
  });

  it("changes only the recipe it names, also when another recipe has the same name", async () => {
    seed({ slug: "a-111111", name: "Leves", description: "A" });
    seed({ slug: "b-222222", name: "Leves", description: "B" });
    expect((await call("b-222222", { body: { ...fields, name: "Leves" } })).status).toBe(200);
    expect(get("a-111111")?.row.description).toBe("A");
    expect(get("a-111111")?.ingredients).toEqual([{ position: 0, amount: "1 kg", name: "régi hozzávaló" }]);
    expect(get("b-222222")?.row.description).toBe("Pirítsd meg a hagymát.");
  });

  it("the ingredients are stored as they are sent: amount and name are not split or joined again", async () => {
    seed({ slug: "leves-abc123" });
    const sent = [
      { amount: "10 dkg", name: "cukor" },
      { amount: null, name: "2 db tojás" }, // a name that starts like an amount stays a name
      { amount: "kb. 1", name: "citrom" },
    ];
    expect((await call("leves-abc123", { body: { ...fields, ingredients: sent } })).status).toBe(200);
    expect(get("leves-abc123")?.ingredients.map(({ amount, name }) => ({ amount, name }))).toEqual(sent);
  });

  it("an unchanged save is fine, right after the recipe was created (the repeat check of a new recipe does not apply)", async () => {
    seed({ slug: "leves-abc123", name: "Gulyásleves", description: fields.description, servings: 4, ingredients: [{ amount: "500 g", name: "marhahús" }, { amount: null, name: "só" }] });
    db.state.recipes[0]!.at = new Date(); // created just now
    const res = await call("leves-abc123", { body: { ...fields, totalMinutes: null, category: null, imageUrl: null } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "leves-abc123" }); // the answer is its own address, never another recipe's
  });

  it("a second save within the minute is a normal edit, not a repeat: both are applied, in order", async () => {
    seed({ slug: "leves-abc123" });
    db.state.recipes[0]!.at = new Date();
    expect((await call("leves-abc123", { body: { ...fields, servings: 6 } })).status).toBe(200);
    expect((await call("leves-abc123", { body: { ...fields, servings: 8 } })).status).toBe(200);
    expect(get("leves-abc123")?.row.servings).toBe(8);
  });
});

describe("PUT /api/recipes/[slug]: it cannot turn a recipe into a copy of another one", () => {
  const copyOfB = { name: "Leves", servings: null, totalMinutes: null, category: null, imageUrl: null, sourceUrl: null, description: "B szöveg", ingredients: [{ amount: "1", name: "x" }] };

  it("answers 409 with the address of the recipe it would duplicate, and changes nothing", async () => {
    seed({ slug: "a-111111", name: "Más", description: "A szöveg", servings: null, ingredients: [{ amount: "2", name: "y" }] });
    seed({ slug: "b-222222", name: "Leves", description: "B szöveg", servings: null, ingredients: [{ amount: "1", name: "x" }] });
    const res = await call("a-111111", { body: copyOfB });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "identical_exists", slug: "b-222222" });
    expect(get("a-111111")?.row.description).toBe("A szöveg");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("any age counts, not only the last minute", async () => {
    seed({ slug: "a-111111", name: "Más", description: "A szöveg", servings: null });
    seed({ slug: "b-222222", name: "Leves", description: "B szöveg", servings: null, ingredients: [{ amount: "1", name: "x" }] });
    db.state.recipes[1]!.at = new Date("2020-01-01T00:00:00Z");
    expect((await call("a-111111", { body: copyOfB })).status).toBe(409);
  });

  it("one difference is enough to allow it (a different amount, text or name)", async () => {
    seed({ slug: "a-111111", name: "Más", description: "A szöveg", servings: null });
    seed({ slug: "b-222222", name: "Leves", description: "B szöveg", servings: null, ingredients: [{ amount: "1", name: "x" }] });
    expect((await call("a-111111", { body: { ...copyOfB, ingredients: [{ amount: "2", name: "x" }] } })).status).toBe(200);
    expect((await call("a-111111", { body: { ...copyOfB, description: "B szöveg." } })).status).toBe(200);
    expect((await call("a-111111", { body: { ...copyOfB, name: "Leves 2" } })).status).toBe(200);
  });
});

describe("PUT /api/recipes/[slug]: the limit (12 per 15 minutes)", () => {
  it("allows 12 saves, then answers 429 with Retry-After and changes nothing more", async () => {
    seed({ slug: "leves-abc123" });
    for (let i = 0; i < 12; i++) expect((await call("leves-abc123", { body: { ...fields, servings: i + 1 } })).status, `save ${i + 1}`).toBe(200);
    const thirteenth = await call("leves-abc123", { body: { ...fields, servings: 99 } });
    expect(thirteenth.status).toBe(429);
    expect(await thirteenth.json()).toEqual({ error: "too_many_edits" });
    expect(Number(thirteenth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(get("leves-abc123")?.row.servings).toBe(12);
  });

  it("an invalid save does not use up the allowance (it is refused before the counter)", async () => {
    seed({ slug: "leves-abc123" });
    for (let i = 0; i < 20; i++) expect((await call("leves-abc123", { body: { ...fields, servings: 0 } })).status).toBe(400);
    expect((await call("leves-abc123")).status).toBe(200);
  });

  it("the whole site shares the allowance, and holds under simultaneous requests: 30 at once, at most 12 are applied", async () => {
    seed({ slug: "leves-abc123" });
    db.state.delayMs = 8;
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call("leves-abc123", { body: { ...fields, servings: (i % 90) + 1 }, ip: `198.51.100.${i + 1}` })));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(12);
  });

  it("does not share its counter with deleting, importing or logging in", async () => {
    seed({ slug: "leves-abc123" });
    await call("leves-abc123");
    expect(db.state.attempts.every((a) => a.ip.startsWith("edit:"))).toBe(true);
  });
});
