// Lenient AI fallback for answers the rule-based matcher didn't recognise.
// It can only ever pick from the question's own answer list.

import type { Answer, Question } from "../shared/questions";

export type AiVerdict =
  | { kind: "match"; answer: Answer }
  | { kind: "ambiguous"; options: Answer[] }
  | { kind: "none" }
  | { kind: "error"; message: string };

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const TIMEOUT_MS = 8000;

export function buildPrompt(question: Question, input: string): string {
  const list = question.answers
    .map((a, i) => `${i + 1}. ${a.name}${a.aliases.length ? ` (also: ${a.aliases.join(", ")})` : ""}`)
    .join("\n");
  return `You are the judge in a trivia game.
Question: "${question.prompt}"
The ONLY valid answers are the numbered entries below.

${list}

A player typed: ${JSON.stringify(input)}

Which entry did the player mean? Be lenient. Accept misspellings, phonetic spellings, alternate or historical names, synonyms, translations, abbreviations, nicknames, singular/plural, different word order, and extra or missing generic words (like "beer", "style", "the"). If the player named a well-known specific example or variant of exactly one entry, accept that entry.
Do NOT accept something that is a different thing that is merely related, a broader category than the entry, or anything that isn't one of the entries.
If the input could equally mean 2 to 4 different entries, list them as options instead of choosing.

Reply with JSON only, no other text: {"match": <entry number or null>, "options": [<entry numbers>]}`;
}

export function parseVerdict(text: string, question: Question): AiVerdict {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return { kind: "error", message: `Unparseable AI reply: ${text.slice(0, 200)}` };
  let parsed: { match?: unknown; options?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return { kind: "error", message: `Invalid AI JSON: ${json.slice(0, 200)}` };
  }
  const pick = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) ? question.answers[n - 1] : typeof n === "string" ? question.answers[Number(n) - 1] : undefined;

  const match = pick(parsed.match);
  if (match) return { kind: "match", answer: match };

  const options = Array.isArray(parsed.options)
    ? [...new Set(parsed.options.map(pick).filter((a): a is Answer => !!a))]
    : [];
  if (options.length === 1) return { kind: "match", answer: options[0] };
  if (options.length >= 2 && options.length <= 4) return { kind: "ambiguous", options };
  return { kind: "none" };
}

/** The slice of the Worker env this module needs (kept minimal so tests can import it). */
interface AiEnv {
  AI?: { run: (...args: never[]) => unknown };
  AI_MODEL?: string;
  AI_FALLBACK?: string;
}

type RunFn = (model: string, input: unknown) => Promise<unknown>;

export async function aiMatch(env: AiEnv, question: Question, input: string): Promise<AiVerdict> {
  if (!env.AI || env.AI_FALLBACK === "off") return { kind: "error", message: "AI fallback disabled" };
  try {
    const run = (env.AI.run as unknown as RunFn).call(env.AI, env.AI_MODEL || DEFAULT_MODEL, {
      messages: [{ role: "user", content: buildPrompt(question, input) }],
      max_tokens: 60,
      temperature: 0,
    });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timeout")), TIMEOUT_MS));
    const result = (await Promise.race([run, timeout])) as { response?: unknown };
    const response = result?.response;
    const text = typeof response === "string" ? response : JSON.stringify(response ?? "");
    return parseVerdict(text, question);
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
