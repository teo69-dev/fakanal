import Link from "next/link";
import type { RecipeListItem } from "@/lib/queries";
import { RecipePlaceholder } from "./RecipePlaceholder";

/** One recipe in the list: its picture, or a pale tile with a camera icon when it has none, then the name and the facts. */
export function RecipeCard({ recipe: r }: { recipe: RecipeListItem }) {
  return (
    <Link className="card" href={`/recept/${r.slug}`}>
      {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <RecipePlaceholder />}
      <div className="body">
        <div className="title">{r.name}</div>
        <div className="meta">
          {r.category ? <span>{r.category}</span> : null}
          {r.totalMinutes ? <span>{r.totalMinutes} perc</span> : null}
          {r.servings ? <span>{r.servings} adag</span> : null}
        </div>
      </div>
    </Link>
  );
}
