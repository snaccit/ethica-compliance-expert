"use client";
import { BookOpen, Brain, CheckCircle2, Flag, Play, Search, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import type { TraceEvent } from "@/lib/types";

function Icon({ e }: { e: TraceEvent }) {
  const p = { size: 14, strokeWidth: 2 };
  if (e.kind === "start") return <Play {...p} />;
  if (e.kind === "denken") return <Brain {...p} />;
  if (e.kind === "fertig") return <Flag {...p} />;
  if (e.kind === "pruefung" || (e.kind === "ergebnis" && e.tool === "pruefe_zitat"))
    return e.ok ? <CheckCircle2 {...p} /> : <XCircle {...p} />;
  if (e.tool === "suche_rechtstext") return <Search {...p} />;
  if (e.tool === "lese_einheit") return <BookOpen {...p} />;
  if (e.tool === "pruefe_zitat") return <ShieldCheck {...p} />;
  return <Sparkles {...p} />;
}

function tone(e: TraceEvent) {
  if (e.ok === false) return "bad";
  if (e.kind === "pruefung" || e.ok === true) return "ok";
  if (e.kind === "tool") return "tool";
  if (e.kind === "ergebnis") return "res";
  return "muted";
}

export default function Trace({ events, live }: { events: TraceEvent[]; live: boolean }) {
  return (
    <ol className="trace">
      {events.map((e, i) => (
        <li key={i} className={`step ${tone(e)} ${e.kind === "ergebnis" ? "sub" : ""}`} style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
          <span className="node">
            <Icon e={e} />
          </span>
          <div className="body">
            <div className="row">
              <span className="title">{e.title}</span>
              <span className="time">+{(e.t / 1000).toFixed(1)}s</span>
            </div>
            {e.detail && <div className={e.kind === "denken" ? "thought" : "detail"}>{e.detail}</div>}
            {e.refs && e.refs.length > 0 && e.kind === "ergebnis" && e.tool !== "pruefe_zitat" && (
              <div className="refs">
                {e.refs.slice(0, 8).map((r) => (
                  <span key={r} className="ref">{r}</span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
      {live && (
        <li className="step live">
          <span className="node pulse" />
          <div className="body">
            <span className="title muted">arbeitet …</span>
          </div>
        </li>
      )}
    </ol>
  );
}
