import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { RecipeForm } from "@/components/RecipeForm";
import { isLoggedIn } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Új recept" };

export default async function NewRecipePage() {
  if (!(await isLoggedIn())) redirect("/belepes");
  return (
    <div className="wrap">
      <Header />
      <h1>Új recept</h1>
      <RecipeForm mode="create" />
    </div>
  );
}
