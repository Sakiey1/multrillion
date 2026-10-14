// Rule-based answer matching. The worker falls back to AI when this returns "none".

import { compact, keysFor, normalize, stemKeysFor } from "./normalize";
import type { Answer, Question } from "./questions";

export type MatchResult =
  | { kind: "match"; answer: Answer; via: "exact" | "plural" | "typo" }
  | { kind: "none" };

export interface Collision {
  key: string;
  answers: [string, string];
}

export interface QuestionIndex {
  question: Question;
  exact: Map<string, Answer>;
  stem: Map<string, Answer>;
  /** Compact keys for fuzzy matching, one entry per (answer, key). */
  fuzzy: { key: string; answer: Answer }[];
  collisions: Collision[];
}

export const MAX_INPUT_LENGTH = 60;

export function buildIndex(question: Question): QuestionIndex {
  const exact = new Map<string, Answer>();
  const stem = new Map<string, Answer>();
  const fuzzy: QuestionIndex["fuzzy"] = [];
  const collisions: Collision[] = [];
  const seenFuzzy = new Set<string>();

  const put = (map: Map<string, Answer>, key: string, answer: Answer) => {
    const prev = map.get(key);
    if (prev && prev !== answer) {
      collisions.push({ key, answers: [prev.name, answer.name] });
      return;
    }
    map.set(key, answer);
  };

  for (const answer of question.answers) {
    for (const name of [answer.name, ...answer.aliases]) {
      for (const k of keysFor(name)) put(exact, k, answer);
      for (const k of stemKeysFor(name)) put(stem, k, answer);
      for (const n of [normalize(name), normalize(name, true)]) {
        const key = compact(n);
        const dedupe = `${answer.id}|${key}`;
        if (key && !seenFuzzy.has(dedupe)) {
          seenFuzzy.add(dedupe);
          fuzzy.push({ key, answer });
        }
      }
    }
  }
  return { question, exact, stem, fuzzy, collisions };
}

/** Typos allowed for an input of this (compact) length. */
export function typoBudget(length: number): number {
  if (length < 5) return 0;
  if (length < 8) return 1;
  if (length < 15) return 2;
  return 3;
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions), capped. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev2 = new Array<number>(cols).fill(0);
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = new Array<number>(cols);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

export function matchAnswer(index: QuestionIndex, rawInput: string): MatchResult {
  const input = rawInput.slice(0, MAX_INPUT_LENGTH);

  for (const k of keysFor(input)) {
    const a = index.exact.get(k);
    if (a) return { kind: "match", answer: a, via: "exact" };
  }
  for (const k of stemKeysFor(input)) {
    const a = index.stem.get(k);
    if (a) return { kind: "match", answer: a, via: "plural" };
  }

  // Typos: accept only when one answer is clearly the closest.
  const inputKeys = new Set([compact(normalize(input)), compact(normalize(input, true))]);
  for (const key of inputKeys) {
    const budget = typoBudget(key.length);
    if (budget === 0) continue;
    // Closest distance per answer, looking one edit past the budget to detect near-ties.
    const closest = new Map<Answer, number>();
    for (const entry of index.fuzzy) {
      const d = editDistance(key, entry.key, budget + 1);
      if (d <= budget + 1 && d < (closest.get(entry.answer) ?? Infinity)) closest.set(entry.answer, d);
    }
    const ranked = [...closest].sort((a, b) => a[1] - b[1]);
    const [best, second] = ranked;
    if (best && best[1] <= budget && (!second || second[1] > best[1])) {
      return { kind: "match", answer: best[0], via: "typo" };
    }
  }
  return { kind: "none" };
}
