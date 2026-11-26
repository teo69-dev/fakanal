"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
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
  const [rows, setRows] = useState<Row[]>([{ amount: "", name: "" }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

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
  );
}
