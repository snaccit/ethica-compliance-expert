"use client";
import { useEffect, useMemo, useState } from "react";
import type { CheckedCitation, TraceEvent } from "@/lib/types";

type MapData = { short: string; title: string; units: { id: string; path: string }[] }[];
let cached: MapData | null = null;

const NAMES: Record<string, string> = { BattVO: "Batterieverordnung", ESPR: "Ökodesign-Verordnung" };

/** Alle Absätze beider Gesetze als Raster. Treffer, gelesene und zitierte Absätze leuchten auf – aus dem echten Ablauf. */
export default function Radar({ events, citations, live }: { events: TraceEvent[]; citations?: CheckedCitation[]; live: boolean }) {
  const [map, setMap] = useState<MapData | null>(cached);

  useEffect(() => {
    if (cached) return;
    fetch("/api/units-map")
      .then((r) => r.json())
      .then((d: MapData) => {
        cached = d;
        setMap(d);
      })
      .catch(() => null);
  }, []);

  const { hit, read, cited } = useMemo(() => {
    const hit = new Set<string>();
    const read = new Set<string>();
    for (const e of events) {
      if (e.kind !== "ergebnis" || !e.refs) continue;
      if (e.tool === "suche_rechtstext") e.refs.forEach((r) => hit.add(r));
      if (e.tool === "lese_einheit") e.refs.forEach((r) => read.add(r));
    }
    const cited = new Set((citations ?? []).filter((c) => c.status === "verifiziert").map((c) => c.unit_id));
    return { hit, read, cited };
  }, [events, citations]);

  const total = map?.reduce((s, m) => s + m.units.length, 0) ?? 0;

  return (
    <div className={`radar card ${live ? "live" : ""}`}>
      <div className="radar-head">
        <span className="label">Gesetzes-Radar</span>
        <span className="radar-stats mono">
          <b>{total}</b> Absätze · <i className="c-hit">{hit.size}</i> gefunden · <i className="c-read">{read.size}</i> gelesen ·{" "}
          <i className="c-cited">{cited.size}</i> zitiert
        </span>
      </div>
      {!map && <div className="muted" style={{ padding: "18px 0" }}>lädt …</div>}
      {map?.map((m) => (
        <div key={m.short} className="radar-block">
          <div className="radar-name">{NAMES[m.short] ?? m.title}</div>
          <div className="radar-grid">
            {live && <div className="sweep" />}
            {m.units.map((u) => {
              const cls = cited.has(u.id) ? "cited" : read.has(u.id) ? "read" : hit.has(u.id) ? "hit" : "";
              return <span key={u.id} className={`cell ${cls}`} title={`${NAMES[m.short] ?? m.short} · ${u.path}`} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
