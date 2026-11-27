import { describe, expect, it } from "vitest";
import { splitIngredient } from "./ingredient";

const split = (line: string) => {
  const r = splitIngredient(line);
  return [r.amount, r.name] as const;
};

describe("splitIngredient: the quantity and unit at the start go to the amount", () => {
  it("the lines Máté named", () => {
    expect(split("50 dkg Csirkemell")).toEqual(["50 dkg", "Csirkemell"]);
    expect(split("2-3 db Újhagyma")).toEqual(["2-3 db", "Újhagyma"]);
    expect(split("1 kis csokor Petrezselyemzöld")).toEqual(["1 kis csokor", "Petrezselyemzöld"]);
    expect(split("1 dkg reszelt gyömbér")).toEqual(["1 dkg", "reszelt gyömbér"]);
    expect(split("1/2 tk só")).toEqual(["1/2 tk", "só"]);
    expect(split("1,5 dl tej")).toEqual(["1,5 dl", "tej"]);
  });

  it("every Hungarian unit that was asked for, short and long forms", () => {
    for (const unit of ["g", "dkg", "kg", "ml", "cl", "dl", "l", "db", "ek", "tk", "kk", "csipet", "gerezd", "szelet", "szál", "csokor", "kis csokor", "nagy csokor", "csomag", "fej", "doboz", "marék", "cs", "evőkanál", "teáskanál", "gramm", "liter", "darab"]) {
      expect(split(`3 ${unit} valami`), unit).toEqual([`3 ${unit}`, "valami"]);
    }
  });

  it("a unit is read in any case and with a dot", () => {
    expect(split("2 DKG Liszt")).toEqual(["2 DKG", "Liszt"]);
    expect(split("2 ek. olaj")).toEqual(["2 ek.", "olaj"]);
    expect(split("1 tk. só")).toEqual(["1 tk.", "só"]);
  });

  it("quantities: whole, decimal with a comma or a point, fraction, mixed, unicode fraction, range", () => {
    expect(split("3 db tojás")).toEqual(["3 db", "tojás"]);
    expect(split("0,5 l tej")).toEqual(["0,5 l", "tej"]);
    expect(split("0.5 l tej")).toEqual(["0.5 l", "tej"]);
    expect(split("1/4 db citrom")).toEqual(["1/4 db", "citrom"]);
    expect(split("1 1/2 db tojás")).toEqual(["1 1/2 db", "tojás"]);
    expect(split("½ citrom")).toEqual(["½", "citrom"]);
    expect(split("1½ dl tej")).toEqual(["1½ dl", "tej"]);
    expect(split("2-3 db tojás")).toEqual(["2-3 db", "tojás"]);
    expect(split("2–3 db tojás")).toEqual(["2–3 db", "tojás"]);
    expect(split("1,5 - 2 dl tej")).toEqual(["1,5 - 2 dl", "tej"]);
  });

  it("a number with no unit takes the number: \"2 tojás\"", () => {
    expect(split("2 tojás")).toEqual(["2", "tojás"]);
    expect(split("1 nagy hagyma")).toEqual(["1", "nagy hagyma"]);
    expect(split("1/2 citrom")).toEqual(["1/2", "citrom"]);
  });

  it("the unit may stand right behind the number", () => {
    expect(split("50dkg csirkemell")).toEqual(["50dkg", "csirkemell"]);
    expect(split("200g liszt")).toEqual(["200g", "liszt"]);
  });

  it("a size word in front of the unit belongs to the amount", () => {
    expect(split("1 nagy fej vöröshagyma")).toEqual(["1 nagy fej", "vöröshagyma"]);
    expect(split("1 kis fej hagyma")).toEqual(["1 kis fej", "hagyma"]);
    expect(split("1 csapott tk szódabikarbóna")).toEqual(["1 csapott tk", "szódabikarbóna"]);
  });

  it("English pages are split sensibly too", () => {
    expect(split("2 tablespoons vegetable oil")).toEqual(["2 tablespoons", "vegetable oil"]);
    expect(split("500 g Beef Shin or Stewing Beef (17oz )")).toEqual(["500 g", "Beef Shin or Stewing Beef (17oz )"]);
    expect(split("3 large potatoes (chopped)")).toEqual(["3", "large potatoes (chopped)"]);
    expect(split("1 cup flour")).toEqual(["1 cup", "flour"]);
    expect(split("2 litres water")).toEqual(["2 litres", "water"]);
    expect(split("1 Tsp Salt ((plus extra to taste))")).toEqual(["1 Tsp", "Salt ((plus extra to taste))"]);
  });

  it("real lines of four recipe pages", () => {
    expect(split("50 dekagramm marhahús (lábszár vagy nyak)")).toEqual(["50 dekagramm", "marhahús (lábszár vagy nyak)"]);
    expect(split("2 darab Knorr Marhahúsleves-kocka")).toEqual(["2 darab", "Knorr Marhahúsleves-kocka"]);
    expect(split("1 evőkanál fűszerpaprika")).toEqual(["1 evőkanál", "fűszerpaprika"]);
    expect(split("¼ cup Hungarian paprika")).toEqual(["¼ cup", "Hungarian paprika"]);
    expect(split("4 lbs /2 kg beef or pork (cut in ½\" cubes)")).toEqual([null, "4 lbs /2 kg beef or pork (cut in ½\" cubes)"]);
    expect(split("Salt and pepper to taste")).toEqual([null, "Salt and pepper to taste"]);
    expect(split("pinch of salt")).toEqual([null, "pinch of salt"]);
  });

  it("the name keeps everything after the amount, its first letter included", () => {
    expect(split("50 dkg Csirkemell, felkockázva (bőr nélkül)")).toEqual(["50 dkg", "Csirkemell, felkockázva (bőr nélkül)"]);
    expect(split("2 db ŐSZIBARACK")).toEqual(["2 db", "ŐSZIBARACK"]);
  });
});

describe("splitIngredient: when it is not clear, the whole line stays in the name", () => {
  const whole = (line: string) => expect(split(line), line).toEqual([null, line]);

  it("no quantity at the start", () => {
    for (const l of ["Olaj", "Szezámmag", "só", "kb. 2 dl tej", "cca 20 dkg liszt", "Liszt - 2 dl", "ízlés szerint só", "egy csipet só", ""]) whole(l);
  });

  it("a number that is not a quantity", () => {
    for (const l of ["100% gyümölcslé", "7up", "3M ragasztó", "2x tojás", "5,5%-os tej"]) whole(l);
  });

  it("a quantity with nothing after it", () => {
    for (const l of ["200 g", "2", "1 db", "1/2 tk", "50 dkg "]) expect(splitIngredient(l.trim()).amount, l).toBeNull();
  });

  it("an alternative, a second quantity or a continuation right after the quantity", () => {
    for (const l of ["2 vagy 3 db tojás", "1 és 1/2 db tojás", "2 db 20 dkg-os kolbász", "200 g-os csomag", "2 db, felkockázva", "2 db (kb. 20 dkg) hagyma", "1 dl / 1 pohár tej", "2 db - 3 db tojás", "1 plusz 2 db", "3 + 2 db tojás"]) whole(l);
  });

  it("an amount that would be too long for the field", () => {
    whole(`${"1".repeat(41)} db tojás`);
  });

  it("a very long line is left alone", () => {
    const long = `2 db ${"x ".repeat(300)}`;
    expect(splitIngredient(long)).toEqual({ amount: null, name: long });
  });
});

describe("splitIngredient: nothing is lost", () => {
  // small deterministic generator, no dependency
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pick = <T,>(items: T[]) => items[rnd(items.length)] as T;
  const NUMS = ["1", "2", "10", "0,5", "1.5", "1/2", "3/4", "1 1/2", "½", "1½", "2-3", "2–3", "1,5 - 2", "100", "7", "05"];
  const UNITS = ["g", "dkg", "kg", "dl", "l", "db", "ek", "tk.", "csipet", "kis csokor", "nagy fej", "cup", "DKG", ""];
  const WORDS = ["liszt", "Tej", "olaj", "(bio)", "és", "vagy", "kb.", "20", "dkg-os", "-", "/", ",", "%", "ŐSZ", "tojás,", "só."];
  const GLUE = [" ", " ", " ", "  ", "", "\t"];

  it("for thousands of generated lines: amount + name is the original line, the name is a tail of it, the amount fits", () => {
    let split_ = 0;
    for (let i = 0; i < 6000; i++) {
      const line = [pick(["", "", "kb. ", "Összesen "]), pick(NUMS), pick(GLUE), pick(UNITS), pick(GLUE), pick(WORDS), pick(GLUE), pick(WORDS)].join("").trim();
      const r = splitIngredient(line);
      expect(r.name.length, line).toBeGreaterThan(0);
      if (r.amount === null) {
        expect(r.name, line).toBe(line);
      } else {
        split_++;
        expect(r.amount.length, line).toBeLessThanOrEqual(40);
        const norm = (t: string) => t.replace(/\s+/g, " ").trim();
        expect(norm(`${r.amount} ${r.name}`), line).toBe(norm(line)); // nothing lost, nothing added, same order
        expect(norm(line).startsWith(r.amount), line).toBe(true);
        expect(norm(line).endsWith(norm(r.name)), line).toBe(true); // the name is the tail: its first letter is untouched
      }
    }
    expect(split_).toBeGreaterThan(500); // the generator does produce splittable lines
  });
});

describe("splitIngredient: stays fast on hostile lines", () => {
  it("20 000 lines of the worst shapes for the patterns, 399 characters each, in well under a second", () => {
    const shapes = ["1 ", "1/", "1-", "½", "1,", "1 1/", "2 db ", "1 kis ", "x"];
    const lines = shapes.flatMap((unit) => Array.from({ length: 2200 }, (_, i) => unit.repeat(Math.ceil(399 / unit.length)).slice(0, 399 - (i % 3))));
    const start = performance.now();
    for (const line of lines) splitIngredient(line);
    expect(performance.now() - start).toBeLessThan(800);
  });
});
