import type { RecentRecipe, Store } from "./store";

// A recipe that is saved twice in a moment (a double click, a repeated request) is the same recipe: the second save
// must not create a second one. "The same" means: same name (as searched: case and accents ignored), same text, same
// ingredients in the same order, and saved within the window.

export const DUPLICATE_WINDOW_MS = 60_000;

export type RecipeContent = {
  nameSearch: string;
  description: string;
  servings: number | null;
  totalMinutes: number | null;
  category: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  ingredients: { amount: string | null; name: string }[];
};

// EVERY field of the form counts: a recipe saved again with a corrected serving size, time, category or picture is a
// correction, not a repeat, and must not be swallowed (there is no editing: saving again is how a mistake is fixed).
const same = (a: RecentRecipe, c: RecipeContent) =>
  a.description === c.description &&
  a.servings === c.servings &&
  a.totalMinutes === c.totalMinutes &&
  a.category === c.category &&
  a.imageUrl === c.imageUrl &&
  a.sourceUrl === c.sourceUrl &&
  a.ingredients.length === c.ingredients.length &&
  a.ingredients.every((x, i) => (x.amount ?? "") === (c.ingredients[i]?.amount ?? "") && x.name === c.ingredients[i]?.name);

/**
 * The recipes of the last minute that have exactly this content, WINNER FIRST (oldest, ties by id). When two copies of
 * one request run at the same time, each saves its own row and then asks this; both see the same list, so both agree on
 * the winner: the winner keeps its row, the others delete theirs and answer with the winner's address.
 */
export async function recentDuplicates(store: Store, content: RecipeContent, now = new Date()): Promise<RecentRecipe[]> {
  const candidates = await store.findRecentByName(content.nameSearch, new Date(now.getTime() - DUPLICATE_WINDOW_MS));
  return candidates.filter((c) => same(c, content));
}
