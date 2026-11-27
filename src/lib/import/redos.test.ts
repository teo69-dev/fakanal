import { describe, expect, it } from "vitest";
import { extractRecipe, htmlToText } from "./extract";

// The page is under the attacker's control, so the reader has to be LINEAR: every input below is a pattern that made
// an earlier version take seconds for 128 KB (quadratic: 5-10 s) and minutes to hours for the 5 MB limit. Linear code
// needs a few milliseconds for them; the budget is generous so a slow machine does not fail it. If a pattern turns
// quadratic again, this test fails (it then takes several seconds, not forever, at this size).
const SIZE = 128 * 1024;
const BUDGET_MS = 400;

const recipeWith = (extra: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Leves", recipeIngredient: ["só"], recipeInstructions: "Főzd.", ...extra })}</script>`;
const timed = (run: () => unknown) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};
const rep = (unit: string, bytes = SIZE) => unit.repeat(Math.ceil(bytes / unit.length));

describe("the reader stays linear on hostile pages", () => {
  const cases: [string, () => unknown][] = [
    ['"<" repeated in the instructions (no ">")', () => extractRecipe(recipeWith({ recipeInstructions: rep("<") }))],
    ['"<" repeated in an ingredient', () => extractRecipe(recipeWith({ recipeIngredient: [rep("<")] }))],
    ['"<" repeated in the name', () => extractRecipe(recipeWith({ name: rep("<") }))],
    ['"<li " repeated in the instructions', () => extractRecipe(recipeWith({ recipeInstructions: rep("<li ") }))],
    ['"<a x" repeated in the instructions', () => extractRecipe(recipeWith({ recipeInstructions: rep("<a x") }))],
    ['"<br " repeated (a break tag that never closes)', () => htmlToText(rep("<br "))],
    ['"</" repeated', () => htmlToText(rep("</"))],
    ['"<script " repeated on the page (no ">")', () => extractRecipe(rep("<script "))],
    ['"<script>" repeated with no closing tag', () => extractRecipe(rep("<script>"))],
    ['an unterminated ld+json opening tag, repeated', () => extractRecipe(rep('<script type="application/ld+json">'))],
    ['ld+json blocks that are never closed, after a real one', () => extractRecipe(recipeWith({}) + rep('<script type="application/ld+json">{'))],
    ['"<script type=" repeated', () => extractRecipe(rep("<script type="))],
    ["a huge run of spaces inside tags", () => htmlToText(`<${rep(" ")}`)],
    ['"&" repeated (entities)', () => htmlToText(rep("&"))],
    ['"&#" repeated', () => htmlToText(rep("&#"))],
    ['"<!--" repeated inside a broken JSON block', () => extractRecipe(`<script type="application/ld+json">${rep("<!--")}</script>`)],
    ['"//" lines inside a broken JSON block', () => extractRecipe(`<script type="application/ld+json">${rep("//x\n")}</script>`)],
  ];

  for (const [name, run] of cases) {
    it(`${name}: under ${BUDGET_MS} ms for ${SIZE / 1024} KB`, () => {
      expect(timed(run)).toBeLessThan(BUDGET_MS);
    });
  }

  it("a normal page of the same size with one recipe is read at once and correctly", () => {
    const filler = "<p>Ez egy hosszú blogbejegyzés a gulyásról, sok-sok szöveggel.</p>\n".repeat(Math.ceil(SIZE / 70));
    let result: ReturnType<typeof extractRecipe> = null;
    const ms = timed(() => {
      result = extractRecipe(`<html><body>${filler}${recipeWith({ name: "Gulyás <b>leves</b>" })}${filler}</body></html>`);
    });
    expect(result).toMatchObject({ name: "Gulyás leves", ingredients: ["só"] });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the markup it is meant to read after the rewrite", () => {
    expect(htmlToText("Gulyás <b>leves</b>")).toBe("Gulyás leves");
    expect(htmlToText("a<br>b<BR/>c<br />d")).toBe("a\nb\nc\nd");
    expect(htmlToText("<li class='x'>egy</li><li>kettő</li>").trim()).toBe("- egy\n- kettő");
    expect(extractRecipe(`<SCRIPT TYPE='application/ld+json' id=x>${JSON.stringify({ "@type": "Recipe", name: "Nagy" })}</SCRIPT >`)?.name).toBe("Nagy");
    expect(extractRecipe(`<script>var a = 1;</script><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Második" })}</script>`)?.name).toBe("Második");
    // a "<script" inside another script's text does not hide a real block that follows the first closing tag
    expect(extractRecipe(`<script>var s = "<script type=\\"x\\">";</script><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Utána" })}</script>`)?.name).toBe("Utána");
  });
});
