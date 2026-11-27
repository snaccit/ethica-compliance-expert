import MiniSearch from "minisearch";
import { readUnits, unitsMtime } from "./store";
import type { Unit } from "./types";

const STOP = new Set(
  "der die das den dem des ein eine einer eines einem einen und oder für fuer mit von zu im in ist sind wird werden auf an als auch bei nach aus über ueber unter wie was wer wann welche welcher welches gilt gelten muss müssen nicht kein keine es sich so ab dass da wenn ob".split(
    " ",
  ),
);

const SOURCE_HINTS: [RegExp, string][] = [
  [/batter|battvo|2023\/1542/i, "BattVO"],
  [/espr|ökodesign|oekodesign|ecodesign|2024\/1781/i, "ESPR"],
  [/reach|1907\/2006/i, "REACH"],
  [/csrd|nachhaltigkeitsbericht|2022\/2464/i, "CSRD"],
  [/altfahrzeug|elv/i, "AltfahrzeugRL"],
];

type Index = { mtime: number; ms: MiniSearch<Unit>; units: Unit[]; byId: Map<string, Unit> };
let cache: Index | null = null;

export function getIndex(): Index {
  const mtime = unitsMtime();
  if (cache && cache.mtime === mtime) return cache;
  const units = readUnits();
  const ms = new MiniSearch<Unit>({
    fields: ["text", "heading", "path"],
    storeFields: ["id"],
    processTerm: (t) => {
      const w = t.toLowerCase();
      return w.length < 2 || STOP.has(w) ? null : w;
    },
  });
  ms.addAll(units);
  cache = { mtime, ms, units, byId: new Map(units.map((u) => [u.id, u])) };
  return cache;
}

/** Findet direkte Verweise wie "Art. 77 Abs. 1" oder "Anhang XIII". */
export function directRefs(q: string, units: Unit[]): Unit[] {
  const hinted = SOURCE_HINTS.filter(([re]) => re.test(q)).map(([, s]) => s);
  const inScope = (u: Unit) => hinted.length === 0 || hinted.includes(u.source);
  const out: Unit[] = [];
  for (const m of q.matchAll(/(?:Art\.?|Artikel)\s*(\d+[a-z]?)(?:\s*(?:Abs\.?|Absatz)\s*(\d+))?/gi)) {
    const [, art, abs] = m;
    const inArt = units.filter((u) => inScope(u) && new RegExp(`:Art${art}(\\(|$|#|~)`).test(u.id));
    const exact = abs ? inArt.filter((u) => u.id.includes(`:Art${art}(${abs})`)) : [];
    out.push(...exact, ...inArt);
  }
  for (const m of q.matchAll(/Anhang\s+([IVXLC]+)\b/gi)) {
    out.push(...units.filter((u) => inScope(u) && new RegExp(`:Anh${m[1].toUpperCase()}(\\(|#|~|$)`).test(u.id)));
  }
  return out;
}

/**
 * Sucht passende Absätze: direkte Verweise ("Art. 77 Abs. 1", "Anhang XIII") zuerst,
 * danach Volltextsuche (BM25 über MiniSearch), wobei Überschrift und Fundort stärker zählen.
 */
export function search(q: string, k = 12): Unit[] {
  const { ms, units, byId } = getIndex();
  if (units.length === 0) return [];
  const direct = directRefs(q, units).slice(0, 8);
  const hits = ms.search(q, { boost: { heading: 2.5, path: 2 }, fuzzy: 0.15, prefix: true, combineWith: "OR" });
  const result: Unit[] = [];
  const ids = new Set<string>();
  for (const u of [...direct, ...hits.map((h) => byId.get(h.id as string)!)]) {
    if (u && !ids.has(u.id)) {
      ids.add(u.id);
      result.push(u);
    }
    if (result.length >= k) break;
  }
  return result;
}
