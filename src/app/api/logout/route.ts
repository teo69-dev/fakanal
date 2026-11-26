import { sessionCookieHeader } from "@/lib/auth";
import { checkRequestSession } from "@/lib/guard";
import { empty, json, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const session = checkRequestSession(request);
  if (session === "not_configured") return json({ error: "not_configured" }, 503);
  if (session !== "ok") return json({ error: "unauthorized" }, 401);
  return empty(204, { "set-cookie": sessionCookieHeader("", 0, process.env.NODE_ENV === "production") });
}
