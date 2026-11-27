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
  it("turns a complete extraction into the form draft; ingredient lines go in whole, unsplit", () => {
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
          { amount: "", name: "500 g marhahús" },
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

  it("refuses a source or image address that the public https rule does not accept", () => {
    expect(buildDraft(FULL, "http://example.com/x").ok).toBe(false);
    expect(buildDraft({ ...FULL, imageUrl: "https://127.0.0.1/a.jpg" }, SOURCE).ok).toBe(false);
  });
});
