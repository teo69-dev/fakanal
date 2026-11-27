import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { RecipeForm } from "@/components/RecipeForm";
import { getRecipe } from "@/lib/queries";
import { isLoggedIn } from "@/lib/session";
import { validSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recept szerkesztése" };

type Props = { params: Promise<{ slug: string }> };

export default async function EditRecipePage({ params }: Props) {
  const { slug } = await params;
  // the login comes first: a visitor learns nothing about a recipe's existence from this page
  if (!(await isLoggedIn())) redirect("/belepes");
  if (!validSlug(slug)) notFound();
  const recipe = await getRecipe(slug);
  if (!recipe) notFound();

  return (
    <div className="wrap">
      <Header />
      <h1>Recept szerkesztése</h1>
      <RecipeForm
        mode="edit"
        slug={recipe.slug}
        initial={{
          name: recipe.name,
          servings: recipe.servings,
          totalMinutes: recipe.totalMinutes,
          category: recipe.category ?? "",
          imageUrl: recipe.imageUrl ?? "",
          sourceUrl: recipe.sourceUrl ?? "",
          description: recipe.description,
          // exactly as saved: the amount and the name are shown in their own fields and are not split or joined again
          ingredients: recipe.ingredients.map((i) => ({ amount: i.amount ?? "", name: i.name })),
        }}
      />
    </div>
  );
}
