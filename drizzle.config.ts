import { defineConfig } from "drizzle-kit";

// `npm run db:migrate` reads DATABASE_URL from the environment (pull it from Vercel, never commit it).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
