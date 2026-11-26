import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { LoginForm } from "@/components/LoginForm";
import { isLoggedIn } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Belépés" };

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/uj");
  return (
    <div className="wrap">
      <Header />
      <div className="narrow">
        <h1>Belépés</h1>
        <p className="muted">A receptek olvasásához nem kell belépni, csak az újak felvételéhez.</p>
        <LoginForm />
      </div>
    </div>
  );
}
