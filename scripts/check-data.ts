// Lints data/questions.txt: unreadable lines, empty questions, odd point values,
// and names that normalize to the same key (which would make one answer unreachable).
import { readFileSync } from "node:fs";
import { buildIndex } from "../src/shared/matcher";
import { parseQuestions } from "../src/shared/questions";

const KNOWN_POINTS = new Set([10, 30, 60, 85, 100]);
const file = process.argv[2] ?? "data/questions.txt";
const { questions, issues } = parseQuestions(readFileSync(file, "utf8"));
let problems = 0;

for (const i of issues) {
  console.error(`✗ line ${i.line}: ${i.message}`);
  problems++;
}
for (const q of questions) {
  for (const a of q.answers) {
    if (!KNOWN_POINTS.has(a.points)) console.warn(`! ${q.prompt}: "${a.name}" has unusual points ${a.points}`);
  }
  const seen = new Set<string>();
  for (const c of buildIndex(q).collisions) {
    const pair = c.answers.join(" / ");
    if (seen.has(pair)) continue;
    seen.add(pair);
    console.error(`✗ ${q.prompt}: "${c.answers[0]}" and "${c.answers[1]}" both match "${c.key}"`);
    problems++;
  }
}
const answers = questions.reduce((n, q) => n + q.answers.length, 0);
console.log(`${questions.length} questions, ${answers} answers, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
