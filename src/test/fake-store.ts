import type { NewIngredient, NewRecipe, RecentRecipe, Store } from "@/lib/store";

// An in-memory stand-in for the database, for tests only. Every Store call is ONE statement: it waits `delayMs` (the
// stand-in for a database round trip, which is where simultaneous requests interleave) and then acts at once.

export type FakeState = {
  attempts: { id: string; ip: string; at: Date }[];
  recipes: { row: Pick<NewRecipe, "id"> & Partial<NewRecipe>; ingredients: NewIngredient[]; at: Date }[];
  delayMs: number;
  uniqueViolations: number;
  insertCalls: number; // how many times insertRecipe was called (an early refusal must not reach it)
  now: () => Date; // the clock that stamps new rows (tests that fix a time set it)
  /** Scripts what findRecentByName answers, by the number of the call (1, 2, ...); undefined means "answer normally". */
  recentScript?: (call: number) => RecentRecipe[] | undefined;
  recentCalls: number;
};

export const newFakeState = (): FakeState => ({ attempts: [], recipes: [], delayMs: 0, uniqueViolations: 0, insertCalls: 0, now: () => new Date(), recentCalls: 0 });

export function createFakeStore(s: FakeState): Store {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, s.delayMs));
  return {
    async purgeAttempts(before) {
      await tick();
      s.attempts = s.attempts.filter((a) => a.at >= before);
    },
    async addAttempt(ipHash, id) {
      await tick();
      s.attempts.push({ id, ip: ipHash, at: s.now() });
    },
    async deleteAttempt(id) {
      await tick();
      s.attempts = s.attempts.filter((a) => a.id !== id);
    },
    async recentAttempts(ipHash, since) {
      await tick();
      const mine = s.attempts.filter((a) => a.ip === ipHash && a.at >= since).sort((a, b) => a.at.getTime() - b.at.getTime());
      return { count: mine.length, oldest: mine[0]?.at ?? null };
    },
    async countRecipesSince(since) {
      await tick();
      return s.recipes.filter((r) => r.at >= since).length;
    },
    async insertRecipe(row, ingredients) {
      s.insertCalls++;
      await tick();
      if (s.uniqueViolations > 0) {
        s.uniqueViolations--;
        throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      }
      s.recipes.push({ row, ingredients, at: s.now() });
    },
    async deleteRecipe(id) {
      await tick();
      s.recipes = s.recipes.filter((r) => r.row.id !== id);
    },
    async findRecentByName(nameSearch, since) {
      await tick();
      s.recentCalls++;
      const scripted = s.recentScript?.(s.recentCalls);
      if (scripted) return scripted;
      return s.recipes
        .filter((r) => r.row.nameSearch === nameSearch && r.at >= since)
        .map((r) => ({
          id: r.row.id,
          slug: r.row.slug ?? "",
          description: r.row.description ?? "",
          servings: r.row.servings ?? null,
          totalMinutes: r.row.totalMinutes ?? null,
          category: r.row.category ?? null,
          imageUrl: r.row.imageUrl ?? null,
          sourceUrl: r.row.sourceUrl ?? null,
          createdAt: r.at,
          ingredients: [...r.ingredients].sort((a, b) => a.position - b.position).map(({ amount, name }) => ({ amount, name })),
        }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    },
    async deleteRecipeBySlug(slug) {
      await tick();
      const before = s.recipes.length;
      s.recipes = s.recipes.filter((r) => r.row.slug !== slug); // the ingredients are part of the entry: they go with it
      return s.recipes.length < before;
    },
  };
}
