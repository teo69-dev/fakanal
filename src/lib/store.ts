import { and, asc, count, eq, gte, lt } from "drizzle-orm";
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
};

export type NewIngredient = { position: number; amount: string | null; name: string };

/** Everything the write routes need from the database, behind one interface so the routes can be tested without one. */
export type Store = {
  purgeAttempts(before: Date): Promise<void>;
  recentAttempts(ipHash: string, since: Date): Promise<{ count: number; oldest: Date | null }>;
  addAttempt(ipHash: string): Promise<void>;
  countRecipesSince(since: Date): Promise<number>;
  insertRecipe(row: NewRecipe, ingredients: NewIngredient[]): Promise<void>;
};

export function getStore(): Store {
  const db = getDb();
  return {
    async purgeAttempts(before) {
      await db.delete(loginAttempt).where(lt(loginAttempt.attemptedAt, before));
    },
    async recentAttempts(ipHash, since) {
      const rows = await db
        .select({ at: loginAttempt.attemptedAt })
        .from(loginAttempt)
        .where(and(eq(loginAttempt.ipHash, ipHash), gte(loginAttempt.attemptedAt, since)))
        .orderBy(asc(loginAttempt.attemptedAt));
      return { count: rows.length, oldest: rows[0]?.at ?? null };
    },
    async addAttempt(ipHash) {
      await db.insert(loginAttempt).values({ ipHash });
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
  };
}

/** Postgres unique violation (the slug collided). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
