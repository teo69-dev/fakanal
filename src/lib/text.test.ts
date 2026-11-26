import { describe, expect, it } from "vitest";
import { cleanLine, cleanText, escapeLike, searchKey, searchPattern, slugBase } from "./text";

describe("searchKey", () => {
  it("lower-cases and strips Hungarian accents, double acutes included", () => {
    expect(searchKey("Pörkölt")).toBe("porkolt");
    expect(searchKey("Őszibarack TÚRÓS Tészta")).toBe("oszibarack turos teszta");
    expect(searchKey("  Rántott   hús ")).toBe("rantott hus");
  });
});

describe("slugBase", () => {
  it("makes a short ascii slug and never an empty one", () => {
    expect(slugBase("Gulyásleves (Marha)")).toBe("gulyasleves-marha");
    expect(slugBase("???")).toBe("recept");
    expect(slugBase("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("cleanLine / cleanText", () => {
  it("removes control, zero-width and bidi override characters", () => {
    expect(cleanLine("ab\u0000c\u200Bd\u202Ee\u0007")).toBe("abcde");
  });
  it("turns line breaks into spaces in one-line fields and collapses spaces", () => {
    expect(cleanLine("  a \n\t b  ")).toBe("a b");
  });
  it("keeps line feeds in the description, normalises CRLF and caps blank runs", () => {
    expect(cleanText("a\r\nb\rc\n\n\n\nd\u0000")).toBe("a\nb\nc\n\nd");
  });
  it("removes lone surrogates (they are not valid UTF-8 text) but keeps real emoji", () => {
    expect(cleanLine("ab\uD800cd")).toBe("abcd");
    expect(cleanLine("ab\uDC00cd")).toBe("abcd");
    expect(cleanText("x\uD800y")).toBe("xy");
    expect(cleanLine("tészta 🍝").isWellFormed()).toBe(true);
    expect(cleanLine("tészta 🍝")).toBe("tészta 🍝");
  });
  it("removes soft hyphens, the Arabic letter mark and the Unicode line and paragraph separators", () => {
    expect(cleanLine("a\u00ADb\u061Cc\u2028d\u2029e")).toBe("abcde");
  });
  it("normalises to NFC", () => {
    expect(cleanLine("o\u0308")).toBe("\u00F6");
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("searchPattern", () => {
  it("builds an accent-free, escaped LIKE pattern, so wildcards in the search are literal", () => {
    expect(searchPattern("Pörkölt")).toBe("%porkolt%");
    expect(searchPattern("100%_x")).toBe("%100\\%\\_x%");
  });
  it("cuts by characters, so an emoji at the cut is dropped whole instead of leaving half of it", () => {
    const pattern = searchPattern("a".repeat(99) + "\u{1F600}b", 100) as string;
    expect(pattern.isWellFormed()).toBe(true);
    expect(pattern).toBe(`%${"a".repeat(99)}\u{1F600}%`);
    expect(searchPattern("a".repeat(100) + "\u{1F600}", 100)).toBe(`%${"a".repeat(100)}%`);
  });
  it("is null for an empty search and cuts a very long one", () => {
    expect(searchPattern("   ")).toBeNull();
    expect(searchPattern("a".repeat(500))).toBe(`%${"a".repeat(100)}%`);
  });
});
