import { describe, expect, it } from "vitest";
import { buildPrompt, parseVerdict } from "../src/worker/ai";
import { parseQuestions } from "../src/shared/questions";

const { questions } = parseQuestions(`Name a US president
* George W. Bush +30
* George H. W. Bush +60
* Abraham Lincoln | Honest Abe +10
`);
const q = questions[0];

describe("parseVerdict", () => {
  it("accepts a numbered match", () => {
    const v = parseVerdict('{"match": 3, "options": []}', q);
    expect(v.kind === "match" && v.answer.name).toBe("Abraham Lincoln");
  });
  it("tolerates chatter around the JSON and string numbers", () => {
    const v = parseVerdict('Sure! {"match": "1", "options": []} hope that helps', q);
    expect(v.kind === "match" && v.answer.name).toBe("George W. Bush");
  });
  it("returns ambiguous options", () => {
    const v = parseVerdict('{"match": null, "options": [1, 2]}', q);
    expect(v.kind === "ambiguous" && v.options.map((a) => a.name)).toEqual(["George W. Bush", "George H. W. Bush"]);
  });
  it("treats a single option as a match and out-of-range numbers as nothing", () => {
    const one = parseVerdict('{"match": null, "options": [2]}', q);
    expect(one.kind === "match" && one.answer.name).toBe("George H. W. Bush");
    expect(parseVerdict('{"match": 99, "options": []}', q).kind).toBe("none");
  });
  it("reports unparseable replies as errors", () => {
    expect(parseVerdict("I think Lincoln", q).kind).toBe("error");
  });
  it("lists every answer and alias in the prompt", () => {
    const p = buildPrompt(q, "abe");
    expect(p).toContain("3. Abraham Lincoln (also: Honest Abe)");
    expect(p).toContain('A player typed: "abe"');
  });
});
