import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { NewRecipeForm } from "@/components/NewRecipeForm";
import { isLoggedIn } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Új recept" };

export default async function NewRecipePage() {
  if (!(await isLoggedIn())) redirect("/belepes");
  return (
    <div className="wrap">
      <Header />
      <h1>Új recept</h1>
      <NewRecipeForm />
    </div>
  );
}
