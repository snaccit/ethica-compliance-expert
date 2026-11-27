import RefreshButton from "@/components/RefreshButton";
import { readRegistry } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function SourcesPage() {
  const all = readRegistry();
  const loaded = all.filter((r) => r.status === "geladen");
  const planned = all.filter((r) => r.status !== "geladen");
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "18px 20px 6px" }}>
          <div className="label">Gesetze, die der Agent kennt</div>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            Offiziell von EUR-Lex geladen und in Absätze aufgeteilt. Der Agent antwortet nur aus diesen Texten.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Gesetz</th>
              <th>Abgerufen</th>
              <th>Absätze</th>
            </tr>
          </thead>
          <tbody>
            {loaded.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Noch nichts geladen. Im Terminal <span className="mono">npm run ingest</span> ausführen.
                </td>
              </tr>
            )}
            {loaded.map((r) => (
              <tr key={r.short}>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                  <div className="muted" style={{ fontSize: 11.5 }}>offizielle Fassung bei EUR-Lex öffnen</div>
                </td>
                <td className="mono">{r.fetched_at ? new Date(r.fetched_at).toLocaleDateString("de-DE") : "—"}</td>
                <td className="mono">{r.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="label">Aktuell halten</div>
        <p className="muted" style={{ margin: "6px 0 14px" }}>
          Lädt beide Gesetze neu über die offizielle Schnittstelle des EU-Amtsblatts und prüft, ob sich etwas geändert hat. Dauert etwa 10 bis 30 Sekunden.
        </p>
        <RefreshButton />
        {planned.length > 0 && (
          <p className="muted" style={{ margin: "14px 0 0", fontSize: 12.5 }}>
            Geplant: weitere Gesetze ({planned.map((r) => r.short).join(", ")}) und eine automatische Prüfung einmal pro Woche.
          </p>
        )}
      </div>
    </div>
  );
}
