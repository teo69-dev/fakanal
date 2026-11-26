import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cached: ReturnType<typeof create> | undefined;

function create(url: string) {
  return drizzle(neon(url), { schema });
}

// Created on first use, so `next build` works without a database.
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  cached ??= create(url);
  return cached;
}

export type Db = ReturnType<typeof getDb>;
