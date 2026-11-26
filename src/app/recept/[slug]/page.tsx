import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { getRecipe } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const validSlug = (s: string) => /^[a-z0-9-]{1,80}$/.test(s);

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
      </article>
    </div>
  );
}
