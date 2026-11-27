import { getProvider, providerLabel, providerReachable } from "@/lib/llm";
import { readRegistry, readUnits } from "@/lib/store";

export default async function TopBar() {
  const provider = getProvider();
  const online = await providerReachable(provider);
  const loaded = readRegistry().filter((r) => r.status === "geladen");
  const units = readUnits().length;
  const latest = loaded.map((r) => r.fetched_at).filter(Boolean).sort().at(-1);
  return (
    <header className="topbar">
      <div>
        <h1 className="brandname">
          Compliance <span>Expert</span>
        </h1>
        <div className="tagline">DPP-Fragen mit geprüfter Quelle</div>
      </div>
      <div className="chips">
        <span className="chip">
          <span className={`dot ${online && units ? "" : "warn"}`} />
          {online ? providerLabel(provider) : `${providerLabel(provider)} · nicht erreichbar, nur Suche`}
        </span>
        <span className="chip">
          {loaded.length === 2 ? "Batterieverordnung + Ökodesign-Verordnung" : `${loaded.length} Gesetze`} · Stand {latest ? new Date(latest).toLocaleDateString("de-DE") : "—"}
        </span>
      </div>
    </header>
  );
}
