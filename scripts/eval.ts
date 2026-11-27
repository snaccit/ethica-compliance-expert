/**
 * Stellt die Testfragen aus evals/questions.yaml und bewertet die Antworten.
 *   npm run eval
 *   EVAL_ONLY=Q01,Q08 npm run eval     (nur einzelne Fragen)
 */
import { loadEnv } from "../lib/env";
loadEnv();
const { runEval } = await import("../lib/evaluate");

const run = await runEval((r) => {
  console.log(`${r.passed ? "✓" : "✗"} ${r.id}  ${r.frage}`);
  if (!r.passed) for (const why of r.reasons) console.log(`     – ${why}`);
});
console.log(`\n${run.passed}/${run.total} bestanden (${run.score} %) · Modell: ${run.model ?? "keins"} · Ø ${run.avg_seconds ?? 0} s pro Frage`);
