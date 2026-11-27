import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { newFakeState } from "@/test/fake-store";

// An in-memory stand-in for the database (src/test/fake-store.ts); the routes only see the Store interface.
const db = vi.hoisted(() => ({ state: undefined as unknown as import("@/test/fake-store").FakeState }));

vi.mock("@/lib/store", async () => {
  const { createFakeStore } = await import("@/test/fake-store");
  return {
    isUniqueViolation: (e: unknown) => (e as { code?: string } | null)?.code === "23505",
    getStore: () => createFakeStore(db.state),
  };
});

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { POST as createRecipe } from "./recipes/route";

// fake values, only for these tests
const PASSWORD = "test-password-not-the-real-one";
const SECRET = "test-secret-test-secret-test-secret-0123";
const SALT = "test-salt-test-salt-0123";
const HOST = "fakanal.test";
const ORIGIN = `https://${HOST}`;

type Opts = { body?: unknown; raw?: string; origin?: string | null; cookie?: string; ip?: string; type?: string | null; headers?: Record<string, string> };

function req(path: string, o: Opts = {}): Request {
  const headers: Record<string, string> = { host: HOST, "x-forwarded-for": o.ip ?? "203.0.113.7", ...o.headers };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.type !== null) headers["content-type"] = o.type ?? "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: o.raw ?? JSON.stringify(o.body ?? {}) });
}

const session = (exp = Date.now() + 60_000, secret = SECRET) => `${SESSION_COOKIE}=${signSession(exp, secret)}`;

const recipe = {
  name: "Gulyásleves",
  servings: 4,
  totalMinutes: 90,
  category: "leves",
  imageUrl: "https://example.com/gulyas.jpg",
  description: "Pirítsd meg a hagymát.",
  ingredients: [{ amount: "500 g", name: "marhahús" }],
};

beforeEach(() => {
  db.state = newFakeState();
  revalidatePath.mockClear();
  vi.stubEnv("RECIPE_ADMIN_PASSWORD", PASSWORD);
  vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
  vi.stubEnv("RECIPE_IP_SALT", SALT);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/login", () => {
  it("answers 503 and never lets anyone in when a setting is missing", async () => {
    for (const name of ["RECIPE_ADMIN_PASSWORD", "RECIPE_SESSION_SECRET", "RECIPE_IP_SALT"]) {
      vi.stubEnv(name, "");
      const res = await login(req("/api/login", { body: { password: PASSWORD } }));
      expect(res.status, name).toBe(503);
      expect(res.headers.get("set-cookie"), name).toBeNull();
      vi.stubEnv(name, name === "RECIPE_ADMIN_PASSWORD" ? PASSWORD : name === "RECIPE_SESSION_SECRET" ? SECRET : SALT);
    }
  });

  it("answers 503 when the secret is too short to be safe", async () => {
    vi.stubEnv("RECIPE_SESSION_SECRET", "short");
    expect((await login(req("/api/login", { body: { password: PASSWORD } }))).status).toBe(503);
  });

  it("answers 204 with an HttpOnly, SameSite=Strict session cookie for the right password", async () => {
    const res = await login(req("/api/login", { body: { password: PASSWORD } }));
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=43200");
    expect(cookie).not.toContain(PASSWORD);
  });

  it("sets the Secure flag in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await login(req("/api/login", { body: { password: PASSWORD } }));
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("answers 401 for a wrong password and records the failure (only the failure)", async () => {
    const res = await login(req("/api/login", { body: { password: "nope" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(db.state.attempts).toHaveLength(1);
    expect(db.state.attempts[0]?.ip).not.toContain("203.0.113.7");
    await login(req("/api/login", { body: { password: PASSWORD } }));
    expect(db.state.attempts).toHaveLength(1);
  });

  it("answers 429 with Retry-After from the 6th attempt on, even with the right password", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(req("/api/login", { body: { password: `wrong-${i}` } }))).status).toBe(401);
    }
    const sixth = await login(req("/api/login", { body: { password: "wrong-6" } }));
    expect(sixth.status).toBe(429);
    expect(db.state.attempts).toHaveLength(5); // the refused attempt took its own row back
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    const correct = await login(req("/api/login", { body: { password: PASSWORD } }));
    expect(correct.status).toBe(429);
    expect(correct.headers.get("set-cookie")).toBeNull();
  });

  it("holds under simultaneous guesses: 40 wrong passwords at once, at most 5 are compared, the rest get 429", async () => {
    db.state.delayMs = 8;
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => login(req("/api/login", { body: { password: `wrong-${i}` } }))));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((c) => c === 401 || c === 429)).toBe(true);
    expect(statuses.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
    expect(db.state.attempts.length).toBeLessThanOrEqual(5);
  });

  it("a correct password takes only its own row back, so a visitor who gets in does not lose the recorded failures", async () => {
    await login(req("/api/login", { body: { password: "wrong" } }));
    await login(req("/api/login", { body: { password: PASSWORD } }));
    expect(db.state.attempts).toHaveLength(1);
  });

  it("limits per address: another client is not locked out", async () => {
    for (let i = 0; i < 5; i++) await login(req("/api/login", { body: { password: "x" } }));
    expect((await login(req("/api/login", { body: { password: PASSWORD }, ip: "198.51.100.9" }))).status).toBe(204);
  });

  it("answers 403 without an Origin or with a foreign one", async () => {
    expect((await login(req("/api/login", { body: { password: PASSWORD }, origin: null }))).status).toBe(403);
    expect((await login(req("/api/login", { body: { password: PASSWORD }, origin: "https://evil.example" }))).status).toBe(403);
    expect(db.state.attempts).toHaveLength(0);
  });

  it("answers 400, 413 and 415 for bad bodies", async () => {
    expect((await login(req("/api/login", { raw: "{nope" }))).status).toBe(400);
    expect((await login(req("/api/login", { body: { password: 5 } }))).status).toBe(400);
    expect((await login(req("/api/login", { raw: JSON.stringify({ password: "x".repeat(5000) }) }))).status).toBe(413);
    expect((await login(req("/api/login", { raw: "password=x", type: "application/x-www-form-urlencoded" }))).status).toBe(415);
  });
});

describe("POST /api/logout", () => {
  it("clears the cookie for a logged-in visitor", async () => {
    const res = await logout(req("/api/logout", { cookie: session() }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("answers 401 without a session and 403 for a foreign origin", async () => {
    expect((await logout(req("/api/logout"))).status).toBe(401);
    expect((await logout(req("/api/logout", { cookie: session(), origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("POST /api/recipes", () => {
  it("answers 401 without a session cookie, with a bad one, with an expired one and with one signed by another secret", async () => {
    const body = { body: recipe };
    expect((await createRecipe(req("/api/recipes", body))).status).toBe(401);
    expect((await createRecipe(req("/api/recipes", { ...body, cookie: `${SESSION_COOKIE}=garbage` }))).status).toBe(401);
    expect((await createRecipe(req("/api/recipes", { ...body, cookie: session(Date.now() - 1) }))).status).toBe(401);
    expect((await createRecipe(req("/api/recipes", { ...body, cookie: session(undefined, "another-secret-another-secret-another-0") }))).status).toBe(401);
    expect(db.state.recipes).toHaveLength(0);
  });

  it("answers 503 when the session secret is not configured", async () => {
    vi.stubEnv("RECIPE_SESSION_SECRET", "");
    expect((await createRecipe(req("/api/recipes", { body: recipe, cookie: session() }))).status).toBe(503);
  });

  it("answers 403 for a foreign or missing Origin, even with a valid session", async () => {
    const c = session();
    expect((await createRecipe(req("/api/recipes", { body: recipe, cookie: c, origin: "https://evil.example" }))).status).toBe(403);
    expect((await createRecipe(req("/api/recipes", { body: recipe, cookie: c, origin: null }))).status).toBe(403);
    expect((await createRecipe(req("/api/recipes", { body: recipe, cookie: c, origin: `https://${HOST}.evil.example` }))).status).toBe(403);
    expect(db.state.recipes).toHaveLength(0);
  });

  it("answers 413 for a body over 64 KB, with or without a declared length", async () => {
    const big = { ...recipe, description: "a".repeat(70_000) };
    expect((await createRecipe(req("/api/recipes", { body: big, cookie: session() }))).status).toBe(413);
    const raw = JSON.stringify(big);
    const declared = await createRecipe(req("/api/recipes", { raw, cookie: session(), headers: { "content-length": String(raw.length) } }));
    expect(declared.status).toBe(413);
    expect(db.state.recipes).toHaveLength(0);
  });

  it("answers 415 and 400 for a non-JSON type and for broken JSON", async () => {
    expect((await createRecipe(req("/api/recipes", { raw: "x", type: "text/plain", cookie: session() }))).status).toBe(415);
    expect((await createRecipe(req("/api/recipes", { raw: "{", cookie: session() }))).status).toBe(400);
  });

  it("answers 400 with the problem fields for invalid input", async () => {
    const res = await createRecipe(req("/api/recipes", { body: { ...recipe, imageUrl: "javascript:alert(1)", ingredients: [] }, cookie: session() }));
    expect(res.status).toBe(400);
    const { issues } = (await res.json()) as { issues: { field: string }[] };
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["imageUrl", "ingredients"]));
    expect(db.state.recipes).toHaveLength(0);
  });

  it("answers 201 with a slug, stores the cleaned data and refreshes the list", async () => {
    const res = await createRecipe(req("/api/recipes", { body: { ...recipe, name: "Töltött  Káposzta\u0000" }, cookie: session() }));
    expect(res.status).toBe(201);
    const { slug } = (await res.json()) as { slug: string };
    expect(slug).toMatch(/^toltott-kaposzta-[0-9a-f]{6}$/);
    expect(db.state.recipes).toHaveLength(1);
    expect(db.state.recipes[0]?.row).toMatchObject({ slug, name: "Töltött Káposzta", nameSearch: "toltott kaposzta", servings: 4 });
    expect(db.state.recipes[0]?.ingredients).toEqual([{ position: 0, amount: "500 g", name: "marhahús" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("stores the source address of an imported recipe, and refuses an unacceptable one", async () => {
    const ok = await createRecipe(req("/api/recipes", { body: { ...recipe, sourceUrl: "https://example.com/gulyas" }, cookie: session() }));
    expect(ok.status).toBe(201);
    expect(db.state.recipes[0]?.row).toMatchObject({ sourceUrl: "https://example.com/gulyas" });
    const bad = await createRecipe(req("/api/recipes", { body: { ...recipe, sourceUrl: "https://127.0.0.1/x" }, cookie: session() }));
    expect(bad.status).toBe(400);
    expect(db.state.recipes).toHaveLength(1);
  });

  it("answers 429 when 30 recipes were added within the hour", async () => {
    db.state.recipes = Array.from({ length: 30 }, () => ({ row: { id: crypto.randomUUID() }, ingredients: [], at: new Date() }));
    const res = await createRecipe(req("/api/recipes", { body: recipe, cookie: session() }));
    expect(res.status).toBe(429);
    expect(db.state.recipes).toHaveLength(30);
    expect(db.state.insertCalls).toBe(0); // refused early, nothing was even written
  });

  it("holds under simultaneous saves: 80 at once, at most 30 recipes survive and the rest get 429", async () => {
    db.state.delayMs = 8;
    const c = session();
    const results = await Promise.all(
      Array.from({ length: 80 }, (_, i) => createRecipe(req("/api/recipes", { body: { ...recipe, name: `Recept ${i}` }, cookie: c }))),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.every((code) => code === 201 || code === 429)).toBe(true);
    expect(statuses.filter((code) => code === 201).length).toBeLessThanOrEqual(30);
    expect(db.state.recipes.length).toBeLessThanOrEqual(30);
  });

  it("does not refresh the list for a recipe that was refused", async () => {
    db.state.recipes = Array.from({ length: 30 }, () => ({ row: { id: crypto.randomUUID() }, ingredients: [], at: new Date() }));
    await createRecipe(req("/api/recipes", { body: recipe, cookie: session() }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("retries with a new slug after a unique violation, and gives up with 409", async () => {
    db.state.uniqueViolations = 2;
    expect((await createRecipe(req("/api/recipes", { body: recipe, cookie: session() }))).status).toBe(201);
    db.state.uniqueViolations = 3;
    expect((await createRecipe(req("/api/recipes", { body: { ...recipe, name: "Másik recept" }, cookie: session() }))).status).toBe(409);
  });

  describe("the same recipe saved twice in a moment is one recipe", () => {
    const save = (body: unknown = recipe) => createRecipe(req("/api/recipes", { body, cookie: session() }));
    const answer = async (res: Response) => (await res.json()) as { slug: string; duplicate?: boolean };

    it("a repeat answers 200 with the first recipe's address and creates nothing, nothing is used from the limit", async () => {
      const first = await save();
      expect(first.status).toBe(201);
      const { slug } = await answer(first);
      const second = await save();
      expect(second.status).toBe(200);
      expect(await answer(second)).toEqual({ slug, duplicate: true });
      expect(db.state.recipes).toHaveLength(1);
      expect(db.state.insertCalls).toBe(1); // the repeat was not even written
      expect(revalidatePath).toHaveBeenCalledTimes(1);
    });

    it("the name counts the way it is searched: capitals and accents do not make a new recipe", async () => {
      await save();
      expect((await save({ ...recipe, name: "GULYASLEVES" })).status).toBe(200);
      expect(db.state.recipes).toHaveLength(1);
    });

    it("anything that differs makes a new recipe: the text, an ingredient, an amount, the order, the name", async () => {
      await save();
      const variants = [
        { ...recipe, description: "Más leírás." },
        { ...recipe, ingredients: [{ amount: "600 g", name: "marhahús" }] },
        { ...recipe, ingredients: [{ amount: "500 g", name: "sertéshús" }] },
        { ...recipe, ingredients: [{ amount: "500 g", name: "marhahús" }, { name: "só" }] },
        { ...recipe, name: "Gulyásleves 2" },
      ];
      for (const v of variants) expect((await save(v)).status, JSON.stringify(v).slice(0, 80)).toBe(201);
      expect(db.state.recipes).toHaveLength(1 + variants.length);
      // the order of the ingredients matters too
      const two = { ...recipe, name: "Kétsoros", ingredients: [{ name: "a" }, { name: "b" }] };
      expect((await save(two)).status).toBe(201);
      expect((await save({ ...two, ingredients: [{ name: "b" }, { name: "a" }] })).status).toBe(201);
    });

    it("the same recipe a minute later is a new recipe", async () => {
      await save();
      db.state.recipes[0]!.at = new Date(Date.now() - 61_000);
      expect((await save()).status).toBe(201);
      expect(db.state.recipes).toHaveLength(2);
    });

    it("two copies of one request at the same time: exactly one recipe survives and both answers name it", async () => {
      db.state.delayMs = 8;
      const results = await Promise.all([save(), save()]);
      const bodies = await Promise.all(results.map(answer));
      expect(db.state.recipes).toHaveLength(1);
      expect(new Set(bodies.map((b) => b.slug)).size).toBe(1);
      expect(bodies[0]!.slug).toBe(db.state.recipes[0]!.row.slug);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    });

    it("ten copies at the same time: one recipe, one address", async () => {
      db.state.delayMs = 5;
      const results = await Promise.all(Array.from({ length: 10 }, () => save()));
      const slugs = new Set((await Promise.all(results.map(answer))).map((b) => b.slug));
      expect(db.state.recipes).toHaveLength(1);
      expect([...slugs]).toEqual([db.state.recipes[0]!.row.slug]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it("a repeat does not use up the hourly limit", async () => {
      db.state.recipes = Array.from({ length: 29 }, (_, i) => ({ row: { id: `x${i}` }, ingredients: [], at: new Date() }));
      expect((await save()).status).toBe(201); // the 30th
      expect((await save()).status).toBe(200); // a repeat of it is not a 31st
      expect(db.state.recipes).toHaveLength(30);
    });
  });
});
