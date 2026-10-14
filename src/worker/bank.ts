import bankText from "../../data/questions.txt?raw";
import { buildIndex, type QuestionIndex } from "../shared/matcher";
import { parseQuestions, type Question } from "../shared/questions";

const parsed = parseQuestions(bankText);
for (const issue of parsed.issues) console.warn(`questions.txt line ${issue.line}: ${issue.message}`);

export const QUESTIONS: Question[] = parsed.questions.filter((q) => q.answers.length > 0);

const indexes = new Map<string, QuestionIndex>();

export function getIndex(questionId: string): QuestionIndex | undefined {
  let idx = indexes.get(questionId);
  if (!idx) {
    const q = QUESTIONS.find((q) => q.id === questionId);
    if (!q) return undefined;
    idx = buildIndex(q);
    indexes.set(questionId, idx);
  }
  return idx;
}

/** Pick a random question, avoiding ones already used this game when possible. */
export function pickQuestion(usedIds: string[]): Question {
  const used = new Set(usedIds);
  const fresh = QUESTIONS.filter((q) => !used.has(q.id));
  const pool = fresh.length ? fresh : QUESTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}
