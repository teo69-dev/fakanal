import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const recipe = pgTable(
  "recipe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    // lower-cased and accent-stripped copy of `name`, the search key (see src/lib/text.ts)
    nameSearch: text("name_search").notNull(),
    servings: smallint("servings"),
    totalMinutes: smallint("total_minutes"),
    category: text("category"),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("recipe_servings_range", sql`${t.servings} between 1 and 100`),
    check("recipe_total_minutes_range", sql`${t.totalMinutes} between 1 and 2880`),
    index("recipe_name_search_idx").on(t.nameSearch),
    index("recipe_created_at_idx").on(t.createdAt.desc()),
  ],
);

export const ingredient = pgTable("ingredient", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipe.id, { onDelete: "cascade" }),
  position: smallint("position").notNull(),
  // free text on purpose: "200 g", "1 csipet", "ízlés szerint"
  amount: text("amount"),
  name: text("name").notNull(),
});

// One row per FAILED login attempt; ip_hash is a salted hash, never the raw address.
export const loginAttempt = pgTable(
  "login_attempt",
  {
    ipHash: text("ip_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempt_ip_idx").on(t.ipHash, t.attemptedAt)],
);
