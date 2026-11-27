"use client";
import { ArrowUp, ExternalLink, RotateCcw, Share2, ShieldCheck, Workflow } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Countdown from "@/components/Countdown";
import PathGraph from "@/components/PathGraph";
import Radar from "@/components/Radar";
import Trace from "@/components/Trace";
import type { AskResult, CheckedCitation, TraceEvent } from "@/lib/types";
import { locateQuote } from "@/lib/verify";
import { clearChat, selectTurn, submitQuestion, useChat } from "@/lib/chatStore";


const EXAMPLES = [
  "Fällt eine Industriebatterie mit genau 2,00 kWh unter die Batteriepass-Pflicht nach Art. 77 Abs. 1?",
  "Ab wann gilt die Batteriepass-Pflicht und für welche Batterien?",
  "Welches Bußgeld droht in Deutschland bei einem fehlenden Batteriepass?",
  "Welche Informationen müssen im Batteriepass stehen?",
  // dazu steht nichts im Gesetz: hier soll ehrlich "keine Quelle" kommen
  "Wie viel kostet die Erstellung eines Batteriepasses pro Batterie?",
  "Welche Software-Anbieter sind für den Batteriepass zugelassen?",
];

const STATUS: Record<AskResult["status"], { label: string; cls: string }> = {
  belegt: { label: "✓ Quelle geprüft", cls: "ok" },
  teilweise_belegt: { label: "teilweise geprüft", cls: "warn" },
  nicht_belegt: { label: "Quelle nicht bestätigt", cls: "bad" },
  keine_quelle: { label: "steht nicht im Gesetz", cls: "info" },
  nur_suche: { label: "nur Suche, ohne Modell", cls: "info" },
};

const CITE: Record<CheckedCitation["status"], { label: string; cls: string }> = {
  verifiziert: { label: "✓ geprüft", cls: "ok" },
  zitat_nicht_gefunden: { label: "✗ nicht im Gesetz gefunden", cls: "bad" },
  unbekannte_fundstelle: { label: "✗ unbekannte Stelle", cls: "bad" },
};

const fmt = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d).toLocaleDateString("de-DE") : d || "—");

function Highlight({ text, quotes }: { text: string; quotes: string[] }) {
  // Alle Zitate aus diesem Absatz markieren, überlappende Stellen zusammenfassen
  const all = quotes.flatMap((q) => (q ? (locateQuote(q, text) ?? []) : [])).sort((a, b) => a[0] - b[0]);
  const ranges: [number, number][] = [];
  for (const [a, b] of all) {
    const last = ranges.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else ranges.push([a, b]);
  }
  if (ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach(([a, b], k) => {
    out.push(text.slice(last, a), <mark key={k}>{text.slice(a, b)}</mark>);
    last = b;
  });
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Mehrere Zitate aus demselben Absatz zu einer Karte zusammenfassen. */
function groupCitations(cites: CheckedCitation[]): (CheckedCitation & { zitate: string[] })[] {
  const out: (CheckedCitation & { zitate: string[] })[] = [];
  for (const c of cites) {
    const same = out.find((x) => x.unit_id === c.unit_id && x.status === c.status);
    if (same) same.zitate.push(c.zitat);
    else out.push({ ...c, zitate: [c.zitat] });
  }
  return out;
}

function Citation({ c, i }: { c: CheckedCitation & { zitate: string[] }; i: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const s = CITE[c.status];
  const node = /^([A-Za-z]+:(?:Art\d+[a-z]?|Anh[IVXLC]+))/.exec(c.unit_id)?.[1];
  return (
    <div className={`card cite ${open ? "open" : ""}`} style={{ animationDelay: `${i * 90}ms` }}>
      <div className="top">
        <span className="id">{c.path ?? c.unit_id}</span>
        {c.zitat ? (
          <span className={`status ${s.cls} snap`} style={{ animationDelay: `${i * 90 + 250}ms` }}>
            {s.label}
          </span>
        ) : (
          <span className="status info">Treffer</span>
        )}
      </div>
      <div className="title">
        {c.source_title ?? "—"}
        {c.heading ? ` · ${c.heading}` : ""}
        {c.korrigiert_von && <span className="mono" style={{ color: "var(--warn)", fontSize: 11 }}> · Absatz automatisch korrigiert</span>}
      </div>
      {c.link && (
        <a className="srclink" href={c.link} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> Im Gesetz öffnen (EUR-Lex)
        </a>
      )}
      {node && (
        <Link className="srclink" href={`/graph?node=${encodeURIComponent(node)}&zitat=${encodeURIComponent(c.path ?? c.unit_id)}`} style={{ marginLeft: 14 }}>
          <Share2 size={12} /> Im Wissensgraph zeigen
        </Link>
      )}
      {c.text ? (
        <div className="body" ref={ref} onClick={() => setOpen(!open)}>
          <Highlight text={c.text} quotes={c.zitate} />
        </div>
      ) : (
        <div className="body">„{c.zitat}“</div>
      )}
    </div>
  );
}

export default function AskPage() {
  const { turns, busy, sel } = useChat();
  const [q, setQ] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const setSel = selectTurn;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function submit(question: string) {
    if (!question.trim() || busy) return;
    setQ("");
    void submitQuestion(question);
  }

  const currentTurn = turns.find((t) => t.id === sel);
  const current = currentTurn?.result;

  return (
    <div className="ask">
      <section className="col">
        <div className="thread">
          {turns.length === 0 && (
            <div className="card hero">
              <div className="label">Compliance Expert · Digitaler Produktpass</div>
              <h2>
                Antworten nur mit <span>geprüfter Quelle</span>.
              </h2>
              <p className="muted" style={{ margin: "0 0 16px" }}>
                Stell eine Frage zum Digitalen Produktpass. Der Agent sucht in der Batterieverordnung und der Ökodesign-Verordnung,
                zitiert wörtlich und prüft jedes Zitat gegen das Gesetz. Steht dazu nichts im Gesetz, sagt er das.
              </p>
              <Countdown />
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} style={{ display: "contents" }}>
              <div className="q">
                {t.question}
              </div>
              {!t.result && (
                <div className="card agentcard">
                  <div className="head">
                    <span className="label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Workflow size={13} /> Agent arbeitet
                    </span>
                    {!t.error && <span className="status info">arbeitet</span>}
                  </div>
                  <Trace events={t.events} live={!t.error} />
                  {t.error && <div className="status bad" style={{ marginTop: 10, whiteSpace: "normal" }}>{t.error}</div>}
                </div>
              )}
              {t.result && <AnswerCard r={t.result} selected={sel === t.id} onSelect={() => setSel(t.id)} />}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="composer">
          <div className="examples-label">Vorschläge</div>
          <div className={`examples ${turns.length > 0 ? "compact" : ""}`}>
            {EXAMPLES.map((e) => (
              <button key={e} className="ex" onClick={() => submit(e)} disabled={busy} title={e}>
                {turns.length > 0 ? (e.length > 52 ? e.slice(0, 50) + "…" : e) : e.length > 70 ? e.slice(0, 68) + "…" : e}
              </button>
            ))}
          </div>
          <form
            className="inputrow"
            onSubmit={(e) => {
              e.preventDefault();
              submit(q);
            }}
          >
            <input className="input" placeholder="Frage zum Batteriepass oder zur Ökodesign-Verordnung …" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn" disabled={busy} aria-label="Fragen">
              <ArrowUp size={17} />
            </button>
            {turns.length > 0 && (
              <button type="button" className="btn ghost reset" disabled={busy} onClick={clearChat} title="Alle Fragen löschen und neu beginnen" aria-label="Zurücksetzen">
                <RotateCcw size={15} /> Zurücksetzen
              </button>
            )}
          </form>
        </div>
      </section>

      <aside className="col">
        <div className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={14} /> Quellen {current ? `· ${groupCitations(current.citations).length}` : ""}
        </div>
        <div className="panel">
          {currentTurn && <Radar events={currentTurn.events} citations={current?.citations} live={!current && !currentTurn.error} />}
          {!currentTurn && <div className="empty">Hier erscheinen die Quellen: der Originaltext aus dem Gesetz, das Zitat ist markiert.</div>}
          {current && current.citations.length === 0 && current.status !== "keine_quelle" && (
            <div className="empty">
              Keine Quelle zitiert.
              <br />
              Durchsucht: {current.retrieved.slice(0, 6).map((r) => r.id).join(", ") || "—"}
            </div>
          )}
          {current && groupCitations(current.citations).map((c, i) => <Citation key={`${current.question}-${i}`} c={c} i={i} />)}
        </div>
      </aside>
    </div>
  );
}

function AnswerCard({ r, selected, onSelect }: { r: AskResult; selected: boolean; onSelect: () => void }) {
  const s = STATUS[r.status];
  return (
    <div className={`card a ${selected ? "sel" : ""}`} onClick={onSelect}>
      <div className="head">
        <span className="label">Antwort</span>
        <span className={`status ${s.cls} snap`}>{s.label}</span>
      </div>
      {r.answer ? (
        <>
          <p className="answer">{r.answer.antwort}</p>
          {r.answer.begruendung && <p className="why">{r.answer.begruendung}</p>}
          {r.answer.luecken.length > 0 && (
            <ul className="gaps">
              {r.answer.luecken.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="why">Kein Sprachmodell erreichbar, deshalb nur die Suche. Rechts stehen die besten Treffer aus den Gesetzen. Mit laufendem Ollama gibt es eine richtige Antwort.</p>
      )}
      <div className="meta">
        <span className="chip">{r.rechtsstand}</span>
        <span className="chip">{r.cached ? "sofort (schon beantwortet)" : `${(r.ms / 1000).toFixed(0)} s`}</span>
      </div>
      <PathGraph r={r} />
    </div>
  );
}

