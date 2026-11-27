"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Deleting a recipe takes two steps, so a stray click cannot do it: "Törlés" opens a confirmation, and only the button
// in it sends the request. While it is on its way both buttons are disabled and a second click does nothing.
export function DeleteRecipeButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  async function remove() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    let leaving = false;
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (res.status === 204 || res.status === 404) {
        // 404: it is gone already (another tab, a double request): the list is the right place either way
        leaving = true;
        router.push("/");
        router.refresh();
        return;
      }
      if (res.status === 401) {
        leaving = true;
        router.push("/belepes");
        return;
      }
      setError(res.status === 429 ? "Túl sok törlés rövid időn belül. Próbáld újra pár perc múlva." : "Nem sikerült a törlés. Próbáld újra.");
    } catch {
      setError("Nem sikerült elérni a szervert.");
    } finally {
      if (!leaving) {
        sending.current = false;
        setBusy(false);
      }
    }
  }

  if (!asking) {
    return (
      <button type="button" className="danger-outline" onClick={() => setAsking(true)}>
        Törlés
      </button>
    );
  }
  return (
    <div className="delete-confirm" role="alertdialog" aria-label="Törlés megerősítése">
      <p>Biztosan törlöd ezt a receptet? Ez nem vonható vissza.</p>
      <div className="import-row">
        <button type="button" className="danger" onClick={remove} disabled={busy}>
          {busy ? "Törlés..." : "Igen, törlés"}
        </button>
        <button type="button" className="secondary" onClick={() => setAsking(false)} disabled={busy}>
          Mégsem
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
