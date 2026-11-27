import { describe, expect, it } from "vitest";
import { durationMinutes, extractRecipe, htmlToText } from "./extract";

const ld = (data: unknown) => `<script type="application/ld+json">${typeof data === "string" ? data : JSON.stringify(data)}</script>`;
const page = (...blocks: string[]) => `<!doctype html><html><head><title>x</title>${blocks.join("\n")}</head><body><p>szöveg</p></body></html>`;

const RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Gulyásleves",
  recipeIngredient: ["500 g marhahús", "2 db hagyma", "só"],
  recipeInstructions: "Pirítsd meg a hagymát. Add hozzá a húst.",
};

describe("extractRecipe: where the Recipe is", () => {
  it("reads a plain Recipe object", () => {
    const r = extractRecipe(page(ld(RECIPE)));
    expect(r).toEqual({
      name: "Gulyásleves",
      servings: null,
      totalMinutes: null,
      category: null,
      imageUrl: null,
      description: "Pirítsd meg a hagymát. Add hozzá a húst.",
      ingredients: ["500 g marhahús", "2 db hagyma", "só"],
    });
  });

  it("finds it inside an @graph next to other nodes", () => {
    const graph = { "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Blog" }, { "@type": "Organization", name: "Szerk" }, { ...RECIPE, "@context": undefined }] };
    expect(extractRecipe(page(ld(graph)))?.name).toBe("Gulyásleves");
  });

  it("finds it in a top-level array", () => {
    expect(extractRecipe(page(ld([{ "@type": "BreadcrumbList" }, RECIPE])))?.name).toBe("Gulyásleves");
  });

  it("finds it when @type is a list or a full address or a prefixed name", () => {
    for (const type of [["Recipe", "NewsArticle"], "https://schema.org/Recipe", "http://schema.org/Recipe", "schema:Recipe"]) {
      expect(extractRecipe(page(ld({ ...RECIPE, "@type": type })))?.name, JSON.stringify(type)).toBe("Gulyásleves");
    }
  });

  it("finds it nested in another node (an Article whose mainEntity is the Recipe)", () => {
    expect(extractRecipe(page(ld({ "@type": "Article", mainEntity: RECIPE })))?.name).toBe("Gulyásleves");
  });

  it("looks in every JSON-LD block and skips a broken one", () => {
    const html = page(ld("{ this is not json"), ld({ "@type": "WebSite" }), ld(RECIPE));
    expect(extractRecipe(html)?.name).toBe("Gulyásleves");
  });

  it("accepts the script tag in its usual spellings", () => {
    for (const tag of [
      `<script type='application/ld+json'>${JSON.stringify(RECIPE)}</script>`,
      `<script type=application/ld+json>${JSON.stringify(RECIPE)}</script>`,
      `<SCRIPT TYPE="application/ld+json" id="x">${JSON.stringify(RECIPE)}</SCRIPT >`,
      `<script class="a" type="application/ld+json" data-n="1">\n${JSON.stringify(RECIPE)}\n</script>`,
    ]) {
      expect(extractRecipe(page(tag))?.name, tag.slice(0, 40)).toBe("Gulyásleves");
    }
  });

  it("reads JSON wrapped in a comment or CDATA section", () => {
    const wrapped = `<script type="application/ld+json">//<![CDATA[\n${JSON.stringify(RECIPE)}\n//]]></script>`;
    const commented = `<script type="application/ld+json"><!--\n${JSON.stringify(RECIPE)}\n--></script>`;
    expect(extractRecipe(page(wrapped))?.name).toBe("Gulyásleves");
    expect(extractRecipe(page(commented))?.name).toBe("Gulyásleves");
  });

  it("prefers a Recipe that has ingredients over an empty one", () => {
    const empty = { "@type": "Recipe", name: "Üres" };
    expect(extractRecipe(page(ld([empty, RECIPE])))?.name).toBe("Gulyásleves");
    expect(extractRecipe(page(ld([empty])))?.name).toBe("Üres");
  });

  it("answers null when the page publishes no Recipe", () => {
    expect(extractRecipe("<html><body>Nincs itt semmi</body></html>")).toBeNull();
    expect(extractRecipe(page(ld({ "@type": "Article", headline: "Hír" })))).toBeNull();
    expect(extractRecipe(page(ld("{ nope")))).toBeNull();
    expect(extractRecipe(page(ld("null")))).toBeNull();
    expect(extractRecipe(page(ld("[]")))).toBeNull();
    // a recipe written as visible markup only (no JSON-LD) is not read
    expect(extractRecipe('<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="name">Leves</span></div>')).toBeNull();
  });

  it("does not dig through absurdly deep or wide data", () => {
    let deep: unknown = RECIPE;
    for (let i = 0; i < 30; i++) deep = { wrap: deep };
    expect(extractRecipe(page(ld(deep)))).toBeNull();
    const wide = { items: Array.from({ length: 20000 }, () => ({ "@type": "Thing" })), late: RECIPE };
    expect(extractRecipe(page(ld(wide)))).toBeNull();
  });

  it("reads at most 20 JSON-LD blocks", () => {
    const filler = Array.from({ length: 20 }, () => ld({ "@type": "WebSite" }));
    expect(extractRecipe(page(...filler, ld(RECIPE)))).toBeNull();
    expect(extractRecipe(page(...filler.slice(0, 19), ld(RECIPE)))?.name).toBe("Gulyásleves");
  });
});

describe("extractRecipe: the instructions in their several shapes", () => {
  const instructionsOf = (recipeInstructions: unknown) => extractRecipe(page(ld({ ...RECIPE, recipeInstructions })))?.description;

  it("a single string", () => {
    expect(instructionsOf("Süsd meg.")).toBe("Süsd meg.");
  });

  it("a list of strings is numbered", () => {
    expect(instructionsOf(["Vágd fel.", "Süsd meg."])).toBe("1. Vágd fel.\n\n2. Süsd meg.");
  });

  it("a list of HowToStep objects is numbered, using the text", () => {
    const steps = [
      { "@type": "HowToStep", name: "Előkészítés", text: "Vágd fel a hagymát." },
      { "@type": "HowToStep", text: "Pirítsd meg." },
    ];
    expect(instructionsOf(steps)).toBe("1. Vágd fel a hagymát.\n\n2. Pirítsd meg.");
  });

  it("a HowToStep with only a name or only a description is still read", () => {
    expect(instructionsOf([{ "@type": "HowToStep", name: "Keverd el." }, { "@type": "HowToStep", description: "Süsd meg." }])).toBe("1. Keverd el.\n\n2. Süsd meg.");
  });

  it("HowToSection: the section name is a heading line (not numbered), then its numbered steps", () => {
    const sections = [
      { "@type": "HowToSection", name: "A tészta", itemListElement: [{ "@type": "HowToStep", text: "Gyúrd át." }, { "@type": "HowToStep", text: "Pihentesd." }] },
      { "@type": "HowToSection", name: "A töltelék", itemListElement: [{ "@type": "HowToStep", text: "Keverd össze." }] },
    ];
    expect(instructionsOf(sections)).toBe("A tészta\n\n1. Gyúrd át.\n\n2. Pihentesd.\n\nA töltelék\n\n3. Keverd össze.");
  });

  it("an ItemList of steps", () => {
    expect(instructionsOf({ "@type": "ItemList", itemListElement: [{ "@type": "ListItem", text: "Egy." }, { "@type": "ListItem", text: "Kettő." }] })).toBe("1. Egy.\n\n2. Kettő.");
  });

  it("a single HowToStep object (not in a list)", () => {
    expect(instructionsOf({ "@type": "HowToStep", text: "Csak ennyi." })).toBe("Csak ennyi.");
  });

  it("steps that the page numbers itself are not numbered again", () => {
    expect(instructionsOf(["1. Vágd fel.", "2. Süsd meg."])).toBe("1. Vágd fel.\n\n2. Süsd meg.");
    expect(instructionsOf(["1) Vágd fel.", "2) Süsd meg."])).toBe("1) Vágd fel.\n\n2) Süsd meg.");
  });

  it("HTML in the text is turned into plain text: breaks kept, tags dropped, entities decoded", () => {
    expect(instructionsOf("<p>Vágd fel a <b>hagymát</b>.</p><p>Süsd meg &amp; tálald.<br>Jó étvágyat!</p>")).toBe("Vágd fel a hagymát.\nSüsd meg & tálald.\nJó étvágyat!");
  });

  it("is null when there are no instructions or only empty ones (nothing is made up)", () => {
    expect(instructionsOf(undefined)).toBeNull();
    expect(instructionsOf("")).toBeNull();
    expect(instructionsOf([])).toBeNull();
    expect(instructionsOf([{ "@type": "HowToStep" }])).toBeNull();
    expect(instructionsOf({ "@type": "HowToStep", text: 5 })).toBeNull();
  });
});

describe("extractRecipe: the other fields", () => {
  const field = <K extends keyof NonNullable<ReturnType<typeof extractRecipe>>>(extra: Record<string, unknown>, key: K) =>
    extractRecipe(page(ld({ ...RECIPE, ...extra })))?.[key];

  it("ingredients: a list, a single string, entities and blanks cleaned, no splitting into amount and name", () => {
    expect(field({ recipeIngredient: ["200 g liszt", "  1 &frac12; db   tojás ", "", 5, null] }, "ingredients")).toEqual(["200 g liszt", "1 1/2 db tojás"]);
    expect(field({ recipeIngredient: "só" }, "ingredients")).toEqual(["só"]);
    expect(field({ recipeIngredient: undefined }, "ingredients")).toEqual([]);
  });

  it("name: tags and entities are removed", () => {
    expect(field({ name: "<b>Töltött</b> káposzta &amp; sör" }, "name")).toBe("Töltött káposzta & sör");
    expect(field({ name: "" }, "name")).toBeNull();
    expect(field({ name: 5 }, "name")).toBeNull();
  });

  it("servings: a single number, optionally with a word; a range or a sentence is not guessed", () => {
    for (const [y, expected] of [
      [4, 4],
      ["4", 4],
      ["4 adag", 4],
      ["12 szelet", 12],
      [["6", "6 servings"], 6],
      ["4-6", null],
      ["4–6 adag", null],
      ["4/6", null],
      ["Serves 4", null],
      ["négy adag", null],
      [0, null],
      [101, null],
      [1.5, null],
      ["1.5", null],
      ["1,5 adag", null],
      ["", null],
      [undefined, null],
    ] as [unknown, number | null][]) {
      expect(field({ recipeYield: y }, "servings"), JSON.stringify(y)).toBe(expected);
    }
  });

  it("total time: totalTime, or prep plus cook only when BOTH are given", () => {
    expect(field({ totalTime: "PT1H30M" }, "totalMinutes")).toBe(90);
    expect(field({ totalTime: "PT45M", prepTime: "PT5M", cookTime: "PT5M" }, "totalMinutes")).toBe(45);
    expect(field({ prepTime: "PT15M", cookTime: "PT1H" }, "totalMinutes")).toBe(75);
    expect(field({ prepTime: "PT15M" }, "totalMinutes")).toBeNull();
    expect(field({ cookTime: "PT1H" }, "totalMinutes")).toBeNull();
    expect(field({ totalTime: "garbage", prepTime: "PT15M", cookTime: "PT1H" }, "totalMinutes")).toBe(75);
    expect(field({}, "totalMinutes")).toBeNull();
  });

  it("category: the first text, only when it fits", () => {
    expect(field({ recipeCategory: "Főétel" }, "category")).toBe("Főétel");
    expect(field({ recipeCategory: ["Leves", "Magyar"] }, "category")).toBe("Leves");
    expect(field({ recipeCategory: "x".repeat(41) }, "category")).toBeNull();
    expect(field({ recipeCategory: 5 }, "category")).toBeNull();
  });

  it("image: a string, an ImageObject or a list of them, only an acceptable public https address", () => {
    expect(field({ image: "https://example.com/a.jpg" }, "imageUrl")).toBe("https://example.com/a.jpg");
    expect(field({ image: { "@type": "ImageObject", url: "https://example.com/b.jpg" } }, "imageUrl")).toBe("https://example.com/b.jpg");
    expect(field({ image: ["https://example.com/c.jpg", "https://example.com/d.jpg"] }, "imageUrl")).toBe("https://example.com/c.jpg");
    // an unacceptable first candidate is skipped, the next acceptable one is used
    expect(field({ image: ["http://example.com/x.jpg", { url: "https://127.0.0.1/y.jpg" }, "https://example.com/ok.jpg"] }, "imageUrl")).toBe("https://example.com/ok.jpg");
    for (const bad of ["http://example.com/a.jpg", "https://localhost/a.jpg", "https://10.0.0.1/a.jpg", "https://user:pw@example.com/a.jpg", "javascript:alert(1)", "/relative.jpg", "data:image/png;base64,AAAA"]) {
      expect(field({ image: bad }, "imageUrl"), bad).toBeNull();
    }
  });

  it("a recipe with only a name: everything else stays empty, nothing is invented", () => {
    expect(extractRecipe(page(ld({ "@type": "Recipe", name: "Csak név" })))).toEqual({
      name: "Csak név",
      servings: null,
      totalMinutes: null,
      category: null,
      imageUrl: null,
      description: null,
      ingredients: [],
    });
  });
});

describe("durationMinutes", () => {
  it("reads ISO 8601 durations", () => {
    expect(durationMinutes("PT90M")).toBe(90);
    expect(durationMinutes("PT1H")).toBe(60);
    expect(durationMinutes("PT1H30M")).toBe(90);
    expect(durationMinutes("P0DT45M")).toBe(45);
    expect(durationMinutes("P1D")).toBe(1440);
    expect(durationMinutes("pt20m")).toBe(20);
    expect(durationMinutes("PT20M30S")).toBe(20); // seconds are ignored
  });
  it("answers null for anything else or out of range", () => {
    for (const bad of ["", "P", "PT", "PT0M", "90", "1h30", "PT-5M", "PT1H30MX", "P1Y", "P1W", "P3D", 90, null, undefined, {}]) {
      expect(durationMinutes(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(durationMinutes("PT3H")).toBe(180);
  });
});

describe("htmlToText", () => {
  it("handles tags, breaks, list items and entities (named, decimal, hex)", () => {
    expect(htmlToText("a<br/>b<br />c")).toBe("a\nb\nc");
    expect(htmlToText("<ul><li>egy</li><li>kettő</li></ul>").trim()).toBe("- egy\n- kettő");
    expect(htmlToText("&lt;b&gt; &amp;amp; &quot;x&quot; &#233; &#xE9; &eacute; &odblac;")).toBe('<b> &amp; "x" é é é ő');
  });
  it("leaves an unknown or invalid entity alone and drops impossible code points", () => {
    expect(htmlToText("&nosuchthing; &#0; &#55357; &#1114112;")).toBe("&nosuchthing;   ");
  });
  it("is not fooled into double decoding", () => {
    expect(htmlToText("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });
});
