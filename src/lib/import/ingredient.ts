// Splits an imported ingredient line into the amount (quantity + unit) and the name: "50 dkg Csirkemell" becomes
// "50 dkg" and "Csirkemell". The rule is deliberately narrow: it only separates what is clearly a quantity at the very
// start of the line, and whenever the split is not clear the WHOLE line stays in the name. Nothing is changed, cut or
// reordered: when an amount is returned, `amount + " " + name` is the original line (whitespace collapsed).

export type SplitIngredient = { amount: string | null; name: string };

const MAX_AMOUNT = 40; // the saved amount field takes at most this much
const MAX_LINE = 400; // anything longer is not split (it will not fit the name field anyway)

// units, Hungarian first; written out and abbreviated; the longest are tried first so "dkg" wins over "g"
const UNITS = [
  "kilogramm", "dekagramm", "gramm", "kg", "dkg", "mg", "g",
  "milliliter", "centiliter", "deciliter", "liter", "ml", "cl", "dl", "l",
  "darab", "db", "evőkanál", "teáskanál", "kávéskanál", "mokkáskanál", "kanál", "ek", "tk", "kk",
  "csésze", "bögre", "pohár", "csipet", "csokor", "gerezd", "szelet", "szál", "csomag", "fej", "doboz", "marék",
  "konzerv", "tasak", "üveg", "kocka", "szem", "levél", "ág", "rúd", "cs",
  // English, so that a page in English is not split halfway ("2" | "tablespoons vegetable oil")
  "milliliters", "millilitres", "millilitre", "litres", "litre", "liters", "kilograms", "kilogram", "grams", "gram",
  "tablespoons", "tablespoon", "tbsp", "teaspoons", "teaspoon", "tsp", "cups", "cup", "ounces", "ounce", "oz",
  "pounds", "pound", "lbs", "lb", "cloves", "clove", "pinches", "pinch", "bunches", "bunch", "cans", "can",
  "slices", "slice", "stalks", "stalk", "pints", "pint", "quarts", "quart", "sticks", "stick", "sprigs", "sprig",
  "heads", "head", "packages", "package", "pkg", "jars", "jar", "dash", "handful",
].sort((a, b) => b.length - a.length);

// words that may stand between the quantity and the unit: "1 kis csokor", "1 nagy fej"
const MODIFIERS = ["kisebb", "nagyobb", "közepes", "csapott", "púpozott", "púpos", "kis", "nagy", "large", "small", "medium", "heaping", "level"];

const FRACTIONS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";
const NUMBER = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?\\s?[${FRACTIONS}]|[${FRACTIONS}]|\\d+(?:[.,]\\d+)?)`;
// a quantity, or a range of two ("2-3", "1,5 - 2")
const QUANTITY = new RegExp(`^${NUMBER}(?:\\s*[-–—]\\s*${NUMBER})?`, "u");
const UNIT = new RegExp(`^\\s*(?:(?:${MODIFIERS.join("|")})\\s+)?(?:${UNITS.join("|")})\\.?(?=$|[\\s,;:()/\\-–—])`, "iu");

// what follows a quantity but means the quantity is part of something longer or alternative: not split
const UNSURE_START = /^(?:[(\[,;:+/*=\-–—\d]|(?:és|vagy|plusz|kb|cca|and|or|plus|to)(?![\p{L}]))/iu;

export function splitIngredient(line: string): SplitIngredient {
  const whole: SplitIngredient = { amount: null, name: line };
  if (line.length > MAX_LINE) return whole;

  const quantity = QUANTITY.exec(line);
  if (!quantity) return whole; // "Olaj", "Szezámmag", "kb. 2 dl tej", "100% gyümölcslé" (a "%" is not a unit)

  const afterQuantity = line.slice(quantity[0].length);
  const unit = UNIT.exec(afterQuantity);
  let end = quantity[0].length;
  if (unit) {
    end += unit[0].length;
  } else if (!/^\s/.test(afterQuantity)) {
    return whole; // a number glued to a word that is not a unit ("7up"), or nothing after it
  }

  const amount = line.slice(0, end).replace(/\s+/g, " ").trim();
  const name = line.slice(end).trim();
  if (name === "" || amount.length > MAX_AMOUNT || UNSURE_START.test(name)) return whole;
  return { amount, name };
}
