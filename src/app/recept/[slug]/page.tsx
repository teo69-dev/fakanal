import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { RecipeActions } from "@/components/RecipeActions";
import { getRecipe } from "@/lib/queries";
import { isLoggedIn } from "@/lib/session";
import { validSlug } from "@/lib/slug";
import { isAllowedPublicUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };


export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const recipe = validSlug(slug) ? await getRecipe(slug) : null;
  return { title: recipe?.name ?? "Nincs ilyen recept" };
}

export default async function RecipePage({ params }: Props) {
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const recipe = await getRecipe(slug);
  if (!recipe) notFound();
  const loggedIn = await isLoggedIn();

  return (
    <div className="wrap">
      <Header />
      <article>
        <h1>{recipe.name}</h1>
        <div className="meta">
          {recipe.category ? <span>{recipe.category}</span> : null}
          {recipe.totalMinutes ? <span>{recipe.totalMinutes} perc</span> : null}
          {recipe.servings ? <span>{recipe.servings} adag</span> : null}
        </div>
        {recipe.imageUrl ? <img className="hero" src={recipe.imageUrl} alt="" referrerPolicy="no-referrer" /> : null}

        <h2>Hozzávalók</h2>
        <ul className="ingredients">
          {recipe.ingredients.map((ing, i) => (
            <li key={i}>
              {ing.amount ? <span className="amount">{ing.amount} </span> : null}
              {ing.name}
            </li>
          ))}
        </ul>

        <h2>Elkészítés</h2>
        {/* plain text on purpose: React escapes it, there is no HTML or markdown */}
        <p className="description">{recipe.description}</p>

        {/* an imported recipe names its source; the link is only made for an address that passes the public https rule */}
        {recipe.sourceUrl && isAllowedPublicUrl(recipe.sourceUrl) ? (
          <p className="muted">
            Forrás:{" "}
            <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              {new URL(recipe.sourceUrl).hostname}
            </a>
          </p>
        ) : null}

        {/* only for a logged-in visitor; the server checks the session again for the edit and the deletion themselves */}
        {loggedIn ? (
          <RecipeActions slug={recipe.slug} />
        ) : null}
      </article>
    </div>
  );
}
