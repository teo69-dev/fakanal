import { z } from "zod";
import { cleanLine, cleanText } from "./text";
import { isAllowedImageUrl } from "./url";

export const LIMITS = {
  name: 120,
  ingredients: 60,
  amount: 40,
  ingredientName: 120,
  description: 10_000,
  category: 40,
  imageUrl: 500,
  servingsMax: 100,
  totalMinutesMax: 2880,
} as const;

const line = (max: number) =>
  z
    .string()
    .transform(cleanLine)
    .pipe(z.string().min(1, "kötelező").max(max, `legfeljebb ${max} karakter`));

// optional text field: absent, null or blank becomes null
const optionalLine = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v == null ? "" : cleanLine(v)))
    .pipe(z.string().max(max, `legfeljebb ${max} karakter`))
    .transform((v) => (v === "" ? null : v));

const optionalInt = (max: number) =>
  z
    .number()
    .int("egész szám kell")
    .min(1, "legalább 1")
    .max(max, `legfeljebb ${max}`)
    .nullish()
    .transform((v) => v ?? null);

// https only, a public host name (no IP literal, localhost or internal name), no credentials, no scripts or data: URLs
const imageUrl = z
  .string()
  .nullish()
  .transform((v) => (v == null ? "" : cleanLine(v)))
  .pipe(
    z
      .string()
      .max(LIMITS.imageUrl, `legfeljebb ${LIMITS.imageUrl} karakter`)
      .refine((v) => v === "" || isAllowedImageUrl(v), "csak nyilvános https:// kép-cím lehet (IP-cím, localhost és belső név nem)"),
  )
  .transform((v) => (v === "" ? null : v));

export const recipeInputSchema = z.strictObject({
  name: line(LIMITS.name),
  servings: optionalInt(LIMITS.servingsMax),
  totalMinutes: optionalInt(LIMITS.totalMinutesMax),
  category: optionalLine(LIMITS.category),
  description: z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(1, "kötelező").max(LIMITS.description, `legfeljebb ${LIMITS.description} karakter`)),
  imageUrl,
  ingredients: z
    .array(
      z.strictObject({
        amount: optionalLine(LIMITS.amount),
        name: line(LIMITS.ingredientName),
      }),
    )
    .min(1, "legalább 1 hozzávaló kell")
    .max(LIMITS.ingredients, `legfeljebb ${LIMITS.ingredients} hozzávaló`),
});

export type RecipeInput = z.output<typeof recipeInputSchema>;

export const loginSchema = z.strictObject({ password: z.string().min(1).max(200) });
