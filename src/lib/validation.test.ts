import { describe, expect, it } from "vitest";
import { LIMITS, loginSchema, recipeInputSchema } from "./validation";

const valid = {
  name: "Gulyásleves",
  servings: 4,
  totalMinutes: 90,
  category: "leves",
  imageUrl: "https://example.com/gulyas.jpg",
  description: "Pirítsd meg a hagymát.\nAdd hozzá a húst.",
  ingredients: [{ amount: "500 g", name: "marhahús" }, { amount: "", name: "só" }],
};

const parse = (over: Record<string, unknown>) => recipeInputSchema.safeParse({ ...valid, ...over });

describe("recipeInputSchema", () => {
  it("accepts a valid recipe and turns blank optional fields into null", () => {
    const r = recipeInputSchema.parse({ ...valid, category: "  ", imageUrl: "", servings: null });
    expect(r.category).toBeNull();
    expect(r.imageUrl).toBeNull();
    expect(r.servings).toBeNull();
    expect(r.ingredients[1]).toEqual({ amount: null, name: "só" });
  });

  it("accepts a recipe with only the required fields", () => {
    const r = recipeInputSchema.parse({ name: "Tojás", description: "Főzd meg.", ingredients: [{ name: "tojás" }] });
    expect(r).toMatchObject({ servings: null, totalMinutes: null, category: null, imageUrl: null });
  });

  it("enforces the name limits (1-120 characters)", () => {
    expect(parse({ name: "" }).success).toBe(false);
    expect(parse({ name: "   " }).success).toBe(false);
    expect(parse({ name: "a".repeat(LIMITS.name) }).success).toBe(true);
    expect(parse({ name: "a".repeat(LIMITS.name + 1) }).success).toBe(false);
  });

  it("enforces servings 1-100 and minutes 1-2880, integers only", () => {
    expect(parse({ servings: 0 }).success).toBe(false);
    expect(parse({ servings: 101 }).success).toBe(false);
    expect(parse({ servings: 1.5 }).success).toBe(false);
    expect(parse({ servings: 100 }).success).toBe(true);
    expect(parse({ totalMinutes: 0 }).success).toBe(false);
    expect(parse({ totalMinutes: 2881 }).success).toBe(false);
    expect(parse({ totalMinutes: 2880 }).success).toBe(true);
  });

  it("enforces the category (40) and description (1-10000) limits", () => {
    expect(parse({ category: "a".repeat(41) }).success).toBe(false);
    expect(parse({ category: "a".repeat(40) }).success).toBe(true);
    expect(parse({ description: "" }).success).toBe(false);
    expect(parse({ description: "a".repeat(LIMITS.description) }).success).toBe(true);
    expect(parse({ description: "a".repeat(LIMITS.description + 1) }).success).toBe(false);
  });

  it("enforces the ingredient limits (1-60 rows, amount 40, name 300)", () => {
    expect(parse({ ingredients: [] }).success).toBe(false);
    expect(parse({ ingredients: Array.from({ length: 60 }, () => ({ name: "x" })) }).success).toBe(true);
    expect(parse({ ingredients: Array.from({ length: 61 }, () => ({ name: "x" })) }).success).toBe(false);
    expect(parse({ ingredients: [{ amount: "a".repeat(41), name: "x" }] }).success).toBe(false);
    expect(parse({ ingredients: [{ name: "a".repeat(300) }] }).success).toBe(true);
    expect(parse({ ingredients: [{ name: "a".repeat(301) }] }).success).toBe(false);
    expect(parse({ ingredients: [{ name: " " }] }).success).toBe(false);
  });

  it("accepts only https image URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/png;base64,AAAA",
      "http://example.com/a.jpg",
      "ftp://example.com/a.jpg",
      "//example.com/a.jpg",
      "not a url",
      "https://user:pw@example.com/a.jpg",
      "https://example.com/" + "a".repeat(LIMITS.imageUrl),
    ]) {
      expect(parse({ imageUrl: bad }).success, bad).toBe(false);
    }
    expect(parse({ imageUrl: "https://example.com/a.jpg?x=1" }).success).toBe(true);
  });

  it("source address: the same public https rule as the image address, blank becomes null", () => {
    expect(parse({ sourceUrl: "https://example.com/recept/1" }).success).toBe(true);
    expect(recipeInputSchema.parse({ ...valid, sourceUrl: "  " }).sourceUrl).toBeNull();
    expect(recipeInputSchema.parse({ ...valid }).sourceUrl).toBeNull();
    for (const bad of ["http://example.com/", "https://127.0.0.1/", "https://localhost/", "https://nas.local/", "javascript:alert(1)", "https://u:p@example.com/", "https://example.com/" + "a".repeat(500)]) {
      expect(parse({ sourceUrl: bad }).success, bad).toBe(false);
    }
  });

  it("rejects unknown fields (no mass assignment)", () => {
    expect(parse({ slug: "hack", id: "x" }).success).toBe(false);
  });

  it("rejects wrong types instead of coercing them", () => {
    expect(parse({ name: 5 }).success).toBe(false);
    expect(parse({ servings: "4" }).success).toBe(false);
    expect(parse({ ingredients: "liszt" }).success).toBe(false);
  });

  it("strips control characters and keeps HTML as plain text (the page escapes it on render)", () => {
    const r = recipeInputSchema.parse({ ...valid, name: "Le\u0000ves\u202E", description: "<script>alert(1)</script>" });
    expect(r.name).toBe("Leves");
    expect(r.description).toBe("<script>alert(1)</script>");
  });
});

describe("loginSchema", () => {
  it("needs a non-empty password string and nothing else", () => {
    expect(loginSchema.safeParse({ password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ password: 1 }).success).toBe(false);
    expect(loginSchema.safeParse({ password: "x", extra: 1 }).success).toBe(false);
    expect(loginSchema.safeParse({ password: "x".repeat(201) }).success).toBe(false);
  });
});
