"use client";
import type { AskResult } from "@/lib/types";

const NAMES: Record<string, string> = { BattVO: "Batterieverordnung", ESPR: "Ökodesign-Verordnung" };

/** Wissenspfad: Frage → Gesetz → Artikel → Absatz, aus den geprüften Quellen der Antwort. */
export default function PathGraph({ r }: { r: AskResult }) {
  const cites = r.citations.filter((c) => c.zitat);
  if (cites.length === 0) return null;

  // Knoten je Spalte, ohne Doppelte
  const laws = [...new Set(cites.map((c) => c.unit_id.split(":")[0]))];
  const arts = [...new Set(cites.map((c) => c.unit_id.replace(/\(.*|#.*|~.*/, "")))];
  const paras = [...new Map(cites.map((c) => [c.unit_id, c])).values()];

  const W = 640, colX = [10, 170, 330, 490], nodeW = 140, nodeH = 34;
  const rows = Math.max(laws.length, arts.length, paras.length);
  const H = Math.max(70, rows * 46 + 14);
  const y = (i: number, n: number) => (H - n * 46) / 2 + i * 46 + 6;

  const artLabel = (a: string) => {
    const m = /:Art(\d+)/.exec(a) ?? /:Anh([IVXLC]+)/.exec(a);
    return a.includes(":Anh") ? `Anhang ${m?.[1]}` : `Artikel ${m?.[1]}`;
  };
  const paraLabel = (id: string, path?: string) => (path ? path.replace(/^Art\. \d+[a-z]? /, "").replace(/^Anhang [IVXLC]+ /, "") || path : id);

  const edges: { x1: number; y1: number; x2: number; y2: number; ok: boolean }[] = [];
  const qY = H / 2 - nodeH / 2;
  laws.forEach((l, i) => edges.push({ x1: colX[0] + nodeW, y1: qY + nodeH / 2, x2: colX[1], y2: y(i, laws.length) + nodeH / 2, ok: true }));
  arts.forEach((a, i) => {
    const li = laws.indexOf(a.split(":")[0]);
    edges.push({ x1: colX[1] + nodeW, y1: y(li, laws.length) + nodeH / 2, x2: colX[2], y2: y(i, arts.length) + nodeH / 2, ok: true });
  });
  paras.forEach((p, i) => {
    const ai = arts.indexOf(p.unit_id.replace(/\(.*|#.*|~.*/, ""));
    edges.push({ x1: colX[2] + nodeW, y1: y(ai, arts.length) + nodeH / 2, x2: colX[3], y2: y(i, paras.length) + nodeH / 2, ok: p.status === "verifiziert" });
  });

  return (
    <div className="pathgraph">
      <div className="label" style={{ marginBottom: 6 }}>Wissenspfad</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <defs>
          <linearGradient id="pg-e" x1="0" x2="1">
            <stop offset="0" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        {edges.map((e, i) => {
          const mx = (e.x1 + e.x2) / 2;
          return (
            <path
              key={i}
              className="pg-edge"
              style={{ animationDelay: `${i * 120}ms` }}
              d={`M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`}
              stroke={e.ok ? "url(#pg-e)" : "#f87171"}
            />
          );
        })}
        <Node x={colX[0]} y={qY} w={nodeW} h={nodeH} label="Deine Frage" kind="q" delay={0} />
        {laws.map((l, i) => (
          <Node key={l} x={colX[1]} y={y(i, laws.length)} w={nodeW} h={nodeH} label={NAMES[l] ?? l} kind="law" delay={150} />
        ))}
        {arts.map((a, i) => (
          <Node key={a} x={colX[2]} y={y(i, arts.length)} w={nodeW} h={nodeH} label={artLabel(a)} kind="art" delay={300} />
        ))}
        {paras.map((p, i) => (
          <Node
            key={p.unit_id}
            x={colX[3]}
            y={y(i, paras.length)}
            w={nodeW}
            h={nodeH}
            label={`${paraLabel(p.unit_id, p.path)}  ${p.status === "verifiziert" ? "✓" : "✗"}`}
            kind={p.status === "verifiziert" ? "ok" : "bad"}
            delay={450}
          />
        ))}
      </svg>
    </div>
  );
}

function Node({ x, y, w, h, label, kind, delay }: { x: number; y: number; w: number; h: number; label: string; kind: string; delay: number }) {
  return (
    <g className={`pg-node ${kind}`} style={{ animationDelay: `${delay}ms` }}>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle">
        {label.length > 22 ? label.slice(0, 21) + "…" : label}
      </text>
    </g>
  );
}
