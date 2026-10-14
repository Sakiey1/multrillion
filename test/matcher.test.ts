import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex, editDistance, matchAnswer } from "../src/shared/matcher";
import { normalize } from "../src/shared/normalize";
import { parseQuestions } from "../src/shared/questions";
import { speedBonus } from "../src/shared/scoring";

const { questions, issues } = parseQuestions(readFileSync("data/questions.txt", "utf8"));
const byPrompt = (p: string) => buildIndex(questions.find((q) => q.prompt === p)!);

function expectMatch(prompt: string, input: string, expected: string | null) {
  const r = matchAnswer(byPrompt(prompt), input);
  expect(r.kind === "match" ? r.answer.name : null, `"${input}"`).toBe(expected);
}

describe("question bank", () => {
  it("parses without issues or collisions", () => {
    expect(issues).toEqual([]);
    for (const q of questions) expect(buildIndex(q).collisions, q.prompt).toEqual([]);
  });

  it("reads the user's format, including no space before +", () => {
    const beer = questions.find((q) => q.prompt === "Name a style of beer")!;
    expect(beer.answers.find((a) => a.name === "Grisette")?.points).toBe(100);
    expect(beer.answers.find((a) => a.name === "Stout")?.points).toBe(10);
  });

  it("every name and alias matches itself", () => {
    for (const q of questions) {
      const idx = buildIndex(q);
      for (const a of q.answers) {
        for (const n of [a.name, ...a.aliases]) {
          const r = matchAnswer(idx, n);
          expect(r.kind === "match" && r.answer.id, `${q.prompt}: ${n}`).toBe(a.id);
        }
      }
    }
  });
});

describe("normalize", () => {
  it("strips accents, punctuation, case and leading articles", () => {
    expect(normalize("  Côte d'Ivoire ")).toBe("cote divoire");
    expect(normalize("The Moon")).toBe("moon");
    expect(normalize("T-Rex!")).toBe("t rex");
    expect(normalize("Kölsch", true)).toBe("koelsch");
  });
});

describe("matchAnswer", () => {
  const cases: [string, string, string | null][] = [
    ["Name a prehistoric animal", "indricotherium", "Paraceratherium"],
    ["Name a prehistoric animal", "BALUCHITHERIUM", "Paraceratherium"],
    ["Name a prehistoric animal", "trex", "Tyrannosaurus rex"],
    ["Name a prehistoric animal", "t rex", "Tyrannosaurus rex"],
    ["Name a prehistoric animal", "mammoths", "Woolly mammoth"],
    ["Name a prehistoric animal", "paraceratherum", "Paraceratherium"],
    ["Name a prehistoric animal", "velociraptors", "Velociraptor"],
    ["Name a prehistoric animal", "dragon", null],
    ["Name a country in Africa", "Niger", "Niger"],
    ["Name a country in Africa", "nigeria", "Nigeria"],
    ["Name a country in Africa", "cote divoire", "Côte d'Ivoire"],
    ["Name a country in Africa", "Ivory coast", "Côte d'Ivoire"],
    ["Name a country in Africa", "madagasgar", "Madagascar"],
    ["Name a country in Africa", "iran", null],
    ["Name a chemical element", "aluminum", "Aluminium"],
    ["Name a chemical element", "Fe", "Iron"],
    ["Name a chemical element", "praseodymiun", "Praseodymium"],
    ["Name a US president", "Dubya", "George W. Bush"],
    ["Name a US president", "bush", null], // ambiguous: left to the AI / picker
    ["Name a moon in our solar system", "titan", "Titan"],
    ["Name a moon in our solar system", "titania", "Titania"],
    ["Name a style of beer", "Koelsch", "Kölsch"],
    ["Name a style of beer", "kolsch", "Kölsch"],
    ["Name a style of beer", "marzen", "Märzen"],
    ["Name a style of beer", "stouts", "Stout"],
    ["Name a style of beer", "IPAs", "IPA"],
    ["Name a style of beer", "hefewiezen", "Hefeweizen"],
    ["Name a style of beer", "dunkelweisen", "Dunkelweizen"],
    ["Name a style of beer", "pilsener", "Pilsner"],
    ["Name a style of beer", "west coast ipa", "West Coast IPA"],
    ["Name a style of beer", "Bia hoi", "Bia hơi"],
    ["Name a style of beer", "happoshu", "Happōshu"],
    ["Name a style of beer", "Boza", "Boza"],
    ["Name a style of beer", "Bouza", "Bouza"],
    ["Name a style of beer", "Hoppe", "Hoppe"],
    ["Name a style of beer", "wine", null],
    ["Name a style of beer", "", null],
  ];
  it.each(cases)("%s: %j → %s", (prompt, input, expected) => expectMatch(prompt, input, expected));
});

describe("editDistance", () => {
  it("counts transpositions as one edit", () => {
    expect(editDistance("hefeweizen", "hefewiezen", 3)).toBe(1);
    expect(editDistance("abc", "abc", 0)).toBe(0);
    expect(editDistance("abcdef", "ab", 2)).toBe(3);
  });
});

describe("speedBonus", () => {
  it("is at most 15% and never lets a lower tier overtake a higher one", () => {
    expect(speedBonus(100, 0)).toBe(15);
    expect(speedBonus(100, 30_000)).toBe(0);
    expect(speedBonus(0, 0)).toBe(0);
    expect(85 + speedBonus(85, 0)).toBeLessThan(100);
    expect(60 + speedBonus(60, 0)).toBeLessThan(85);
  });
});
