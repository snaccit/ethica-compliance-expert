import { ask } from "./ask";
import { getProvider } from "./llm";
import { appendEvalRun, readEvalCases } from "./store";
import type { AskResult, EvalCase, EvalCaseResult, EvalRun } from "./types";

export function grade(c: EvalCase, r: AskResult): EvalCaseResult {
  const reasons: string[] = [];
  const fold = (x: string) => x.replace(/[\u00a0\u202f]/g, " ").replace(/[‐‑‒–—]/g, "-").toLowerCase();
  const text = fold(`${r.answer?.antwort ?? ""} ${r.answer?.begruendung ?? ""}`);
  const verified = r.citations.filter((x) => x.status === "verifiziert");

  if (r.mode === "suche") reasons.push("kein Sprachmodell erreichbar (nur Suche)");
  if (c.check.must_refuse) {
    // bestanden, wenn der Agent ablehnt ODER keinen Betrag erfindet und die fehlende Quelle benennt
    const namesGap = r.status === "keine_quelle" || (r.answer?.luecken.length ?? 0) > 0;
    const inventsAmount = /\d[\d.,]*\s*(€|euro|eur\b)/i.test(text);
    if (!namesGap) reasons.push("benennt die fehlende Quelle nicht");
    if (inventsAmount) reasons.push("nennt einen Betrag ohne Quelle");
  } else {
    if (r.status === "keine_quelle") reasons.push("meldet fälschlich 'keine Quelle'");
    for (const term of c.check.must_include ?? []) {
      const alts = term.split("|").map((t) => fold(t.trim()));
      if (!alts.some((t) => text.includes(t))) reasons.push(`Begriff fehlt: ${term}`);
    }
    if (c.check.must_cite && !verified.some((x) => x.unit_id.startsWith(c.check.must_cite!)))
      reasons.push(`keine verifizierte Fundstelle ${c.check.must_cite}…`);
    if (r.citations.some((x) => x.status !== "verifiziert")) reasons.push("mindestens ein Zitat nicht verifiziert");
  }
  return { id: c.id, frage: c.frage, passed: reasons.length === 0, reasons, status: r.status, antwort: r.answer?.antwort ?? "" };
}

export async function runEval(onProgress?: (r: EvalCaseResult) => void): Promise<EvalRun> {
  const cases = readEvalCases();
  const results: EvalCaseResult[] = [];
  let tokens = 0;
  const durations: number[] = [];
  const only = (process.env.EVAL_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const p = getProvider();
  let model: string | null = `${p.name}/${p.model}`;
  for (const c of only.length ? cases.filter((x) => only.includes(x.id)) : cases) {
    try {
      const t0 = Date.now();
      const r = await ask(c.frage, undefined, undefined, "eval", { noCache: true });
      durations.push(Date.now() - t0);
      tokens += (r.usage?.input ?? 0) + (r.usage?.output ?? 0);
      model = r.model;
      const g = grade(c, r);
      results.push(g);
      onProgress?.(g);
    } catch (e) {
      const g = { id: c.id, frage: c.frage, passed: false, reasons: [`Fehler: ${(e as Error).message}`], status: "nicht_belegt" as const, antwort: "" };
      results.push(g);
      onProgress?.(g);
    }
  }
  const passed = results.filter((r) => r.passed).length;
  const run: EvalRun = {
    id: new Date().toISOString(),
    created_at: new Date().toISOString(),
    model,
    passed,
    total: results.length,
    score: results.length ? Math.round((passed / results.length) * 100) : 0,
    results,
    tokens,
    avg_seconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 100) / 10 : 0,
  };
  appendEvalRun(run);
  return run;
}
