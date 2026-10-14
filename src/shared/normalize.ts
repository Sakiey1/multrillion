// Text normalization used to compare player input against answer names.

const LETTER_FOLD: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
  ı: "i",
};

// German/Scandinavian transliterations: "Kölsch" is often typed "Koelsch".
const TRANSLIT_FOLD: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ø: "oe",
  å: "aa",
};

const LEADING_ARTICLE = /^(the|a|an) (?=\S)/;

function foldChars(s: string, map: Record<string, string>): string {
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  return out;
}

/**
 * Lowercase, strip accents/punctuation, collapse whitespace, drop a leading article.
 * `transliterate` spells umlauts out (ö → oe) instead of dropping the accent (ö → o).
 */
export function normalize(input: string, transliterate = false): string {
  let s = input.toLowerCase();
  if (transliterate) s = foldChars(s, TRANSLIT_FOLD);
  s = foldChars(s, LETTER_FOLD);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/['’‘`´]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(LEADING_ARTICLE, "");
  return s;
}

export function compact(normalized: string): string {
  return normalized.replace(/ /g, "");
}

/** Singularize the last word of a normalized string ("brussels sprouts" → "brussels sprout"). */
export function singularize(normalized: string): string {
  const words = normalized.split(" ");
  const last = words[words.length - 1];
  let s = last;
  if (last.length > 4 && last.endsWith("ies")) s = last.slice(0, -3) + "y";
  else if (last.length > 4 && /(ches|shes|sses|xes|zes|oes)$/.test(last)) s = last.slice(0, -2);
  else if (last.length > 3 && last.endsWith("s") && !/(ss|us|is)$/.test(last)) s = last.slice(0, -1);
  words[words.length - 1] = s;
  return words.join(" ");
}

/** Every lookup key a name (or player input) can be reached by. */
export function keysFor(name: string): string[] {
  const keys = new Set<string>();
  for (const n of [normalize(name), normalize(name, true)]) {
    if (!n) continue;
    keys.add(n);
    keys.add(compact(n));
  }
  return [...keys];
}

/** Like keysFor, but singularized; used as a second-pass lookup. */
export function stemKeysFor(name: string): string[] {
  const keys = new Set<string>();
  for (const n of [normalize(name), normalize(name, true)]) {
    if (!n) continue;
    const s = singularize(n);
    keys.add(s);
    keys.add(compact(s));
  }
  return [...keys];
}
