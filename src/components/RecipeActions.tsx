import Link from "next/link";
import { DeleteRecipeButton } from "./DeleteRecipeButton";

/** What a logged-in visitor can do with a recipe, at the bottom of its page: edit it, or delete it (after a confirmation). */
export function RecipeActions({ slug }: { slug: string }) {
  return (
    <div className="recipe-actions">
      <Link className="button secondary" href={`/recept/${slug}/szerkesztes`}>
        Szerkesztés
      </Link>
      <DeleteRecipeButton slug={slug} />
    </div>
  );
}
