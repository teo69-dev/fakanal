"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 204) {
        router.push("/uj");
        router.refresh();
        return;
      }
      if (res.status === 401) setError("Hibás jelszó.");
      else if (res.status === 429) {
        const wait = Math.ceil(Number(res.headers.get("retry-after")) / 60);
        setError(`Túl sok próbálkozás. Próbáld újra kb. ${wait > 0 ? wait : 1} perc múlva.`);
      } else if (res.status === 503) setError("A belépés még nincs beállítva a szerveren.");
      else setError("Nem sikerült a belépés. Próbáld újra.");
    } catch {
      setError("Nem sikerült elérni a szervert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="password">Jelszó</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={200}
          required
        />
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        Belépés
      </button>
    </form>
  );
}
