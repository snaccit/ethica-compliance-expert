import crypto from "node:crypto";
import { AGENT_PROMPT, runAgent } from "./agent";
import { getProvider, isConnectionError, providerReachable } from "./llm";
import { getIndex, search } from "./search";
import { logAnswer, readCache, readRegistry, writeCache } from "./store";
import type { AskResult, TraceEvent } from "./types";
import { checkCitations, linkFor } from "./verify";
import { withTextFragment } from "./jumplink";

export function rechtsstand(): string {
  const dates = readRegistry()
    .filter((r) => r.status === "geladen" && r.fetched_at)
    .map((r) => r.fetched_at as string)
    .sort();
  if (dates.length === 0) return "keine Gesetze geladen";
  return `Gesetzesstand ${new Date(dates[0]).toLocaleDateString("de-DE")}`;
}

// Agent antwortet, danach wird jedes Zitat gegen den Originaltext geprüft.
// Ohne erreichbares Modell gibt es nur die Suchtreffer.
export type Channel = "web" | "api" | "eval";

export async function ask(
  question: string,
  date?: string,
  onEvent?: (e: TraceEvent) => void,
  channel: Channel = "web",
  opts: { noCache?: boolean } = {},
): Promise<AskResult> {
  const t0 = Date.now();
  const day = date || new Date().toISOString().slice(0, 10);
  const registry = readRegistry();
  const title = (s: string) => registry.find((r) => r.short === s)?.title ?? s;
  const url = (s: string) => registry.find((r) => r.short === s)?.url;
  const provider = getProvider();
  const trace: TraceEvent[] = [];
  const emit = (e: TraceEvent) => {
    trace.push(e);
    onEvent?.(e);
  };

  // Zwischenspeicher: gleiche Frage, gleicher Stichtag, gleiches Modell, gleicher Gesetzesstand -> alte Antwort
  const cacheKey = crypto
    .createHash("sha1")
    .update([question.trim().toLowerCase().replace(/\s+/g, " "), date ?? "", `${provider.name}/${provider.model}`, crypto.createHash("sha1").update(AGENT_PROMPT).digest("hex").slice(0, 8), ...registry.map((r) => r.sha256 ?? "")].join("|"))
    .digest("hex");
  if (!opts.noCache) {
    const hit = readCache()[cacheKey];
    if (hit) {
      const e: TraceEvent = { t: 0, kind: "fertig", title: "Schon einmal beantwortet (Zwischenspeicher)", detail: `ursprünglich am ${new Date(hit.at).toLocaleString("de-DE")}` };
      onEvent?.(e);
      const r: AskResult = { ...hit.result, cached: true, ms: Date.now() - t0, trace: [...hit.result.trace, e] };
      logAnswer({ at: new Date().toISOString(), channel, ...r, trace: undefined, citations: r.citations.map(({ text: _t, ...c }) => c) });
      return r;
    }
  }

  const searchOnly = (note: string): AskResult => {
    const units = search(question, 6);
    emit({ t: Date.now() - t0, kind: "tool", tool: "suche_rechtstext", title: "Sucht in den Gesetzestexten", detail: question });
    emit({ t: Date.now() - t0, kind: "ergebnis", tool: "suche_rechtstext", title: `${units.length} Treffer · ${note}`, refs: units.map((u) => u.id) });
    return {
      mode: "suche",
      question,
      date: day,
      model: null,
      status: "nur_suche",
      answer: null,
      citations: units.map((u) => ({
        unit_id: u.id,
        zitat: "",
        status: "verifiziert",
        path: u.path,
        heading: u.heading,
        source_title: title(u.source),
        text: u.text.replace(/\s+/g, " "),
        link: linkFor(u, url),
      })),
      retrieved: units.map((u) => ({ id: u.id, path: u.path, heading: u.heading })),
      rechtsstand: rechtsstand(),
      ms: Date.now() - t0,
      trace,
      steps: 1,
    };
  };
  const OFFLINE = "kein Sprachmodell erreichbar, nur Suche";

  let result: AskResult;
  let agent: Awaited<ReturnType<typeof runAgent>> | null = null;
  if (await providerReachable(provider)) {
    try {
      agent = await runAgent(provider, question, day, emit);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
    }
  }
  if (!agent) {
    result = searchOnly(OFFLINE);
  } else {
    const { answer: raw, steps, read, usage } = agent;
    const a = {
      antwort: raw.antwort ?? "",
      begruendung: raw.begruendung ?? "",
      fundstellen: Array.isArray(raw.fundstellen) ? raw.fundstellen : [],
      stichtag: raw.stichtag ?? null,
      sicherheit: raw.sicherheit ?? "niedrig",
      luecken: Array.isArray(raw.luecken) ? raw.luecken : [],
      keine_quelle: Boolean(raw.keine_quelle),
    };
    // Jedes Zitat im Originaltext suchen, unabhängig vom Modell
    const citations = checkCitations(a.fundstellen, getIndex().byId, title, url).map((c) =>
      c.link && c.status === "verifiziert" ? { ...c, link: withTextFragment(c.link, c.unit_id, c.zitat) } : c,
    );
    for (const c of citations)
      emit({ t: Date.now() - t0, kind: "pruefung", title: c.status === "verifiziert" ? "Server bestätigt: Zitat steht im Gesetz" : "Server: Zitat steht NICHT im Gesetz", detail: c.unit_id, ok: c.status === "verifiziert", refs: [c.unit_id] });
    const ok = citations.filter((c) => c.status === "verifiziert").length;
    // "steht nicht im Gesetz" gewinnt, auch wenn Absätze mitkommen
    const status: AskResult["status"] = a.keine_quelle
      ? "keine_quelle"
      : citations.length === 0
        ? "nicht_belegt"
        : ok === citations.length
          ? "belegt"
          : ok > 0
            ? "teilweise_belegt"
            : "nicht_belegt";
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    emit({ t: Date.now() - t0, kind: "fertig", title: "Fertig", detail: `${steps} Modellschritte · ${read.length} Absätze gelesen · ${k(usage.input + usage.output)} Tokens` });
    const { fundstellen: _f, ...answer } = a;
    const { byId } = getIndex();
    result = {
      mode: "llm",
      question,
      date: day,
      model: `${provider.name}/${provider.model}`,
      status,
      answer,
      citations,
      retrieved: read.map((id) => ({ id, path: byId.get(id)?.path ?? id, heading: byId.get(id)?.heading ?? "" })),
      rechtsstand: rechtsstand(),
      ms: Date.now() - t0,
      trace,
      steps,
      usage,
    };
    if (status === "belegt" || status === "keine_quelle") writeCache(cacheKey, result);
  }
  logAnswer({ at: new Date().toISOString(), channel, ...result, trace: undefined, citations: result.citations.map(({ text: _t, ...c }) => c) });
  return result;
}
