import { z } from "zod";
import { checkRequestSession } from "@/lib/guard";
import { clientIp, hashIp, json, readJsonBody, sameOrigin } from "@/lib/http";
import { ipSalt } from "@/lib/env";
import { buildDraft } from "@/lib/import/draft";
import { extractRecipe } from "@/lib/import/extract";
import { fetchHtml, ImportError, parseImportUrl } from "@/lib/import/fetch";
import { enterImport } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
// the download takes up to 8 seconds, plus the database round trips: 10 s is kept on purpose, the lowest function limit I know of (not checked against the current plan)
export const maxDuration = 10;

const bodySchema = z.strictObject({ url: z.string().min(1).max(2000) });

const FETCH_STATUS: Record<string, number> = {
  blocked: 422,
  timeout: 504,
  fetch_failed: 502,
  http_status: 502,
  too_many_redirects: 422,
  not_html: 422,
  too_large: 422,
  invalid_url: 400,
};

/**
 * Link import: only for a logged-in visitor. The server downloads the page, reads the schema.org Recipe data out of it
 * and returns it as a DRAFT for the form; nothing is saved here (saving goes through POST /api/recipes with its own
 * validation and limits). The page itself is never returned or stored.
 */
export async function POST(request: Request): Promise<Response> {
  const salt = ipSalt();
  if (!salt) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  const session = checkRequestSession(request);
  if (session === "not_configured") return json({ error: "not_configured" }, 503);
  if (session !== "ok") return json({ error: "unauthorized" }, 401);

  const body = await readJsonBody(request, 4096);
  if (!body.ok) return json({ error: "bad_request" }, body.status);
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad_request" }, 400);

  const url = parseImportUrl(parsed.data.url.trim());
  if (!url) return json({ error: "invalid_url" }, 400);

  // every import counts (per address and for the whole site), before anything is downloaded
  const limited = await enterImport(getStore(), hashIp(clientIp(request), salt));
  if (limited) return json({ error: "too_many_imports" }, 429, { "retry-after": String(limited.retryAfterSeconds) });

  let page: { html: string; finalUrl: string };
  try {
    page = await fetchHtml(url.href);
  } catch (error) {
    const code = error instanceof ImportError ? error.code : "fetch_failed";
    return json({ error: code }, FETCH_STATUS[code] ?? 502);
  }

  const extracted = extractRecipe(page.html);
  if (!extracted) return json({ error: "no_recipe" }, 422);

  const result = buildDraft(extracted, page.finalUrl);
  if (!result.ok) return json({ error: "too_long", fields: result.tooLong }, 422);
  return json({ recipe: result.draft, missing: result.missing }, 200);
}
