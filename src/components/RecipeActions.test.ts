import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

import { RecipeActions } from "./RecipeActions";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("RecipeActions", () => {
  const html = renderToStaticMarkup(createElement(RecipeActions, { slug: "leves-abc123" }));

  it("offers editing (a link to the recipe's own edit page) and deleting", () => {
    expect(html).toContain('href="/recept/leves-abc123/szerkesztes"');
    expect(html).toContain("Szerkesztés");
    expect(html).toContain("Törlés");
  });

  it("deleting still needs its confirmation: only the first button is shown", () => {
    expect(html).not.toContain("Igen, törlés");
    expect(html).not.toContain("Biztosan");
  });
});

describe("where the actions and the edit page are reachable", () => {
  it("the recipe page shows the actions only to a logged-in visitor", () => {
    const page = source("../app/recept/[slug]/page.tsx");
    expect(page).toMatch(/loggedIn \? \(\s*<RecipeActions/);
    expect((page.match(/<RecipeActions/g) ?? []).length).toBe(1);
  });

  it("the edit page checks the login BEFORE it reads the recipe, so a visitor learns nothing about it", () => {
    const page = source("../app/recept/[slug]/szerkesztes/page.tsx");
    expect(page).toContain('redirect("/belepes")');
    expect(page.indexOf("isLoggedIn()")).toBeGreaterThan(-1);
    expect(page.indexOf("isLoggedIn()")).toBeLessThan(page.indexOf("getRecipe("));
    expect(page.indexOf("isLoggedIn()")).toBeLessThan(page.indexOf("notFound()"));
  });

  it("the edit page hands the form the saved ingredients as they are (no splitting or joining)", () => {
    const page = source("../app/recept/[slug]/szerkesztes/page.tsx");
    expect(page).toContain('ingredients: recipe.ingredients.map((i) => ({ amount: i.amount ?? "", name: i.name }))');
    expect(page).not.toMatch(/splitIngredient/);
  });

  it("the form never splits an ingredient line itself (that is only the importer's job on the server)", () => {
    expect(source("./RecipeForm.tsx")).not.toMatch(/splitIngredient/);
  });
});
