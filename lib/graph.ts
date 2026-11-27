/**
 * Verweis-Graph: Artikel und Anhänge als Knoten, Verweise im Gesetzestext als Kanten.
 * Wird automatisch aus den zerlegten Absätzen gebaut (keine manuelle Pflege).
 */
import type { Unit } from "./types";

export type GraphNode = {
  id: string; // z. B. "BattVO:Art77" oder "BattVO:AnhXIII"
  label: string; // "Art. 77" / "Anhang XIII"
  heading: string;
  kind: "art" | "anx";
  inDeg: number;
  outDeg: number;
};
export type GraphEdge = { from: string; to: string; weight: number };
export type LawGraph = { law: string; nodes: GraphNode[]; edges: GraphEdge[] };

const nodeOf = (unitId: string) => unitId.replace(/[(#~].*$/, "");

// Verweise auf andere Rechtsakte erkennen und ignorieren
const EXTERNAL = /^\s*(?:[^.;]{0,40}?)(der|des)\s+(Richtlinie|Verordnung|Beschlusses|Vertrags|Durchführungs|delegierten)/;

function parseNumberList(seg: string): string[] {
  // "13 Absatz 6", "7, 8 und 9", "5 bis 10"
  const out: string[] = [];
  const range = /^(\d+[a-z]?)\s+bis\s+(\d+[a-z]?)/.exec(seg);
  if (range) {
    const a = parseInt(range[1]), b = parseInt(range[2]);
    if (b > a && b - a < 30) for (let i = a; i <= b; i++) out.push(String(i));
    return out;
  }
  for (const m of seg.matchAll(/(?:^|,\s*|\s+(?:und|oder|sowie)\s+)(\d+[a-z]?)/g)) out.push(m[1]);
  return out;
}

export function buildGraph(units: Unit[], law: string): LawGraph {
  const own = units.filter((u) => u.source === law);
  const nodes = new Map<string, GraphNode>();
  for (const u of own) {
    const id = nodeOf(u.id);
    if (!nodes.has(id)) {
      const isAnx = id.includes(":Anh");
      nodes.set(id, {
        id,
        label: isAnx ? `Anhang ${id.split(":Anh")[1]}` : `Art. ${id.split(":Art")[1]}`,
        heading: u.heading,
        kind: isAnx ? "anx" : "art",
        inDeg: 0,
        outDeg: 0,
      });
    }
  }

  const weights = new Map<string, number>();
  const add = (from: string, to: string) => {
    if (from === to || !nodes.has(to)) return;
    const k = `${from}→${to}`;
    weights.set(k, (weights.get(k) ?? 0) + 1);
  };

  for (const u of own) {
    const from = nodeOf(u.id);
    const text = u.text.replace(/\s+/g, " ");
    for (const m of text.matchAll(/Artikeln?\s+((?:\d+[a-z]?)(?:\s*(?:,|und|oder|sowie|bis)\s*\d+[a-z]?)*)/g)) {
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80);
      if (EXTERNAL.test(after)) continue;
      for (const n of parseNumberList(m[1])) add(from, `${law}:Art${n}`);
    }
    for (const m of text.matchAll(/Anh(?:ang|änge|ängen)\s+([IVXLC]+)\b/g)) {
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80);
      if (EXTERNAL.test(after)) continue;
      add(from, `${law}:Anh${m[1]}`);
    }
  }

  const edges: GraphEdge[] = [];
  for (const [k, w] of weights) {
    const [from, to] = k.split("→");
    edges.push({ from, to, weight: w });
    nodes.get(from)!.outDeg++;
    nodes.get(to)!.inDeg++;
  }
  return { law, nodes: [...nodes.values()], edges };
}
