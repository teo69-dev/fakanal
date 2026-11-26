// Text normalisation shared by validation, search and slugs.

// C0/C1 control characters, plus zero-width, soft-hyphen, line/paragraph-separator and bidi characters (U+061C included)
// that can disguise text.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

// Lone UTF-16 surrogates are not valid text: Postgres (UTF-8) refuses them, which would turn into a 500 on save.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** One-line text: NFC, tabs and newlines become spaces, control characters removed, whitespace collapsed. */
export function cleanLine(input: string): string {
  return input
    .replace(LONE_SURROGATE, "")
    .normalize("NFC")
    .replace(/[\t\r\n]+/g, " ")
    .replace(CONTROL, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Multi-line text: NFC, CRLF/CR become LF, tabs become spaces, control characters removed (LF stays). */
export function cleanText(input: string): string {
  return input
    .replace(LONE_SURROGATE, "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL, (c) => (c === "\n" ? c : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Search key: lower case and without accents, so "Pörkölt" and "porkolt" meet ("ő" and "ű" included). */
export function searchKey(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function slugBase(name: string): string {
  const base = searchKey(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "recept";
}

/** Escapes the LIKE wildcards so a search for "100%" does not match everything. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The LIKE pattern for a search text (at most `max` characters), or null when there is nothing to search for. */
export function searchPattern(q: string, max = 100): string | null {
  const key = searchKey(q.slice(0, max));
  return key ? `%${escapeLike(key)}%` : null;
}
