import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeCard } from "@/components/RecipeCard";
import { RecipePlaceholder } from "@/components/RecipePlaceholder";
import { hashText, initialOf, paletteOf, PALETTE_COUNT, patternOf, PATTERN_COUNT } from "./placeholder";

describe("initialOf", () => {
  it("is the first letter of the name in capitals, accents and double acutes kept", () => {
    expect(initialOf("Német túrós szelet")).toBe("N");
    expect(initialOf("gulyásleves")).toBe("G");
    expect(initialOf("őszibarack lekvár")).toBe("Ő");
    expect(initialOf("Ürücomb")).toBe("Ü");
    expect(initialOf("ízes tészta")).toBe("Í");
  });
  it("skips quotes, punctuation, spaces and emoji in front, and takes a digit when that is the first character", () => {
    expect(initialOf('"Hűtlen" lecsó')).toBe("H");
    expect(initialOf("  - pörkölt")).toBe("P");
    expect(initialOf("🍝 Tészta")).toBe("T");
    expect(initialOf("7 napos kenyér")).toBe("7");
  });
  it("takes one character even where capitals are longer (ß) and a whole emoji pair is not cut in half", () => {
    expect(Array.from(initialOf("ßeta"))).toHaveLength(1);
    expect(initialOf("😀").isWellFormed()).toBe(true);
  });
  it("takes a whole character from beyond the basic plane (a letter written with two code units)", () => {
    // DESERET SMALL LETTER LONG I, a letter outside the basic plane: its capital is a pair of code units
    const letter = String.fromCodePoint(0x10428);
    const capital = String.fromCodePoint(0x10400);
    expect(initialOf(`${letter}abc`)).toBe(capital);
    expect(initialOf(`${letter}abc`).isWellFormed()).toBe(true);
  });

  it("is R (for recept) when the name has no letter or digit", () => {
    for (const name of ["", "   ", "!!!", "🍝🍝", "---"]) expect(initialOf(name), JSON.stringify(name)).toBe("R");
  });
});

describe("paletteOf and patternOf", () => {
  it("are fixed for a recipe: the same address always gives the same tile", () => {
    expect(paletteOf("nemet-turos-szelet-d59a36")).toBe(paletteOf("nemet-turos-szelet-d59a36"));
    expect(patternOf("nemet-turos-szelet-d59a36")).toBe(patternOf("nemet-turos-szelet-d59a36"));
    expect(hashText("a")).toBe(hashText("a"));
    expect(hashText("a")).not.toBe(hashText("b"));
  });

  it("stay inside the palettes and patterns that exist", () => {
    for (let i = 0; i < 2000; i++) {
      const slug = `recept-${i}-${(i * 2654435761) % 1e6}`;
      expect(paletteOf(slug)).toBeGreaterThanOrEqual(0);
      expect(paletteOf(slug)).toBeLessThan(PALETTE_COUNT);
      expect(patternOf(slug)).toBeGreaterThanOrEqual(0);
      expect(patternOf(slug)).toBeLessThan(PATTERN_COUNT);
    }
  });

  it("use every palette and every pattern, none of them for much more than its share, and the pattern does not follow the colour", () => {
    const palettes = new Array(PALETTE_COUNT).fill(0);
    const patterns = new Array(PATTERN_COUNT).fill(0);
    const pairs = new Set<string>();
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const slug = `gulyasleves-${i.toString(16)}`;
      palettes[paletteOf(slug)]++;
      patterns[patternOf(slug)]++;
      pairs.add(`${paletteOf(slug)}-${patternOf(slug)}`);
    }
    for (const n of palettes) expect(n / N).toBeGreaterThan(0.12); // 1/6 = 0.167
    for (const n of patterns) expect(n / N).toBeGreaterThan(0.27); // 1/3 = 0.333
    expect(pairs.size).toBe(PALETTE_COUNT * PATTERN_COUNT);
  });

  it("gives recipes of the same name (the addresses differ in the suffix) different tiles often enough to tell them apart", () => {
    const seen = new Set<number>();
    for (const suffix of ["a1b2c3", "a1b2c4", "d59a36", "000000", "ffffff", "123abc"]) seen.add(paletteOf(`nemet-turos-szelet-${suffix}`));
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe("RecipePlaceholder markup", () => {
  const html = (props: { slug: string; name: string; variant?: "card" | "banner" }) => renderToStaticMarkup(createElement(RecipePlaceholder, props));

  it("is decoration: hidden from screen readers, with the letter, no image and nothing from outside", () => {
    const out = html({ slug: "nemet-turos-szelet-d59a36", name: "Német túrós szelet" });
    expect(out).toMatch(/^<div class="[^"]*" aria-hidden="true">/); // the tile itself, not only the drawing inside it
    expect(out).toContain('<svg class="ph-art"');
    expect(out).toContain('<span class="ph-letter">N</span>');
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/https?:|url\(|href=|src=/);
  });

  it("carries its palette and variant as classes", () => {
    const slug = "nemet-turos-szelet-d59a36";
    expect(html({ slug, name: "x" })).toContain(`class="ph ph-${paletteOf(slug)} ph-card"`);
    expect(html({ slug, name: "x", variant: "banner" })).toContain(`class="ph ph-${paletteOf(slug)} ph-banner"`);
  });

  it("escapes the name's letter (a name that starts with markup cannot inject any)", () => {
    const out = html({ slug: "x", name: "<script>alert(1)</script>" });
    expect(out).not.toContain("<script");
    expect(out).toContain('<span class="ph-letter">S</span>'); // the first letter of "script" after the skipped "<"
  });
});

describe("RecipeCard", () => {
  const base = { slug: "leves-abc123", name: "Gulyásleves", category: null, servings: null, totalMinutes: null };
  const card = (imageUrl: string | null) => renderToStaticMarkup(createElement(RecipeCard, { recipe: { ...base, imageUrl } }));

  it("shows the picture when there is one and the tile when there is not, never both", () => {
    const withImage = card("https://example.com/a.jpg");
    expect(withImage).toContain('<img src="https://example.com/a.jpg"');
    expect(withImage).not.toContain('class="ph ');
    const without = card(null);
    expect(without).toContain('class="ph ');
    expect(without).not.toContain("<img");
  });

  it("keeps the name as the text of the link (the tile adds nothing for a screen reader)", () => {
    expect(card(null)).toContain('<div class="title">Gulyásleves</div>');
    expect(card(null)).toContain('href="/recept/leves-abc123"');
  });
});
