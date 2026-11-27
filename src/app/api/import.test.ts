import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { newFakeState } from "@/test/fake-store";

const db = vi.hoisted(() => ({ state: undefined as unknown as import("@/test/fake-store").FakeState }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/store", async () => {
  const { createFakeStore } = await import("@/test/fake-store");
  return { isUniqueViolation: () => false, getStore: () => createFakeStore(db.state) };
});
// the real address rules and the real error type, but no network: the download itself is replaced
vi.mock("@/lib/import/fetch", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/import/fetch")>()), fetchHtml: fetchMock }));

import { ImportError } from "@/lib/import/fetch";
import { POST as importRoute } from "./import/route";

const SECRET = "test-secret-test-secret-test-secret-0123";
const SALT = "test-salt-test-salt-0123";
const HOST = "fakanal.test";
const ORIGIN = `https://${HOST}`;

type Opts = { body?: unknown; raw?: string; origin?: string | null; cookie?: string | null; ip?: string; type?: string | null };
function req(o: Opts = {}): Request {
  const headers: Record<string, string> = { host: HOST, "x-forwarded-for": o.ip ?? "203.0.113.7" };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.type !== null) headers["content-type"] = o.type ?? "application/json";
  if (o.cookie !== null) headers.cookie = o.cookie ?? session();
  return new Request(`${ORIGIN}/api/import`, { method: "POST", headers, body: o.raw ?? JSON.stringify(o.body ?? { url: "https://example.com/gulyas" }) });
}
const session = (exp = Date.now() + 60_000, secret = SECRET) => `${SESSION_COOKIE}=${signSession(exp, secret)}`;

const PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "Recipe",
  name: "Gulyásleves",
  recipeYield: "4 adag",
  totalTime: "PT1H30M",
  recipeIngredient: ["500 g marhahús", "só"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Pirítsd meg." }, { "@type": "HowToStep", text: "Főzd meg." }],
  image: "https://example.com/gulyas.jpg",
})}</script></head><body></body></html>`;

beforeEach(() => {
  db.state = newFakeState();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ html: PAGE, finalUrl: "https://example.com/gulyas" });
  vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
  vi.stubEnv("RECIPE_IP_SALT", SALT);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/import: who may call it", () => {
  it("answers 401 without a session, with a bad one, an expired one and one signed with another secret; nothing is downloaded", async () => {
    for (const cookie of [null, `${SESSION_COOKIE}=garbage`, session(Date.now() - 1), session(undefined, "another-secret-another-secret-another-0")]) {
      expect((await importRoute(req({ cookie }))).status, String(cookie)).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.state.attempts).toHaveLength(0); // an unauthenticated call does not even touch the counters
  });

  it("answers 403 for a foreign or missing Origin, even with a valid session", async () => {
    expect((await importRoute(req({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await importRoute(req({ origin: null }))).status).toBe(403);
    expect((await importRoute(req({ origin: `https://${HOST}.evil.example` }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the session secret or the salt is not configured", async () => {
    vi.stubEnv("RECIPE_SESSION_SECRET", "");
    expect((await importRoute(req())).status).toBe(503);
    vi.stubEnv("RECIPE_SESSION_SECRET", SECRET);
    vi.stubEnv("RECIPE_IP_SALT", "");
    expect((await importRoute(req())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/import: the request", () => {
  it("answers 415, 400 and 413 for a bad body", async () => {
    expect((await importRoute(req({ raw: "url=x", type: "text/plain" }))).status).toBe(415);
    expect((await importRoute(req({ raw: "{nope" }))).status).toBe(400);
    expect((await importRoute(req({ body: {} }))).status).toBe(400);
    expect((await importRoute(req({ body: { url: 5 } }))).status).toBe(400);
    expect((await importRoute(req({ body: { url: "" } }))).status).toBe(400);
    expect((await importRoute(req({ body: { url: "https://example.com/", extra: 1 } }))).status).toBe(400);
    expect((await importRoute(req({ raw: JSON.stringify({ url: `https://example.com/${"a".repeat(5000)}` }) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 400 invalid_url for an address the rules refuse, without a download and without using up the limit", async () => {
    for (const url of ["http://example.com/", "https://127.0.0.1/", "https://localhost/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://intranet/", "https://nas.local/", "https://example.com:8443/", "https://u:p@example.com/", "ftp://example.com/", "javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      const res = await importRoute(req({ body: { url } }));
      expect(res.status, url).toBe(400);
      expect(((await res.json()) as { error: string }).error, url).toBe("invalid_url");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.state.attempts).toHaveLength(0);
  });

  it("trims the address and hands the checked URL to the download", async () => {
    await importRoute(req({ body: { url: "  https://example.com/gulyas#lepesek  " } }));
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/gulyas");
  });
});

describe("POST /api/import: the answer", () => {
  it("answers 200 with the draft the page gives and nothing else; nothing is stored", async () => {
    const res = await importRoute(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      recipe: {
        name: "Gulyásleves",
        servings: 4,
        totalMinutes: 90,
        category: "",
        imageUrl: "https://example.com/gulyas.jpg",
        sourceUrl: "https://example.com/gulyas",
        description: "1. Pirítsd meg.\n\n2. Főzd meg.",
        ingredients: [
          { amount: "500 g", name: "marhahús" },
          { amount: "", name: "só" },
        ],
      },
      missing: [],
    });
    expect(db.state.recipes).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the address the page was read from after redirects as the source", async () => {
    fetchMock.mockResolvedValue({ html: PAGE, finalUrl: "https://www.example.com/uj-hely" });
    const res = await importRoute(req());
    expect(((await res.json()) as { recipe: { sourceUrl: string } }).recipe.sourceUrl).toBe("https://www.example.com/uj-hely");
  });

  it("answers 422 no_recipe when the page has no structured recipe, and does not guess", async () => {
    fetchMock.mockResolvedValue({ html: "<html><body><h1>Gulyásleves</h1><p>Hozzávalók: hús, hagyma</p></body></html>", finalUrl: "https://example.com/x" });
    const res = await importRoute(req());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_recipe" });
  });

  it("returns a partial draft with the missing parts named (still 200)", async () => {
    fetchMock.mockResolvedValue({ html: `<script type="application/ld+json">{"@type":"Recipe","name":"Csak név"}</script>`, finalUrl: "https://example.com/x" });
    const body = (await (await importRoute(req())).json()) as { recipe: { name: string; ingredients: unknown[] }; missing: string[] };
    expect(body.recipe.name).toBe("Csak név");
    expect(body.recipe.ingredients).toEqual([]);
    expect(body.missing).toEqual(["hozzávalók", "elkészítés"]);
  });

  it("answers 422 too_long and names the field when the page's text breaks a limit", async () => {
    fetchMock.mockResolvedValue({ html: `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "x".repeat(300), recipeIngredient: ["só"], recipeInstructions: "Süsd." })}</script>`, finalUrl: "https://example.com/x" });
    const res = await importRoute(req());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "too_long", fields: ["név"] });
  });

  it("maps every download failure to its own status and code, without echoing details", async () => {
    const cases: [ConstructorParameters<typeof ImportError>[0], number][] = [
      ["blocked", 422],
      ["timeout", 504],
      ["fetch_failed", 502],
      ["http_status", 502],
      ["too_many_redirects", 422],
      ["not_html", 422],
      ["too_large", 422],
      ["invalid_url", 400],
    ];
    for (const [code, status] of cases) {
      fetchMock.mockRejectedValueOnce(new ImportError(code, "secret-internal-detail"));
      const res = await importRoute(req());
      expect(res.status, code).toBe(status);
      const text = await res.text();
      expect(JSON.parse(text), code).toEqual({ error: code });
      expect(text, code).not.toContain("secret-internal-detail");
    }
  });

  it("treats an unexpected failure of the download as fetch_failed (502)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom: /etc/passwd"));
    const res = await importRoute(req());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fetch_failed" });
  });
});

describe("POST /api/import: limits", () => {
  it("allows 10 imports per address in a window, then answers 429 with Retry-After, and never downloads for the refused one", async () => {
    for (let i = 0; i < 10; i++) expect((await importRoute(req())).status, `import ${i + 1}`).toBe(200);
    const eleventh = await importRoute(req());
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toEqual({ error: "too_many_imports" });
    expect(Number(eleventh.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(db.state.attempts.filter((a) => a.ip.startsWith("import:") && a.ip !== "import:all")).toHaveLength(10); // the refused one left no row
  });

  it("another address has its own allowance", async () => {
    for (let i = 0; i < 10; i++) await importRoute(req());
    expect((await importRoute(req())).status).toBe(429);
    expect((await importRoute(req({ ip: "198.51.100.9" }))).status).toBe(200);
  });

  it("counts failed downloads too", async () => {
    fetchMock.mockRejectedValue(new ImportError("http_status", "404"));
    for (let i = 0; i < 10; i++) expect((await importRoute(req())).status).toBe(502);
    expect((await importRoute(req())).status).toBe(429);
  });

  it("holds a site-wide limit of 30 across addresses, and a refused one does not use up its own address", async () => {
    for (let i = 0; i < 30; i++) expect((await importRoute(req({ ip: `198.51.100.${i + 1}` }))).status, `import ${i + 1}`).toBe(200);
    expect((await importRoute(req({ ip: "198.51.100.200" }))).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(30);
    expect(db.state.attempts.filter((a) => a.ip === "import:all")).toHaveLength(30);
    // the refused request took its per-address row back too: 30 addresses with one row each, nothing for the 31st
    expect(db.state.attempts.filter((a) => a.ip.startsWith("import:") && a.ip !== "import:all")).toHaveLength(30);
  });

  it("holds under simultaneous requests: 40 at once from one address, at most 10 are downloaded", async () => {
    db.state.delayMs = 8;
    const results = await Promise.all(Array.from({ length: 40 }, () => importRoute(req())));
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
    expect(statuses.filter((s) => s === 200).length).toBe(fetchMock.mock.calls.length);
  });

  it("does not interfere with the login counter of the same address", async () => {
    for (let i = 0; i < 10; i++) await importRoute(req());
    expect(db.state.attempts.some((a) => !a.ip.startsWith("import:"))).toBe(false);
  });
});
