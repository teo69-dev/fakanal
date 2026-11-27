// What the import form tells the user for every answer of POST /api/import (Hungarian, shown as plain text).

export const IMPORT_MESSAGES: Record<string, string> = {
  invalid_url: "Ez nem elfogadható cím. Nyilvános https:// cím kell (IP-cím, localhost, belső név és port nélkül).",
  too_many_imports: "Túl sok import rövid időn belül. Próbáld újra pár perc múlva.",
  blocked: "Ezt a címet nem tölthetem le (belső vagy nem nyilvános címre mutat).",
  timeout: "Az oldal nem válaszolt időben (8 másodperc).",
  fetch_failed: "Az oldalt nem sikerült letölteni.",
  http_status: "Az oldal hibával válaszolt, ezért nem tudom betölteni.",
  too_many_redirects: "Az oldal túl sok átirányítást használ.",
  not_html: "A cím nem weboldalra (HTML) mutat.",
  too_large: "Az oldal túl nagy (legfeljebb 5 MB tölthető be).",
  no_recipe:
    "Az oldalon nem találtam strukturált (schema.org) recept-adatot, ezért nem tudom betölteni. A receptet kézzel tudod felvenni.",
  too_long: "A recept-adat az oldalon hosszabb, mint amit ez az oldal elfogad, ezért nem töltöm be: ",
  not_configured: "Az import még nincs beállítva a szerveren.",
  unauthorized: "A belépés lejárt, lépj be újra.",
  forbidden: "A kérés nem fogadható el.",
  bad_request: "Hibás kérés.",
};

export type ImportDraft = {
  name: string;
  servings: number | null;
  totalMinutes: number | null;
  category: string;
  imageUrl: string;
  sourceUrl: string;
  description: string;
  ingredients: { amount: string; name: string }[];
};

export type ImportAnswer = { recipe: ImportDraft; missing: string[] };
