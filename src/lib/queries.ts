import { asc, count, desc, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { ingredient, recipe } from "@/db/schema";
import { searchPattern } from "./text";

export const PAGE_SIZE = 24;
export const MAX_QUERY_LENGTH = 100;

export type RecipeListItem = {
  slug: string;
  name: string;
  category: string | null;
  servings: number | null;
  totalMinutes: number | null;
  imageUrl: string | null;
};

export async function listRecipes(q: string, page: number): Promise<{ items: RecipeListItem[]; total: number }> {
  const db = getDb();
  const pattern = searchPattern(q, MAX_QUERY_LENGTH);
  const where = pattern ? like(recipe.nameSearch, pattern) : undefined;
  const [items, totals] = await Promise.all([
    db
      .select({
        slug: recipe.slug,
        name: recipe.name,
        category: recipe.category,
        servings: recipe.servings,
        totalMinutes: recipe.totalMinutes,
        imageUrl: recipe.imageUrl,
      })
      .from(recipe)
      .where(where)
      .orderBy(desc(recipe.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(recipe).where(where),
  ]);
  return { items, total: totals[0]?.n ?? 0 };
}

export async function getRecipe(slug: string) {
  const db = getDb();
  const [row] = await db.select().from(recipe).where(eq(recipe.slug, slug)).limit(1);
  if (!row) return null;
  const ingredients = await db
    .select({ amount: ingredient.amount, name: ingredient.name })
    .from(ingredient)
    .where(eq(ingredient.recipeId, row.id))
    .orderBy(asc(ingredient.position));
  return { ...row, ingredients };
}
