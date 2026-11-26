CREATE TABLE "ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"amount" text,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"ip_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_search" text NOT NULL,
	"servings" smallint,
	"total_minutes" smallint,
	"category" text,
	"description" text NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_slug_unique" UNIQUE("slug"),
	CONSTRAINT "recipe_servings_range" CHECK ("recipe"."servings" between 1 and 100),
	CONSTRAINT "recipe_total_minutes_range" CHECK ("recipe"."total_minutes" between 1 and 2880)
);
--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempt_ip_idx" ON "login_attempt" USING btree ("ip_hash","attempted_at");--> statement-breakpoint
CREATE INDEX "recipe_name_search_idx" ON "recipe" USING btree ("name_search");--> statement-breakpoint
CREATE INDEX "recipe_created_at_idx" ON "recipe" USING btree ("created_at" DESC NULLS LAST);