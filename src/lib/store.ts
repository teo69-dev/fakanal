import { and, asc, count, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { ingredient, loginAttempt, recipe } from "@/db/schema";

export type NewRecipe = {
  id: string;
  slug: string;
  name: string;
  nameSearch: string;
  servings: number | null;
  totalMinutes: number | null;
  category: string | null;
  description: string;
  imageUrl: string | null;
  sourceUrl: string | null;
};

export type NewIngredient = { position: number; amount: string | null; name: string };

/** The fields of a recipe that an edit replaces (the id, the address and the time of creation stay). */
export type RecipeChanges = Omit<NewRecipe, "id" | "slug">;

/** A recipe saved a moment ago, with what is needed to tell whether a new one is the same recipe again. */
export type RecentRecipe = {
  id: string;
  slug: string;
  description: string;
  servings: number | null;
  totalMinutes: number | null;
  category: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  ingredients: { amount: string | null; name: string }[];
};

/**
 * Everything the write routes need from the database, behind one interface so the routes can be tested without one.
 * Every method is ONE statement that commits at once; the rate limits in ratelimit.ts rely on that (no transactions
 * around several calls).
 */
export type Store = {
  purgeAttempts(before: Date): Promise<void>;
  addAttempt(ipHash: string, id: string): Promise<void>;
  deleteAttempt(id: string): Promise<void>;
  recentAttempts(ipHash: string, since: Date): Promise<{ count: number; oldest: Date | null }>;
  countRecipesSince(since: Date): Promise<number>;
  insertRecipe(row: NewRecipe, ingredients: NewIngredient[]): Promise<void>;
  deleteRecipe(id: string): Promise<void>;
  /** Recipes with this search name saved since `since`, oldest first (ties by id), each with its ingredients in order. */
  findRecentByName(nameSearch: string, since: Date): Promise<RecentRecipe[]>;
  /** Deletes the recipe with this slug (its ingredients go with it); false when there is none. */
  deleteRecipeBySlug(slug: string): Promise<boolean>;
  /** Replaces the fields and ALL ingredients of the recipe with this slug in one transaction; false when there is none. */
  updateRecipeBySlug(slug: string, changes: RecipeChanges, ingredients: NewIngredient[]): Promise<boolean>;
};

export function getStore(): Store {
  const db = getDb();
  return {
    async purgeAttempts(before) {
      await db.delete(loginAttempt).where(lt(loginAttempt.attemptedAt, before));
    },
    async addAttempt(ipHash, id) {
      await db.insert(loginAttempt).values({ id, ipHash });
    },
    async deleteAttempt(id) {
      await db.delete(loginAttempt).where(eq(loginAttempt.id, id));
    },
    async recentAttempts(ipHash, since) {
      const rows = await db
        .select({ at: loginAttempt.attemptedAt })
        .from(loginAttempt)
        .where(and(eq(loginAttempt.ipHash, ipHash), gte(loginAttempt.attemptedAt, since)))
        .orderBy(asc(loginAttempt.attemptedAt));
      return { count: rows.length, oldest: rows[0]?.at ?? null };
    },
    async countRecipesSince(since) {
      const [row] = await db.select({ n: count() }).from(recipe).where(gte(recipe.createdAt, since));
      return row?.n ?? 0;
    },
    async insertRecipe(row, ingredients) {
      // one batch = one transaction on the neon-http driver: a recipe never lands without its ingredients
      await db.batch([
        db.insert(recipe).values(row),
        db.insert(ingredient).values(ingredients.map((i) => ({ ...i, recipeId: row.id }))),
      ]);
    },
    async deleteRecipe(id) {
      // the ingredients go with it (ON DELETE CASCADE)
      await db.delete(recipe).where(eq(recipe.id, id));
    },
    async findRecentByName(nameSearch, since) {
      const rows = await db
        .select({
          id: recipe.id,
          slug: recipe.slug,
          description: recipe.description,
          servings: recipe.servings,
          totalMinutes: recipe.totalMinutes,
          category: recipe.category,
          imageUrl: recipe.imageUrl,
          sourceUrl: recipe.sourceUrl,
          createdAt: recipe.createdAt,
        })
        .from(recipe)
        .where(and(eq(recipe.nameSearch, nameSearch), gte(recipe.createdAt, since)))
        .orderBy(asc(recipe.createdAt), asc(recipe.id));
      if (rows.length === 0) return [];
      const parts = await db
        .select({ recipeId: ingredient.recipeId, amount: ingredient.amount, name: ingredient.name })
        .from(ingredient)
        .where(inArray(ingredient.recipeId, rows.map((r) => r.id)))
        .orderBy(asc(ingredient.position));
      return rows.map((r) => ({ ...r, ingredients: parts.filter((p) => p.recipeId === r.id).map(({ amount, name }) => ({ amount, name })) }));
    },
    async updateRecipeBySlug(slug, changes, ingredients) {
      const [found] = await db.select({ id: recipe.id }).from(recipe).where(eq(recipe.slug, slug)).limit(1);
      if (!found) return false;
      try {
        // one batch = one transaction: the recipe never shows the new fields with the old ingredients, or none
        const [updated] = await db.batch([
          db.update(recipe).set(changes).where(eq(recipe.id, found.id)).returning({ id: recipe.id }),
          db.delete(ingredient).where(eq(ingredient.recipeId, found.id)),
          db.insert(ingredient).values(ingredients.map((i) => ({ ...i, recipeId: found.id }))),
        ]);
        return updated.length > 0;
      } catch (error) {
        // the recipe was deleted between the lookup and the batch: the ingredients' foreign key refuses, nothing is kept
        if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503") return false;
        throw error;
      }
    },
    async deleteRecipeBySlug(slug) {
      // one statement; the ingredients go with it (ON DELETE CASCADE in the migration)
      const gone = await db.delete(recipe).where(eq(recipe.slug, slug)).returning({ id: recipe.id });
      return gone.length > 0;
    },
  };
}

/** Postgres unique violation (the slug collided). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
