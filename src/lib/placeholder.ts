// The look of a recipe that has no picture: a coloured tile with the first letter of its name. Everything here is
// deterministic (the same recipe always gets the same tile) and needs nothing from outside: no image, no font file.

export const PALETTE_COUNT = 6;
export const PATTERN_COUNT = 3;

/** FNV-1a over the code points: small, fast, and spreads similar slugs ("leves-a1b2c3", "leves-a1b2c4") apart. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The colour pair of the tile (an index into the palettes of globals.css), from the recipe's address. */
export function paletteOf(slug: string): number {
  return hashText(slug) % PALETTE_COUNT;
}

/** The faint drawing behind the letter, chosen from other bits of the same hash so it does not follow the colour. */
export function patternOf(slug: string): number {
  return Math.floor(hashText(slug) / PALETTE_COUNT) % PATTERN_COUNT;
}

/**
 * The letter on the tile: the first letter or digit of the name in capitals ("őszibarack" gives "Ő"), skipping any
 * punctuation, quotes or emoji in front. "R" (for recept) when the name has none.
 */
export function initialOf(name: string): string {
  const first = Array.from(name).find((c) => /[\p{L}\p{N}]/u.test(c));
  if (!first) return "R";
  return Array.from(first.toLocaleUpperCase("hu"))[0] ?? "R";
}
