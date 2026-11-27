import { revalidatePath } from "next/cache";
import { ipSalt } from "@/lib/env";
import { checkRequestSession } from "@/lib/guard";
import { clientIp, empty, hashIp, json, sameOrigin } from "@/lib/http";
import { enterDelete } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const validSlug = (s: string) => /^[a-z0-9-]{1,80}$/.test(s);

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
