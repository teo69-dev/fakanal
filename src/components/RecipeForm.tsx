"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { IMPORT_MESSAGES, type ImportAnswer } from "@/lib/import/messages";
import { LIMITS } from "@/lib/validation";

type Row = { amount: string; name: string };
type Issue = { field: string; message: string };

const toInt = (v: string) => (v.trim() === "" ? null : Number(v));

/** What an existing recipe puts into the form when it is edited: every field as the form shows it. */
export type RecipeFormValues = {
  name: string;
  servings: number | null;
  totalMinutes: number | null;
  category: string;
  imageUrl: string;
  sourceUrl: string;
  description: string;
  /** Already split into amount and name: the editor shows them as they are and never splits a line again. */
  ingredients: { amount: string; name: string }[];
};

// "create": a new recipe (with the link import); "edit": the recipe with this address, loaded into the same form
export type RecipeFormProps = { mode: "create" } | { mode: "edit"; slug: string; initial: RecipeFormValues };

export function RecipeForm(props: RecipeFormProps) {
  const router = useRouter();
  const initial = props.mode === "edit" ? props.initial : null;
  const editing = props.mode === "edit";
  const [name, setName] = useState(initial?.name ?? "");
  const [servings, setServings] = useState(initial?.servings == null ? "" : String(initial.servings));
  const [totalMinutes, setTotalMinutes] = useState(initial?.totalMinutes == null ? "" : String(initial.totalMinutes));
  const [category, setCategory] = useState(initial?.category ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [rows, setRows] = useState<Row[]>(initial && initial.ingredients.length > 0 ? initial.ingredients.map((i) => ({ ...i })) : [{ amount: "", name: "" }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  // A synchronous guard next to the state: a second click or Enter can arrive before React has re-rendered the button as
  // disabled, and the state alone would let it send a second request.
  const saving = useRef(false);
  const importing = useRef(false);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const formHasContent = () =>
    [name, servings, totalMinutes, category, imageUrl, description].some((v) => v.trim() !== "") || rows.some((r) => r.name.trim() !== "" || r.amount.trim() !== "");

  // Fills the form from the draft the server read out of the page's schema.org data. Nothing is saved here.
  async function runImport() {
    if (importUrl.trim() === "" || importing.current) return;
    if (formHasContent() && !window.confirm("Az űrlapon már van kitöltött adat. Felülírjam az importált recepttel?")) return;
    importing.current = true;
    setImportBusy(true);
    setImportError(null);
    setImportNote(null);
    let leaving = false;
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      if (res.status === 401) {
        leaving = true;
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
          "Betöltve az oldal adataiból. Nézd át mentés előtt, különösen a hozzávalókat: a sor elején álló mennyiséget és mértékegységet külön mezőbe tettem, ahol nem voltam biztos benne, a teljes sor a névben maradt." +
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
      if (!leaving) {
        importing.current = false;
        setImportBusy(false);
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return; // a second click while the first save is on its way
    saving.current = true;
    setBusy(true);
    setErrors([]);
    // after a successful save the page navigates: the button stays disabled until it has, so there is no second click
    let leaving = false;
    try {
      const res = await fetch(props.mode === "edit" ? `/api/recipes/${encodeURIComponent(props.slug)}` : "/api/recipes", {
        method: props.mode === "edit" ? "PUT" : "POST",
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
      // 201: saved. 200: saved, or (a new recipe) the server found the same recipe saved a moment ago and answers with that
      // one. An edit always goes back to the recipe's own page.
      if (res.status === 201 || res.status === 200) {
        const { slug } = (await res.json()) as { slug: string };
        leaving = true;
        router.push(`/recept/${slug}`);
        router.refresh();
        return;
      }
      if (res.status === 401) {
        leaving = true;
        router.push("/belepes");
        return;
      }
      if (res.status === 400) {
        const data = (await res.json().catch(() => null)) as { issues?: Issue[] } | null;
        setErrors(data?.issues?.map((i) => `${i.field}: ${i.message}`) ?? ["Hibás adatok."]);
      } else if (res.status === 404 && editing) {
        setErrors(["Ez a recept közben törlődött, nincs mit menteni."]);
      } else if (res.status === 409 && editing) {
        const data = (await res.json().catch(() => null)) as { slug?: string } | null;
        setErrors([`Pontosan ilyen recept már van${data?.slug ? ` (/recept/${data.slug})` : ""}. Változtass valamit, vagy hagyd az eredetit.`]);
      } else if (res.status === 429) {
        setErrors([editing ? "Túl sok mentés rövid időn belül. Próbáld újra pár perc múlva." : "Egy óra alatt legfeljebb 30 recept vehető fel. Próbáld később."]);
      } else setErrors(["Nem sikerült a mentés. Próbáld újra."]);
    } catch {
      setErrors(["Nem sikerült elérni a szervert."]);
    } finally {
      if (!leaving) {
        saving.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <>
      {editing ? null : (
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
      )}

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

      {sourceUrl || editing ? (
        <div className="field">
          <label htmlFor="source">{editing ? "Forrás (https://…, nem kötelező)" : "Forrás (az importált oldal)"}</label>
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
      <div className="import-row">
        <button type="submit" disabled={busy}>
          {busy ? "Mentés..." : "Mentés"}
        </button>
        {props.mode === "edit" ? (
          <Link className="button secondary" href={`/recept/${props.slug}`} aria-disabled={busy}>
            Mégsem
          </Link>
        ) : null}
      </div>
    </form>
    </>
  );
}
