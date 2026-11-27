import { revalidatePath } from "next/cache";
import { sameContentAnywhere } from "@/lib/duplicate";
import { ipSalt } from "@/lib/env";
import { checkRequestSession } from "@/lib/guard";
import { clientIp, empty, hashIp, json, readJsonBody, sameOrigin } from "@/lib/http";
import { enterDelete, enterEdit } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { validSlug } from "@/lib/slug";
import { searchKey } from "@/lib/text";
import { recipeInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";


/**
 * Deletes one recipe (its ingredients go with it, ON DELETE CASCADE). Only for a logged-in visitor, same-origin, and
 * limited more tightly than saving: deleting cannot be undone.
 */
export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const salt = ipSalt();
  if (!salt) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  const session = checkRequestSession(request);
  if (session === "not_configured") return json({ error: "not_configured" }, 503);
  if (session !== "ok") return json({ error: "unauthorized" }, 401);

  const { slug } = await context.params;
  if (!validSlug(slug)) return json({ error: "not_found" }, 404);

  const store = getStore();
  const limited = await enterDelete(store, hashIp(clientIp(request), salt));
  if (limited) return json({ error: "too_many_deletes" }, 429, { "retry-after": String(limited.retryAfterSeconds) });

  if (!(await store.deleteRecipeBySlug(slug))) return json({ error: "not_found" }, 404);
  revalidatePath("/");
  return empty(204);
}

/**
 * Edits one recipe: the same fields, the same validation and the same protection as saving a new one (valid session,
 * same-origin, 64 KB, zod), and the recipe keeps its ADDRESS even when it is renamed, so no link breaks. The fields and
 * all the ingredients are replaced in one transaction. Editing is not saving: the one-minute repeat check of a new
 * recipe does not apply (an unchanged save just saves again), but a recipe cannot be edited into an exact copy of
 * ANOTHER one (409 with that recipe's address).
 */
export async function PUT(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const salt = ipSalt();
  if (!salt) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  const session = checkRequestSession(request);
  if (session === "not_configured") return json({ error: "not_configured" }, 503);
  if (session !== "ok") return json({ error: "unauthorized" }, 401);

  const { slug } = await context.params;
  if (!validSlug(slug)) return json({ error: "not_found" }, 404);

  const body = await readJsonBody(request);
  if (!body.ok) return json({ error: "bad_request" }, body.status);
  const parsed = recipeInputSchema.safeParse(body.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    return json({ error: "invalid", issues }, 400);
  }
  const input = parsed.data;

  const store = getStore();
  const limited = await enterEdit(store, hashIp(clientIp(request), salt));
  if (limited) return json({ error: "too_many_edits" }, 429, { "retry-after": String(limited.retryAfterSeconds) });

  // not an exact copy of another recipe (this one itself does not count: saving it unchanged is fine)
  const copies = (
    await sameContentAnywhere(store, {
      nameSearch: searchKey(input.name),
      description: input.description,
      servings: input.servings,
      totalMinutes: input.totalMinutes,
      category: input.category,
      imageUrl: input.imageUrl,
      sourceUrl: input.sourceUrl,
      ingredients: input.ingredients.map((ing) => ({ amount: ing.amount, name: ing.name })),
    })
  ).filter((c) => c.slug !== slug);
  if (copies[0]) return json({ error: "identical_exists", slug: copies[0].slug }, 409);

  const updated = await store.updateRecipeBySlug(
    slug,
    {
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
  if (!updated) return json({ error: "not_found" }, 404);
  revalidatePath("/");
  return json({ slug }, 200);
}
