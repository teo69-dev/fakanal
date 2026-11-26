import Link from "next/link";
import { isLoggedIn } from "@/lib/session";
import { LogoutButton } from "./LogoutButton";

export async function Header() {
  const loggedIn = await isLoggedIn();
  return (
    <header className="top">
      <Link href="/" className="brand">
        Fakanál
      </Link>
      <nav className="nav">
        {loggedIn ? (
          <>
            <Link href="/uj" className="button">
              Új recept
            </Link>
            <LogoutButton />
          </>
        ) : (
          <Link href="/belepes">Belépés</Link>
        )}
      </nav>
    </header>
  );
}
