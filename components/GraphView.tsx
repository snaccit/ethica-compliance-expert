"use client";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "@/lib/graph";

type Data = { law: string; title: string; url: string; nodes: GraphNode[]; edges: GraphEdge[] };
type P = { x: number; y: number; vx: number; vy: number };

const LAWS = [
  { short: "BattVO", name: "Batterieverordnung" },
  { short: "ESPR", name: "Ökodesign-Verordnung" },
];
const W = 900, H = 620;

/** Kraft-Layout (Fruchterman-Reingold): Knoten stoßen sich ab, Verweise ziehen an. Keine externe Bibliothek. */
function simulate(nodes: GraphNode[], edges: GraphEdge[], pos: Map<string, P>, temp: number) {
  const arr = nodes.map((n) => pos.get(n.id)!);
  const k = Math.sqrt((W * H) / nodes.length) * 0.45;
  for (const p of arr) { p.vx = 0; p.vy = 0; }
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (k * k) / d / d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
  }
  for (const e of edges) {
    const a = pos.get(e.from)!, b = pos.get(e.to)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const f = (d / k) * (0.6 + 0.2 * Math.min(3, e.weight));
    a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
  }
  for (const p of arr) {
    p.vx += (W / 2 - p.x) * 0.8;
    p.vy += (H / 2 - p.y) * 1.2;
    const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
    const step = Math.min(len, temp);
    p.x = Math.max(24, Math.min(W - 24, p.x + (p.vx / len) * step));
    p.y = Math.max(24, Math.min(H - 24, p.y + (p.vy / len) * step));
  }
}

export default function GraphView({ node: want, zitat }: { node: string | null; zitat: string | null }) {
  const [law, setLaw] = useState(() => want?.split(":")[0] ?? "BattVO");
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [settling, setSettling] = useState(true); // während sich der Graph anordnet: kein Hover
  const [, setTick] = useState(0);
  const pos = useRef(new Map<string, P>());

  useEffect(() => {
    let raf = 0;
    let cancelled = false; // schneller Tab-Wechsel: alte Antwort verwerfen
    setData(null);
    setHover(null);
    setSettling(true);
    fetch(`/api/graph?law=${law}`)
      .then((r) => r.json())
      .then((d: Data) => {
        if (cancelled) return;
        const m = new Map<string, P>();
        d.nodes.forEach((n, i) => {
          const a = (i / d.nodes.length) * Math.PI * 2;
          m.set(n.id, { x: W / 2 + Math.cos(a) * 240, y: H / 2 + Math.sin(a) * 200, vx: 0, vy: 0 });
        });
        pos.current = m;
        setData(d);
        // Nur vorauswählen, wenn man aus einer Antwort kommt ("Im Wissensgraph zeigen")
        setSel(d.nodes.some((n) => n.id === want) ? want : null);
        let temp = 40;
        const step = () => {
          for (let k = 0; k < 3; k++) { simulate(d.nodes, d.edges, m, temp); temp *= 0.985; }
          setTick((t) => t + 1);
          if (cancelled) return;
          if (temp > 0.4) raf = requestAnimationFrame(step);
          else setSettling(false);
        };
        raf = requestAnimationFrame(step);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [law, want]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSel(null); setHover(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focus = hover ?? sel;
  const neighbors = useMemo(() => {
    const set = new Set<string>();
    for (const e of data?.edges ?? []) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [data, focus]);
  const { outs, ins } = useMemo(() => {
    const outs: string[] = [], ins: string[] = [];
    for (const e of data?.edges ?? []) {
      if (e.from === sel) outs.push(e.to);
      if (e.to === sel) ins.push(e.from);
    }
    return { outs, ins };
  }, [data, sel]);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const top = useMemo(() => [...(data?.nodes ?? [])].sort((a, b) => b.inDeg - a.inDeg).slice(0, 3), [data]);
  const selNode = sel ? byId.get(sel) : null;
  const box = (() => {
    const ps = [...pos.current.values()];
    if (!ps.length) return `0 0 ${W} ${H}`;
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y), pad = 34;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    let w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
    const ar = W / H;
    if (w / h < ar) { const nw = h * ar; return `${x0 - (nw - w) / 2} ${y0} ${nw} ${h}`; }
    const nh = w / ar; return `${x0} ${y0 - (nh - h) / 2} ${w} ${nh}`;
  })();
  const r = (n: GraphNode) => 4 + Math.sqrt(n.inDeg) * 2.6;
  const anchor = (id: string) => {
    const a = /:Art(\d+)/.exec(id);
    if (a) return `#art_${a[1]}`;
    const x = /:Anh([IVXLC]+)/.exec(id);
    return x ? `#anx_${x[1]}` : "";
  };

  return (
    <div className="graphpage">
      <div className="g-top">
        <div className="tabs">
          {LAWS.map((l) => (
            <button key={l.short} className={`tab ${law === l.short ? "on" : ""}`} onClick={() => setLaw(l.short)}>
              {l.name}
            </button>
          ))}
        </div>
        <div className="g-tiles">
          <div className="tile"><b>{data?.nodes.length ?? "–"}</b><span>Artikel &amp; Anhänge</span></div>
          <div className="tile"><b>{data?.edges.length ?? "–"}</b><span>Verweise</span></div>
          <div className="tile wide">
            <span>Am häufigsten verwiesen</span>
            <div className="toplist">
              {top.map((n) => (
                <button key={n.id} onClick={() => setSel(n.id)}>{n.label} <i>{n.inDeg}×</i></button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="g-main">
        <div className="card g-canvas">
          {!data && <div className="empty" style={{ height: 520 }}>Baue Graph aus dem Gesetzestext …</div>}
          {data && (
            <svg viewBox={box} width="100%" onClick={() => setSel(null)} onMouseLeave={() => setHover(null)}>
              <defs>
                <radialGradient id="g-art"><stop offset="0" stopColor="#b9a6ff" /><stop offset="1" stopColor="#6d5dfc" /></radialGradient>
                <radialGradient id="g-anx"><stop offset="0" stopColor="#9ff3ff" /><stop offset="1" stopColor="#0ea5c6" /></radialGradient>
              </defs>
              <defs>
                <marker id="ar-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#a78bfa" />
                </marker>
                <marker id="ar-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#22d3ee" />
                </marker>
              </defs>
              {/* Alle Linien leise im Hintergrund */}
              {data.edges.map((e, i) => {
                const a = pos.current.get(e.from)!, b = pos.current.get(e.to)!;
                const on = focus && (e.from === focus || e.to === focus);
                if (on) return null;
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`g-edge ${focus ? "dim" : ""}`} />;
              })}
              {/* Linien des ausgewählten Punkts: mit Pfeil vom nennenden zum genannten Punkt */}
              {focus && data.edges.map((e, i) => {
                if (e.from !== focus && e.to !== focus) return null;
                const a = pos.current.get(e.from)!, b = pos.current.get(e.to)!;
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
                const ux = dx / d, uy = dy / d;
                // nennen sich beide gegenseitig: Linien leicht versetzen, damit beide Pfeile sichtbar sind
                const both = data.edges.some((x) => x.from === e.to && x.to === e.from);
                const off = both ? 3.5 : 0;
                const ox = -uy * off, oy = ux * off;
                const ra = r(byId.get(e.from)!) + 2, rb = r(byId.get(e.to)!) + 3;
                const out = e.from === focus;
                return (
                  <line key={`f${i}`} className={`g-edge on ${out ? "out" : ""}`}
                    x1={a.x + ux * ra + ox} y1={a.y + uy * ra + oy} x2={b.x - ux * rb + ox} y2={b.y - uy * rb + oy}
                    markerEnd={`url(#${out ? "ar-out" : "ar-in"})`} />
                );
              })}
              {[...data.nodes]
                // gewählter Punkt zuletzt, damit er oben liegt
                .sort((a, b) => (a.id === focus ? 2 : neighbors.has(a.id) ? 1 : 0) - (b.id === focus ? 2 : neighbors.has(b.id) ? 1 : 0))
                .map((n) => {
                const p = pos.current.get(n.id)!;
                const isFocus = n.id === focus, isN = neighbors.has(n.id);
                // Mit Auswahl: nur gewählter Punkt und Nachbarn beschriftet. Ohne Auswahl: die großen Punkte.
                const showLabel = focus ? isFocus || isN : n.inDeg >= 9;
                return (
                  <g key={n.id} className={`g-node ${n.kind} ${isFocus ? "focus" : ""} ${focus && !isFocus && !isN ? "dim" : ""}`}
                    transform={`translate(${p.x},${p.y})`}
                    onMouseEnter={() => !settling && setHover(n.id)} onMouseLeave={() => setHover(null)}
                    onClick={(ev) => { ev.stopPropagation(); setSel(n.id); }}>
                    <circle r={r(n)} fill={`url(#g-${n.kind})`} />
                    {showLabel && <text y={-r(n) - 5} textAnchor="middle">{n.label}</text>}
                  </g>
                );
              })}
            </svg>
          )}
          <div className="g-legend">
            <span><i className="dot-art" /> Artikel</span>
            <span><i className="dot-anx" /> Anhang</span>
            <span>Punkt größer = wird öfter genannt</span>
            <span><i className="ln-out" />→ violett: der gewählte Punkt nennt den anderen</span>
            <span><i className="ln-in" />→ türkis: der andere nennt den gewählten Punkt</span>
          </div>
        </div>

        <aside className="card g-side">
          {!selNode && (
            <div className="muted" style={{ lineHeight: 1.6 }}>
              Klick auf einen Punkt, um seine Verweise zu sehen.<br />
              Oder oben einen der meistgenannten Artikel wählen.<br />
              Esc oder Klick ins Leere hebt die Auswahl auf.
            </div>
          )}
          {selNode && data && (
            <>
              {zitat && selNode.id === want && (
                <div className="g-from">
                  <div>In deiner Antwort zitiert: <b>{zitat}</b></div>
                  <Link href="/" className="srclink"><ArrowLeft size={12} /> Zurück zur Antwort</Link>
                </div>
              )}
              <div className="label">{selNode.kind === "art" ? "Artikel" : "Anhang"}</div>
              <h3 className="g-title">{selNode.label}</h3>
              <div className="muted" style={{ marginBottom: 10 }}>{selNode.heading}</div>
              <a className="srclink" href={`${data.url}${anchor(selNode.id)}`} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Im Gesetz öffnen (EUR-Lex)
              </a>
              <div className="g-sec"><span className="ln-out sw" /> {selNode.label} nennt diese Stellen <b>{outs.length}</b></div>
              <div className="g-chips">
                {outs.map((id) => <button key={id} onClick={() => setSel(id)}>{byId.get(id)?.label}</button>)}
              </div>
              <div className="g-sec"><span className="ln-in sw" /> Diese Stellen nennen {selNode.label} <b>{ins.length}</b></div>
              <div className="g-chips">
                {ins.map((id) => <button key={id} onClick={() => setSel(id)}>{byId.get(id)?.label}</button>)}
              </div>
            </>
          )}
        </aside>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Jeder Punkt ist ein Artikel oder Anhang. Eine Linie heißt: Im Text des einen Artikels wird der andere genannt, z. B. steht in Art. 77 „… die Informationen nach Anhang XIII“. Der Pfeil zeigt vom nennenden zum genannten Punkt. Die Linien sind keine weiteren Quellen deiner Antwort. Automatisch aus dem Gesetzestext erzeugt, Verweise auf andere Gesetze sind herausgefiltert.
      </p>
    </div>
  );
}
