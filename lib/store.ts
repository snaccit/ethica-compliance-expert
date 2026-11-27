import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { AskResult, EvalCase, EvalRun, RegistryEntry, SourceEntry, Unit } from "./types";

export const dataDir = () => process.env.DPP_DATA_DIR ?? path.join(process.cwd(), "data");
const p = (f: string) => path.join(dataDir(), f);

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p(file), "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, value: unknown) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(p(file), JSON.stringify(value, null, 2));
}

export const readSources = (): SourceEntry[] =>
  YAML.parse(fs.readFileSync(p("sources.yaml"), "utf8")) as SourceEntry[];

export const readRegistry = () => readJson<RegistryEntry[]>("registry.json", []);
export const writeRegistry = (r: RegistryEntry[]) => writeJson("registry.json", r);

export const readUnits = () => readJson<Unit[]>("units.json", []);
export const writeUnits = (u: Unit[]) => writeJson("units.json", u);
export const unitsMtime = () => {
  try {
    return fs.statSync(p("units.json")).mtimeMs;
  } catch {
    return 0;
  }
};

export const readEvalRuns = () => readJson<EvalRun[]>("evals.json", []);
export const appendEvalRun = (run: EvalRun) => writeJson("evals.json", [...readEvalRuns(), run]);

export const readEvalCases = (): EvalCase[] => {
  const file = process.env.DPP_EVAL_FILE ?? path.join(process.cwd(), "evals", "questions.yaml");
  return YAML.parse(fs.readFileSync(file, "utf8")) as EvalCase[];
};

export function logAnswer(entry: unknown) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.appendFileSync(p("answers.jsonl"), JSON.stringify(entry) + "\n");
}

export function rawPath(short: string) {
  return p(path.join("raw", `${short}.html`));
}

type CacheEntry = { at: string; result: AskResult };
export const readCache = () => readJson<Record<string, CacheEntry>>("cache.json", {});
export function writeCache(key: string, result: AskResult) {
  const c = readCache();
  c[key] = { at: new Date().toISOString(), result };
  writeJson("cache.json", c);
}
