// Gesetze laden, zerlegen, Änderungen erkennen. Für `npm run ingest` und den Knopf in der App.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEurLex } from "./parse";
import { rawPath, readRegistry, readSources, readUnits, writeRegistry, writeUnits } from "./store";
import type { RegistryEntry, Unit } from "./types";

export type RefreshResult = {
  short: string;
  title: string;
  status: "unverändert" | "geändert" | "neu" | "fehler";
  units: number;
  message: string;
};

// Cellar-Schnittstelle des Amtsblatts. Die EUR-Lex-Webseite blockt automatische Abrufe oft.
async function fetchCellar(celex: string): Promise<string> {
  const res = await fetch(`https://publications.europa.eu/resource/celex/${encodeURIComponent(celex)}`, {
    headers: { Accept: "application/xhtml+xml, text/html;q=0.9", "Accept-Language": "deu" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`EU-Schnittstelle antwortet mit Fehler ${res.status}`);
  const html = await res.text();
  if (!/Artikel\s+1/.test(html)) throw new Error("EU-Schnittstelle lieferte keine deutsche Fassung");
  return html;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ethica-compliance-expert (+https://github.com/snaccit/ethica-compliance-expert)", "Accept-Language": "de-DE,de;q=0.9" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`EUR-Lex antwortet mit Fehler ${res.status}`);
  const html = await res.text();
  if (res.status === 202 || !/Artikel\s+1/.test(html)) throw new Error("EUR-Lex hat statt des Gesetzes eine Schutzseite geschickt");
  return html;
}

export async function refreshSources(opts: { all?: boolean; offline?: boolean; log?: (s: string) => void } = {}): Promise<RefreshResult[]> {
  const log = opts.log ?? (() => {});
  const sources = readSources().filter((s) => opts.all || s.phase <= 1);
  const registry = new Map(readRegistry().map((r) => [r.short, r]));
  let units: Unit[] = readUnits();
  const results: RefreshResult[] = [];

  for (const s of sources) {
    const file = rawPath(s.short);
    const prev = registry.get(s.short);
    let html: string | null = null;
    let fromCache = false;
    let fetchError: string | undefined;
    let origin: NonNullable<RegistryEntry["origin"]> = "eu-api";

    try {
      if (opts.offline) throw new Error("offline");
      log(`↓ ${s.short} über EU-Schnittstelle … `);
      try {
        html = await fetchCellar(s.celex);
      } catch (e) {
        log(`(${(e as Error).message}) → EUR-Lex-Webseite … `);
        origin = "eur-lex";
        html = await fetchHtml(s.url);
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, html);
      log("ok\n");
    } catch (e) {
      fetchError = (e as Error).message;
      if (opts.offline) origin = prev?.origin ?? "lokale Datei";
      if (fs.existsSync(file)) {
        html = fs.readFileSync(file, "utf8");
        fromCache = true;
        log(`→ nutze lokale Datei (${fetchError})\n`);
      } else log(`✗ ${fetchError}\n`);
    }

    if (!html) {
      registry.set(s.short, { ...s, fetched_at: null, sha256: null, units: 0, status: "fehler", error: fetchError });
      results.push({ short: s.short, title: s.title, status: "fehler", units: 0, message: `Abruf fehlgeschlagen: ${fetchError}` });
      continue;
    }

    const parsed = parseEurLex(html, s.short);
    // Fingerabdruck nur über den Gesetzestext: Die EUR-Lex-Seite enthält wechselnde Teile (Sitzung, Zeitstempel)
    const sha256 = crypto
      .createHash("sha256")
      .update(parsed.map((u) => `${u.id}\n${u.text.replace(/\s+/g, " ").trim()}`).join("\n\n"))
      .digest("hex");
    const fetched_at = fromCache ? (prev?.fetched_at ?? fs.statSync(file).mtime.toISOString()) : new Date().toISOString();
    registry.set(s.short, {
      ...s,
      fetched_at,
      sha256,
      units: parsed.length,
      status: parsed.length > 0 ? "geladen" : "fehler",
      origin: fromCache && !opts.offline ? (prev?.origin ?? "lokale Datei") : origin,
      hash_basis: "text",
      error: parsed.length > 0 ? undefined : "Keine Rechtseinheiten erkannt – Parser prüfen",
    });
    units = [...units.filter((u) => u.source !== s.short), ...parsed];

    let status: RefreshResult["status"];
    let message: string;
    if (fromCache && !opts.offline) {
      status = "fehler";
      message = `Nicht aktualisiert: ${fetchError ?? "EUR-Lex nicht erreichbar"}. Die gespeicherte Fassung bleibt aktiv.`;
    } else if (prev?.sha256 && prev.hash_basis !== "text") {
      status = "unverändert";
      message = `Abgleich eingerichtet (${parsed.length} Absätze). Ab jetzt werden echte Änderungen gemeldet.`;
    } else if (!prev?.sha256) {
      status = "neu";
      message = `Neu geladen: ${parsed.length} Absätze.`;
    } else if (prev.sha256 !== sha256 && prev.origin !== origin) {
      // andere Quelle, leicht anderes HTML: keine echte Änderung
      status = "neu";
      message = `Jetzt über ${origin === "eu-api" ? "die offizielle EU-Schnittstelle" : "die EUR-Lex-Webseite"} geladen (${parsed.length} Absätze). Ab jetzt werden Änderungen gemeldet.`;
    } else if (prev.sha256 !== sha256) {
      status = "geändert";
      message = `Der Gesetzestext hat sich geändert. Neu geladen (${parsed.length} Absätze), Antworten beziehen sich ab jetzt auf den neuen Stand.`;
    } else {
      status = "unverändert";
      message = "Keine Änderung. Die Antworten sind auf dem aktuellen Stand.";
    }
    log(`  ${parsed.length} Absätze · ${status}\n`);
    results.push({ short: s.short, title: s.title, status, units: parsed.length, message });
  }

  for (const s of readSources()) if (!registry.has(s.short)) registry.set(s.short, { ...s, fetched_at: null, sha256: null, units: 0, status: "offen" } as RegistryEntry);
  writeUnits(units);
  writeRegistry([...registry.values()]);
  return results;
}
