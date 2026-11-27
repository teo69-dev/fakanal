"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { IMPORT_MESSAGES, type ImportAnswer } from "@/lib/import/messages";
import { LIMITS } from "@/lib/validation";

type Row = { amount: string; name: string };
type Issue = { field: string; message: string };

const toInt = (v: string) => (v.trim() === "" ? null : Number(v));

export function NewRecipeForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [servings, setServings] = useState("");
  const [totalMinutes, setTotalMinutes] = useState("");
  const [category, setCategory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([{ amount: "", name: "" }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const formHasContent = () =>
    [name, servings, totalMinutes, category, imageUrl, description].some((v) => v.trim() !== "") || rows.some((r) => r.name.trim() !== "" || r.amount.trim() !== "");

  // Fills the form from the draft the server read out of the page's schema.org data. Nothing is saved here.
  async function runImport() {
    if (importUrl.trim() === "") return;
    if (formHasContent() && !window.confirm("Az űrlapon már van kitöltött adat. Felülírjam az importált recepttel?")) return;
    setImportBusy(true);
    setImportError(null);
    setImportNote(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      if (res.status === 401) {
        router.push("/belepes");
        return;
      }
      const data = (await res.json().catch(() => null)) as (Partial<ImportAnswer> & { error?: string; fields?: string[] }) | null;
      if (res.status === 200 && data?.recipe) {
        const r = data.recipe;
        setName(r.name);
        setServings(r.servings === null ? "" : String(r.servings));
        setTotalMinutes(r.totalMinutes === null ? "" : String(r.totalMinutes));
        setCategory(r.category);
        setImageUrl(r.imageUrl);
        setSourceUrl(r.sourceUrl);
        setDescription(r.description);
        setRows(r.ingredients.length > 0 ? r.ingredients : [{ amount: "", name: "" }]);
        setErrors([]);
        const missing = data.missing ?? [];
        setImportNote(
          "Betöltve az oldal adataiból. Nézd át mentés előtt: a hozzávalók sorai az oldal szövegei egészben, a mennyiséget nem választottam szét." +
            (missing.length > 0 ? ` Az oldalon nem találtam: ${missing.join(", ")}. Ezeket pótold kézzel.` : ""),
        );
        return;
      }
      const code = data?.error ?? "fetch_failed";
      const base = IMPORT_MESSAGES[res.status === 429 ? "too_many_imports" : code] ?? IMPORT_MESSAGES.fetch_failed ?? "Az import nem sikerült.";
      setImportError(code === "too_long" ? `${base}${(data?.fields ?? []).join(", ")}.` : base);
    } catch {
      setImportError("Nem sikerült elérni a szervert.");
    } finally {
      setImportBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          servings: toInt(servings),
          totalMinutes: toInt(totalMinutes),
          category,
          imageUrl,
          sourceUrl,
          description,
          // fully empty rows are dropped, a half-filled one reaches the server and is reported there
          ingredients: rows.filter((r) => r.amount.trim() !== "" || r.name.trim() !== ""),
        }),
      });
      if (res.status === 201) {
        const { slug } = (await res.json()) as { slug: string };
        router.push(`/recept/${slug}`);
        router.refresh();
        return;
      }
      if (res.status === 401) {
        router.push("/belepes");
        return;
      }
      if (res.status === 400) {
        const data = (await res.json().catch(() => null)) as { issues?: Issue[] } | null;
        setErrors(data?.issues?.map((i) => `${i.field}: ${i.message}`) ?? ["Hibás adatok."]);
      } else if (res.status === 429) setErrors(["Egy óra alatt legfeljebb 30 recept vehető fel. Próbáld később."]);
      else setErrors(["Nem sikerült a mentés. Próbáld újra."]);
    } catch {
      setErrors(["Nem sikerült elérni a szervert."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="import-box" aria-labelledby="import-title">
        <h2 id="import-title">Import linkből</h2>
        <p className="muted">
          Illeszd be egy receptoldal címét: az oldal strukturált (schema.org) recept-adatát betöltöm az űrlapba. Semmi nem mentődik, amíg
          át nem nézed és meg nem nyomod a Mentés gombot.
        </p>
        <div className="import-row">
          <input
            type="url"
            inputMode="url"
            aria-label="Receptoldal címe"
            placeholder="https://"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            maxLength={2000}
          />
          <button type="button" onClick={runImport} disabled={importBusy || importUrl.trim() === ""}>
            {importBusy ? "Betöltés..." : "Betöltés"}
          </button>
        </div>
        {importError ? (
          <p className="error" role="alert">
            {importError}
          </p>
        ) : null}
        {importNote ? (
          <p className="import-note" role="status">
            {importNote}
          </p>
        ) : null}
      </section>

    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="name">Név</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} required />
      </div>

      <div className="two">
        <div className="field">
          <label htmlFor="servings">Adag (db)</label>
          <input id="servings" type="number" min={1} max={LIMITS.servingsMax} value={servings} onChange={(e) => setServings(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="minutes">Teljes idő (perc)</label>
          <input id="minutes" type="number" min={1} max={LIMITS.totalMinutesMax} value={totalMinutes} onChange={(e) => setTotalMinutes(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="category">Kategória</label>
        <input id="category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={LIMITS.category} placeholder="pl. főétel, leves, desszert" />
      </div>

      <div className="field">
        <label htmlFor="image">Kép címe (https://…)</label>
        <input id="image" type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} maxLength={LIMITS.imageUrl} placeholder="https://" />
      </div>

      {sourceUrl ? (
        <div className="field">
          <label htmlFor="source">Forrás (az importált oldal)</label>
          <div className="import-row">
            <input id="source" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} maxLength={LIMITS.sourceUrl} />
            <button type="button" className="secondary" onClick={() => setSourceUrl("")}>
              Törlés
            </button>
          </div>
        </div>
      ) : null}

      <h2>Hozzávalók</h2>
      {rows.map((row, i) => (
        <div className="row" key={i}>
          <input aria-label={`${i + 1}. hozzávaló mennyisége`} placeholder="200 g" value={row.amount} onChange={(e) => setRow(i, { amount: e.target.value })} maxLength={LIMITS.amount} />
          <input aria-label={`${i + 1}. hozzávaló neve`} placeholder="liszt" value={row.name} onChange={(e) => setRow(i, { name: e.target.value })} maxLength={LIMITS.ingredientName} />
          <button type="button" className="secondary" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))} aria-label={`${i + 1}. hozzávaló törlése`}>
            ✕
          </button>
        </div>
      ))}
      {rows.length < LIMITS.ingredients ? (
        <button type="button" className="secondary" onClick={() => setRows((rs) => [...rs, { amount: "", name: "" }])}>
          + Újabb hozzávaló
        </button>
      ) : null}

      <div className="field">
        <h2>
          <label htmlFor="description">Elkészítés</label>
        </h2>
        <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LIMITS.description} required />
      </div>

      {errors.length > 0 ? (
        <ul className="error" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <button type="submit" disabled={busy}>
        Mentés
      </button>
    </form>
    </>
  );
}
