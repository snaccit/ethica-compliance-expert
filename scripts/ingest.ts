/**
 * Lädt die Gesetze aus data/sources.yaml neu, zerlegt sie in Absätze und meldet Änderungen.
 *
 *   npm run ingest               Batterieverordnung + Ökodesign-Verordnung
 *   npm run ingest -- --all      alle Einträge aus sources.yaml (die übrigen sind noch nicht getestet)
 *   npm run ingest -- --offline  nur die gespeicherten Dateien aus data/raw/ neu zerlegen
 *
 * Dasselbe macht der Knopf "Gesetze aktualisieren" in der App.
 */
import { loadEnv } from "../lib/env";
import { refreshSources } from "../lib/ingest";

loadEnv();
const results = await refreshSources({
  all: process.argv.includes("--all"),
  offline: process.argv.includes("--offline"),
  log: (s) => process.stdout.write(s),
});
console.log("");
for (const r of results) console.log(`${r.short}: ${r.status} – ${r.message}`);
