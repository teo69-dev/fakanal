import { describe, expect, it } from "vitest";
import { cleanLine, cleanText, escapeLike, searchKey, slugBase } from "./text";

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
    expect(cleanLine("ab\u0000c​d‮e\u0007")).toBe("abcde");
  });
  it("turns line breaks into spaces in one-line fields and collapses spaces", () => {
    expect(cleanLine("  a \n\t b  ")).toBe("a b");
  });
  it("keeps line feeds in the description, normalises CRLF and caps blank runs", () => {
    expect(cleanText("a\r\nb\rc\n\n\n\nd\u0000")).toBe("a\nb\nc\n\nd");
  });
  it("normalises to NFC", () => {
    expect(cleanLine("ö")).toBe("ö");
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});
