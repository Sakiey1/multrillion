// Parses the plain-text question bank (data/questions.txt).
//
//   Name a prehistoric animal
//   * Paraceratherium | Indricotherium | Baluchitherium +85
//   * Woolly mammoth +10

export interface Answer {
  /** Index within the question, stable for a given file. */
  id: number;
  /** Display name (first name on the line). */
  name: string;
  /** Extra accepted names (after `|`). */
  aliases: string[];
  points: number;
}

export interface Question {
  id: string;
  prompt: string;
  answers: Answer[];
}

export interface ParseIssue {
  line: number;
  message: string;
}

const ANSWER_RE = /^\*\s*(.+?)\s*\+\s*(\d+)\s*$/;

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseQuestions(text: string): { questions: Question[]; issues: ParseIssue[] } {
  const questions: Question[] = [];
  const issues: ParseIssue[] = [];
  let current: Question | null = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const lineNo = i + 1;
    if (!line || line.startsWith("#")) return;

    if (line.startsWith("*")) {
      if (!current) {
        issues.push({ line: lineNo, message: "Answer before any question" });
        return;
      }
      const m = ANSWER_RE.exec(line);
      if (!m) {
        issues.push({ line: lineNo, message: `Could not read answer (expected "* Name +points"): ${line}` });
        return;
      }
      const names = m[1]
        .split("|")
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length === 0) {
        issues.push({ line: lineNo, message: "Answer has no name" });
        return;
      }
      current.answers.push({
        id: current.answers.length,
        name: names[0],
        aliases: names.slice(1),
        points: Number(m[2]),
      });
      return;
    }

    let id = slugify(line);
    if (questions.some((q) => q.id === id)) {
      issues.push({ line: lineNo, message: `Duplicate question: ${line}` });
      id = `${id}-${lineNo}`;
    }
    current = { id, prompt: line, answers: [] };
    questions.push(current);
  });

  for (const q of questions) {
    if (q.answers.length === 0) issues.push({ line: 0, message: `Question has no answers: ${q.prompt}` });
  }
  return { questions, issues };
}

export const TIERS = [
  { min: 100, label: "One in a million", key: "million" },
  { min: 85, label: "Extraordinary", key: "extraordinary" },
  { min: 60, label: "Rare", key: "rare" },
  { min: 30, label: "Uncommon", key: "uncommon" },
  { min: 1, label: "Common", key: "common" },
  { min: 0, label: "No answer", key: "none" },
] as const;

export type TierKey = (typeof TIERS)[number]["key"];

export function tierFor(points: number): (typeof TIERS)[number] {
  return TIERS.find((t) => points >= t.min) ?? TIERS[TIERS.length - 1];
}
