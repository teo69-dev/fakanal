import { recipeInputSchema } from "@/lib/validation";
import type { ExtractedRecipe } from "./extract";
import type { ImportDraft } from "./messages";

export type DraftResult = { ok: true; draft: ImportDraft; missing: string[] } | { ok: false; tooLong: string[] };

const FIELD_LABELS: Record<string, string> = {
  name: "név",
  description: "elkészítés",
  ingredients: "hozzávalók",
  category: "kategória",
  imageUrl: "kép",
  sourceUrl: "forrás",
  servings: "adag",
  totalMinutes: "idő",
};

/**
 * Turns what the page said into the form's draft, through the SAME zod rules as saving (partial: a field the page did not
 * give simply stays empty). The text is cleaned by those rules; a value that breaks a limit is NOT cut to size: the
 * import is refused and the field is named, because a shortened recipe would no longer be what the page says.
 */
export function buildDraft(extracted: ExtractedRecipe, sourceUrl: string): DraftResult {
  const candidate: Record<string, unknown> = { sourceUrl };
  if (extracted.name !== null) candidate.name = extracted.name;
  if (extracted.description !== null) candidate.description = extracted.description;
  if (extracted.servings !== null) candidate.servings = extracted.servings;
  if (extracted.totalMinutes !== null) candidate.totalMinutes = extracted.totalMinutes;
  if (extracted.category !== null) candidate.category = extracted.category;
  if (extracted.imageUrl !== null) candidate.imageUrl = extracted.imageUrl;
  // the page's ingredient lines go in whole as names: splitting "200 g liszt" into amount and name would be a guess
  if (extracted.ingredients.length > 0) candidate.ingredients = extracted.ingredients.map((name) => ({ amount: null, name }));

  const parsed = recipeInputSchema.partial().safeParse(candidate);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => FIELD_LABELS[String(i.path[0])] ?? String(i.path[0])));
    return { ok: false, tooLong: [...fields] };
  }
  const data = parsed.data;
  const draft: ImportDraft = {
    name: data.name ?? "",
    servings: data.servings ?? null,
    totalMinutes: data.totalMinutes ?? null,
    category: data.category ?? "",
    imageUrl: data.imageUrl ?? "",
    sourceUrl: data.sourceUrl ?? "",
    description: data.description ?? "",
    ingredients: (data.ingredients ?? []).map((i) => ({ amount: i.amount ?? "", name: i.name })),
  };
  const missing: string[] = [];
  if (draft.name === "") missing.push(FIELD_LABELS.name as string);
  if (draft.ingredients.length === 0) missing.push(FIELD_LABELS.ingredients as string);
  if (draft.description === "") missing.push(FIELD_LABELS.description as string);
  return { ok: true, draft, missing };
}
