import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecipeCard } from "./RecipeCard";
import { RecipePlaceholder } from "./RecipePlaceholder";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// the body of the first rule that starts with this selector, outside any media query
const rule = (selector: string) => new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
const darkRule = /@media \(prefers-color-scheme: dark\) \{\s*\.ph \{([^}]*)\}/.exec(css)?.[1] ?? "";
const color = (block: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] as string;

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("RecipePlaceholder", () => {
  const html = renderToStaticMarkup(createElement(RecipePlaceholder));

  it("is decoration: the tile itself is hidden from screen readers, and it is only an icon", () => {
    expect(html).toMatch(/^<div class="ph" aria-hidden="true">/);
    expect(html).toContain("<svg");
    expect(html).toContain('focusable="false"');
    expect(html.replace(/<[^>]*>/g, "")).toBe(""); // no text at all: no letter, no name, no label
  });

  it("needs nothing from outside: no image, no link, no font, no reference", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/https?:|url\(|href=|src=|xlink/);
  });
});

describe("RecipeCard", () => {
  const base = { slug: "leves-abc123", name: "Gulyásleves", category: null, servings: null, totalMinutes: null };
  const card = (imageUrl: string | null) => renderToStaticMarkup(createElement(RecipeCard, { recipe: { ...base, imageUrl } }));

  it("shows the picture when there is one and the tile when there is not, never both", () => {
    const withImage = card("https://example.com/a.jpg");
    expect(withImage).toContain('<img src="https://example.com/a.jpg"');
    expect(withImage).not.toContain('class="ph"');
    const without = card(null);
    expect(without).toContain('class="ph"');
    expect(without).not.toContain("<img");
  });

  it("keeps the name as the text of the link, and the tile does not repeat it", () => {
    const without = card(null);
    expect(without).toContain('<div class="title">Gulyásleves</div>');
    expect(without).toContain('href="/recept/leves-abc123"');
    const tile = /<div class="ph".*?<\/div>/.exec(without)?.[0] ?? "";
    expect(tile).not.toContain("Gulyásleves");
  });
});

describe("the look of the tile (globals.css)", () => {
  it("is one calm look: a flat pale background, no gradient", () => {
    const block = rule(".ph");
    expect(block).toContain("background: var(--ph-bg)");
    expect(css).not.toMatch(/linear-gradient|radial-gradient/);
  });

  it("is exactly the box of a picture, so the grid does not jump", () => {
    expect(rule(".ph")).toMatch(/aspect-ratio:\s*16 \/ 10/);
    expect(css).toMatch(/\.card img,\s*\.hero \{[^}]*aspect-ratio:\s*16 \/ 10/);
  });

  it("keeps the icon at least 3:1 against the tile in the light and in the dark scheme", () => {
    const light = rule(".ph");
    expect(contrast(color(light, "--ph-bg"), color(light, "--ph-ink"))).toBeGreaterThanOrEqual(3);
    expect(darkRule).toContain("--ph-bg");
    expect(contrast(color(darkRule, "--ph-bg"), color(darkRule, "--ph-ink"))).toBeGreaterThanOrEqual(3);
  });

  it("has no leftover of the coloured tile (palettes, drawings, letter)", () => {
    expect(css).not.toMatch(/\.ph-\d|\.ph-art|\.ph-letter|\.ph-banner/);
  });
});
