import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { checkRequestSession } from "@/lib/guard";
import { json, readJsonBody, sameOrigin } from "@/lib/http";
import { checkWriteLimit, confirmWrite } from "@/lib/ratelimit";
import { getStore, isUniqueViolation } from "@/lib/store";
import { searchKey, slugBase } from "@/lib/text";
import { recipeInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  const session = checkRequestSession(request);
  if (session === "not_configured") return json({ error: "not_configured" }, 503);
  if (session !== "ok") return json({ error: "unauthorized" }, 401);

  const body = await readJsonBody(request);
  if (!body.ok) return json({ error: "bad_request" }, body.status);

  const parsed = recipeInputSchema.safeParse(body.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    return json({ error: "invalid", issues }, 400);
  }
  const input = parsed.data;

  const store = getStore();
  if (!(await checkWriteLimit(store))) return json({ error: "too_many_recipes" }, 429, { "retry-after": "3600" });

  // The suffix makes slugs unique without a lookup; a collision (the unique constraint) just draws another suffix.
  const id = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `${slugBase(input.name)}-${randomBytes(3).toString("hex")}`;
    try {
      await store.insertRecipe(
        {
          id,
          slug,
          name: input.name,
          nameSearch: searchKey(input.name),
          servings: input.servings,
          totalMinutes: input.totalMinutes,
          category: input.category,
          description: input.description,
          imageUrl: input.imageUrl,
          sourceUrl: input.sourceUrl,
        },
        input.ingredients.map((ing, position) => ({ position, amount: ing.amount, name: ing.name })),
      );
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
    // the authoritative write limit: counted AFTER the insert, so simultaneous requests cannot all slip past the early check
    if (!(await confirmWrite(store, id))) return json({ error: "too_many_recipes" }, 429, { "retry-after": "3600" });
    revalidatePath("/");
    return json({ slug }, 201);
  }
  return json({ error: "conflict" }, 409);
}
