import { recipeInputSchema } from "@/lib/validation";
import type { ExtractedRecipe } from "./extract";
import { splitIngredient } from "./ingredient";
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
  // the quantity and unit at the start of a line go to the amount ("50 dkg" | "Csirkemell"); where that is not clear the
  // whole line stays in the name (see ingredient.ts). Nothing is cut or changed.
  if (extracted.ingredients.length > 0) candidate.ingredients = extracted.ingredients.map(splitIngredient);

  let parsed = recipeInputSchema.partial().safeParse(candidate);
  // the picture is optional (and not recipe text): if it is the ONLY thing that does not fit (a CDN address with a long
  // query string is common), the recipe is imported without it and the user is told
  let imageDropped = false;
  if (!parsed.success && "imageUrl" in candidate && parsed.error.issues.every((i) => i.path[0] === "imageUrl")) {
    delete candidate.imageUrl;
    imageDropped = true;
    parsed = recipeInputSchema.partial().safeParse(candidate);
  }
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
  if (imageDropped) missing.push("kép (a címe túl hosszú vagy nem fogadható el)");
  return { ok: true, draft, missing };
}
