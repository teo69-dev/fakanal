import { cleanLine, cleanText } from "@/lib/text";
import { isAllowedPublicUrl } from "@/lib/url";

// Reads the schema.org Recipe that a page publishes as JSON-LD (<script type="application/ld+json">). Only what the page
// states is taken over: nothing is guessed, split, translated or completed. What is missing stays missing.

export type ExtractedRecipe = {
  name: string | null;
  servings: number | null;
  totalMinutes: number | null;
  category: string | null;
  imageUrl: string | null;
  description: string | null;
  ingredients: string[];
};

const MAX_BLOCKS = 20;
const MAX_NODES = 5000;
const MAX_DEPTH = 8;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "...", ndash: "-", mdash: "-", lsquo: "'", rsquo: "'",
  ldquo: '"', rdquo: '"', deg: "°", frac12: "1/2", frac14: "1/4", frac34: "3/4",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", ouml: "ö", uacute: "ú", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Ouml: "Ö", Uacute: "Ú", Uuml: "Ü",
  odblac: "ő", udblac: "ű", Odblac: "Ő", Udblac: "Ű",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,10}));/g, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name] ?? whole; // an unknown name stays as it is
    const code = dec ? Number(dec) : parseInt(hex, 16);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

/** Page text out of a JSON-LD string: line-break tags become line breaks, all other tags are dropped, entities decoded. */
export function htmlToText(value: string): string {
  // Every pattern below is LINEAR on hostile input: a tag body is [^<>]*, which can never run past the next "<", so
  // the attempts started by a long run of "<" do not overlap (with [^>]* each one would scan to the end: quadratic,
  // seconds for 128 KB). The page is under the attacker's control, so this matters.
  const withBreaks = value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li\b[^<>]*>/gi, "- ");
  return decodeEntities(withBreaks.replace(/<[^<>]*>/g, ""));
}

const line = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = cleanLine(htmlToText(value));
  return text === "" ? null : text;
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // some sites wrap the JSON in a comment or CDATA section: take those wrapper marks (and "//" lines) away and try again
    const unwrapped = raw.replace(/<!--|-->|<!\[CDATA\[|\]\]>/g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    try {
      return JSON.parse(unwrapped);
    } catch {
      return undefined; // a block that is not valid JSON is skipped
    }
  }
}

const LD_JSON_TYPE = /\btype\s*=\s*["']?application\/ld\+json/i;

/**
 * The content of the JSON-LD script tags. ONE pass over the page: find an opening tag, find its closing tag from
 * there, continue after it. (A single lazy pattern for "open tag ... close tag" is quadratic when the closing tag is
 * missing: every opening tag would scan to the end.) Other scripts are skipped the same way, as a browser does.
 */
function jsonBlocks(html: string): unknown[] {
  const found: unknown[] = [];
  const open = /<script\b([^<>]*)>/gi;
  const close = /<\/script\s*>/gi;
  let at = 0;
  while (found.length < MAX_BLOCKS) {
    open.lastIndex = at;
    const start = open.exec(html);
    if (!start) break;
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) break; // no closing tag: nothing after this point is a complete script
    if (LD_JSON_TYPE.test(start[1] ?? "")) {
      const value = parseJson(html.slice(open.lastIndex, end.index).trim());
      if (value !== undefined) found.push(value);
    }
    at = close.lastIndex;
  }
  return found;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function hasType(node: Record<string, unknown>, wanted: string): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : [t];
  // "Recipe", "https://schema.org/Recipe", "schema:Recipe"
  return types.some((x) => typeof x === "string" && x.split(/[/:#]/).pop() === wanted);
}

function findRecipes(roots: unknown[]): Record<string, unknown>[] {
  const recipes: Record<string, unknown>[] = [];
  let visited = 0;
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_DEPTH || visited++ > MAX_NODES) return;
    if (Array.isArray(value)) return value.forEach((v) => walk(v, depth + 1));
    if (!isObject(value)) return;
    if (hasType(value, "Recipe")) return void recipes.push(value);
    for (const child of Object.values(value)) if (typeof child === "object" && child !== null) walk(child, depth + 1);
  };
  walk(roots, 0);
  return recipes;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function ingredientsOf(node: Record<string, unknown>): string[] {
  return asArray(node.recipeIngredient)
    .map(line)
    .filter((x): x is string => x !== null);
}

type Step = { text: string; heading: boolean };

function stepTexts(value: unknown, depth = 0): Step[] {
  if (depth > 4) return [];
  if (typeof value === "string") {
    const text = cleanText(htmlToText(value));
    return text === "" ? [] : [{ text, heading: false }];
  }
  if (Array.isArray(value)) return value.flatMap((v) => stepTexts(v, depth + 1));
  if (!isObject(value)) return [];
  // HowToSection or ItemList: its steps, with the section's own name as a heading line
  const nested = value.itemListElement ?? value.steps;
  if (nested !== undefined && (hasType(value, "HowToSection") || hasType(value, "ItemList") || !("text" in value))) {
    const heading = line(value.name);
    return [...(heading ? [{ text: heading, heading: true }] : []), ...stepTexts(nested, depth + 1)];
  }
  return stepTexts(typeof value.text === "string" ? value.text : typeof value.description === "string" ? value.description : value.name, depth + 1);
}

function descriptionOf(node: Record<string, unknown>): string | null {
  const steps = stepTexts(node.recipeInstructions);
  if (steps.length === 0) return null;
  if (steps.length === 1) return (steps[0] as Step).text;
  // several steps: one paragraph each; the steps are numbered (section headings are not) unless the page numbers them itself
  const numbered = steps.some((s) => !s.heading && /^\s*\d+[.)]\s/.test(s.text));
  let n = 0;
  return steps.map((s) => (s.heading || numbered ? s.text : `${++n}. ${s.text}`)).join("\n\n");
}

function servingsOf(node: Record<string, unknown>): number | null {
  const first = asArray(node.recipeYield)[0];
  if (typeof first === "number" && !Number.isInteger(first)) return null;
  const text = typeof first === "number" ? String(first) : typeof first === "string" ? first : "";
  // a single whole number, optionally followed by a word ("4", "4 adag"); a range ("4-6") or a decimal ("1.5") is not guessed at
  const m = /^\s*(\d{1,3})\b(?!\s*[-–/])(?![.,]\d)/.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

/** ISO 8601 duration ("PT1H30M", "P0DT45M") in minutes. Anything else is not read. */
export function durationMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+(?:\.\d+)?S)?)?$/i.exec(value.trim());
  if (!m || value.trim().length <= 1) return null;
  const minutes = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return minutes >= 1 && minutes <= 2880 ? minutes : null;
}

function totalMinutesOf(node: Record<string, unknown>): number | null {
  const total = durationMinutes(node.totalTime);
  if (total !== null) return total;
  const prep = durationMinutes(node.prepTime);
  const cook = durationMinutes(node.cookTime);
  // the sum only when the page gives BOTH parts: one part alone is not the total
  if (prep !== null && cook !== null && prep + cook <= 2880) return prep + cook;
  return null;
}

function imageOf(node: Record<string, unknown>): string | null {
  for (const candidate of asArray(node.image)) {
    const url = typeof candidate === "string" ? candidate : isObject(candidate) && typeof candidate.url === "string" ? candidate.url : null;
    const text = url === null ? null : cleanLine(url);
    if (text && isAllowedPublicUrl(text)) return text; // same rule as a hand-typed image address
  }
  return null;
}

function categoryOf(node: Record<string, unknown>): string | null {
  const first = asArray(node.recipeCategory).map(line).find((x) => x !== null) ?? null;
  return first !== null && first.length <= 40 ? first : null;
}

/** The first Recipe of the page (preferring one that has ingredients), or null when the page publishes none. */
export function extractRecipe(html: string): ExtractedRecipe | null {
  const recipes = findRecipes(jsonBlocks(html));
  const node = recipes.find((r) => ingredientsOf(r).length > 0) ?? recipes[0];
  if (!node) return null;
  return {
    name: line(node.name),
    servings: servingsOf(node),
    totalMinutes: totalMinutesOf(node),
    category: categoryOf(node),
    imageUrl: imageOf(node),
    description: descriptionOf(node),
    ingredients: ingredientsOf(node),
  };
}
