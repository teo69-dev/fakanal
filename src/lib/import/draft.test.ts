import { describe, expect, it } from "vitest";
import { buildDraft } from "./draft";
import type { ExtractedRecipe } from "./extract";

const FULL: ExtractedRecipe = {
  name: "Gulyásleves",
  servings: 4,
  totalMinutes: 90,
  category: "leves",
  imageUrl: "https://example.com/gulyas.jpg",
  description: "1. Pirítsd meg.\n\n2. Főzd meg.",
  ingredients: ["500 g marhahús", "só"],
};
const SOURCE = "https://example.com/gulyas";

describe("buildDraft", () => {
  it("turns a complete extraction into the form draft; the quantity and unit of an ingredient line become its amount", () => {
    const r = buildDraft(FULL, SOURCE);
    expect(r).toEqual({
      ok: true,
      missing: [],
      draft: {
        name: "Gulyásleves",
        servings: 4,
        totalMinutes: 90,
        category: "leves",
        imageUrl: "https://example.com/gulyas.jpg",
        sourceUrl: SOURCE,
        description: "1. Pirítsd meg.\n\n2. Főzd meg.",
        ingredients: [
          { amount: "500 g", name: "marhahús" },
          { amount: "", name: "só" },
        ],
      },
    });
  });

  it("leaves what the page did not give empty and says what is missing (nothing is made up)", () => {
    const r = buildDraft({ name: null, servings: null, totalMinutes: null, category: null, imageUrl: null, description: null, ingredients: [] }, SOURCE);
    expect(r).toEqual({
      ok: true,
      missing: ["név", "hozzávalók", "elkészítés"],
      draft: { name: "", servings: null, totalMinutes: null, category: "", imageUrl: "", sourceUrl: SOURCE, description: "", ingredients: [] },
    });
    const partial = buildDraft({ ...FULL, description: null }, SOURCE);
    expect(partial.ok && partial.missing).toEqual(["elkészítés"]);
  });

  it("refuses, and names the field, when a value breaks a limit; it never cuts to size", () => {
    const cases: [Partial<ExtractedRecipe>, string][] = [
      [{ name: "x".repeat(121) }, "név"],
      [{ description: "x".repeat(10_001) }, "elkészítés"],
      [{ ingredients: Array.from({ length: 61 }, (_, i) => `hozzávaló ${i}`) }, "hozzávalók"],
      [{ ingredients: ["x".repeat(301)] }, "hozzávalók"],
    ];
    for (const [change, field] of cases) {
      const r = buildDraft({ ...FULL, ...change }, SOURCE);
      expect(r, field).toEqual({ ok: false, tooLong: [field] });
    }
  });

  it("splits each ingredient line on its own and keeps the whole line when the split is not clear", () => {
    const r = buildDraft({ ...FULL, ingredients: ["50 dkg Csirkemell", "2-3 db Újhagyma", "1 kis csokor Petrezselyemzöld", "Olaj", "2 tojás", "kb. 2 dl tej", "200 g"] }, SOURCE);
    expect(r.ok && r.draft.ingredients).toEqual([
      { amount: "50 dkg", name: "Csirkemell" },
      { amount: "2-3 db", name: "Újhagyma" },
      { amount: "1 kis csokor", name: "Petrezselyemzöld" },
      { amount: "", name: "Olaj" },
      { amount: "2", name: "tojás" },
      { amount: "", name: "kb. 2 dl tej" },
      { amount: "", name: "200 g" },
    ]);
  });

  it("the name length limit still applies to what is left of the line, and the amount limit to the amount", () => {
    expect(buildDraft({ ...FULL, ingredients: [`2 db ${"x".repeat(301)}`] }, SOURCE)).toEqual({ ok: false, tooLong: ["hozzávalók"] });
    const ok = buildDraft({ ...FULL, ingredients: [`2 db ${"x".repeat(300)}`] }, SOURCE);
    expect(ok.ok && ok.draft.ingredients[0]).toEqual({ amount: "2 db", name: "x".repeat(300) });
  });

  it("names every field that is too long", () => {
    const r = buildDraft({ ...FULL, name: "x".repeat(200), description: "y".repeat(20_000) }, SOURCE);
    expect(r.ok).toBe(false);
    expect(!r.ok && [...r.tooLong].sort()).toEqual(["elkészítés", "név"]);
  });

  it("applies the same cleaning as saving (control characters out, text normalised)", () => {
    const r = buildDraft({ ...FULL, name: "Le\u0000ves", ingredients: ["só\u202E"] }, SOURCE);
    expect(r.ok && r.draft.name).toBe("Leves");
    expect(r.ok && r.draft.ingredients).toEqual([{ amount: "", name: "só" }]);
  });

  it("refuses a source address that the public https rule does not accept", () => {
    expect(buildDraft(FULL, "http://example.com/x").ok).toBe(false);
    expect(buildDraft(FULL, `https://example.com/${"a".repeat(500)}`)).toEqual({ ok: false, tooLong: ["forrás"] });
  });

  it("imports without the picture when the picture alone does not fit, and says so", () => {
    for (const imageUrl of [`https://cdn.example.com/a.jpg?${"x=1&".repeat(150)}`, "https://127.0.0.1/a.jpg"]) {
      const r = buildDraft({ ...FULL, imageUrl }, SOURCE);
      expect(r.ok, imageUrl.slice(0, 40)).toBe(true);
      expect(r.ok && r.draft.imageUrl).toBe("");
      expect(r.ok && r.missing).toEqual(["kép (a címe túl hosszú vagy nem fogadható el)"]);
      expect(r.ok && r.draft.name).toBe("Gulyásleves"); // everything else is kept
    }
  });

  it("still refuses when the picture is NOT the only problem (the text fields are never dropped)", () => {
    const r = buildDraft({ ...FULL, name: "x".repeat(200), imageUrl: `https://cdn.example.com/${"a".repeat(600)}` }, SOURCE);
    expect(r.ok).toBe(false);
    expect(!r.ok && [...r.tooLong].sort()).toEqual(["kép", "név"]);
  });
});
