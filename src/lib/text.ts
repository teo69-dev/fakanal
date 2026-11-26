// Text normalisation shared by validation, search and slugs.

// C0/C1 control characters, plus zero-width and bidi-override characters that can disguise text.
const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** One-line text: NFC, tabs and newlines become spaces, control characters removed, whitespace collapsed. */
export function cleanLine(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\t\r\n]+/g, " ")
    .replace(CONTROL, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Multi-line text: NFC, CRLF/CR become LF, tabs become spaces, control characters removed (LF stays). */
export function cleanText(input: string): string {
  return input
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
