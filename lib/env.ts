// Lädt .env.local auch für Skripte außerhalb von Next.js (ingest, eval).
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* Datei fehlt – ok */
    }
  }
}
