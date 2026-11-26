import type { NewIngredient, NewRecipe, Store } from "@/lib/store";

// An in-memory stand-in for the database, for tests only. Every Store call is ONE statement: it waits `delayMs` (the
// stand-in for a database round trip, which is where simultaneous requests interleave) and then acts at once.

export type FakeState = {
  attempts: { id: string; ip: string; at: Date }[];
  recipes: { row: Pick<NewRecipe, "id"> & Partial<NewRecipe>; ingredients: NewIngredient[]; at: Date }[];
  delayMs: number;
  uniqueViolations: number;
  insertCalls: number; // how many times insertRecipe was called (an early refusal must not reach it)
  now: () => Date; // the clock that stamps new rows (tests that fix a time set it)
};

export const newFakeState = (): FakeState => ({ attempts: [], recipes: [], delayMs: 0, uniqueViolations: 0, insertCalls: 0, now: () => new Date() });

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
  };
}
