/**
 * Der Agent: ein Sprachmodell mit vier Werkzeugen. Es entscheidet selbst, wann es sucht,
 * was es liest und wann es antwortet. Jeder Schritt landet im Ablauf (TraceEvent), den die UI live zeigt.
 */
import { ANSWER_SCHEMA, type Provider } from "./llm";
import { getIndex, search } from "./search";
import type { LlmAnswer, TraceEvent } from "./types";
import { quoteInText } from "./verify";

export const MAX_STEPS = 5;

// Jeder Schritt schickt den ganzen bisherigen Verlauf erneut mit, deshalb die Grenzen.
const SEARCH_HITS = 6;
const SNIPPET_CHARS = 140;
const ARTICLE_BUDGET = 5000;
const UNIT_MAX = 3000;

export const AGENT_PROMPT = `Du bist der "DPP & Compliance Expert" im Forschungsprojekt ETHICA (snacc-it). Du beantwortest Fachfragen zu digitalen Produktpässen und EU-Regulatorik.

Arbeitsweise:
1. Suche mit suche_rechtstext nach passenden Rechtseinheiten (mehrere Suchbegriffe sind erlaubt, z. B. Artikelnummer und Fachbegriff).
2. Lies den einschlägigen Artikel mit lese_einheit vollständig – mit der Artikel-ID ohne Absatz (z. B. "BattVO:Art77") bekommst du alle Absätze auf einmal. Brauchst du mehrere Einheiten (z. B. Artikel und Anhang oder Art. 3), rufe lese_einheit in derselben Runde mehrfach auf.
3. pruefe_zitat nur, wenn du unsicher bist, ob ein Zitat wörtlich stimmt. Der Server prüft jede Fundstelle ohnehin.
4. Beende IMMER mit antwort_geben.

Sparsam arbeiten (jede Runde kostet Zeit):
- Höchstens zwei Suchen. Findest du danach keine Vorschrift, die die Frage regelt, antworte sofort mit keine_quelle.
- Fragen ohne Bezug zu Produktpass oder Gesetzen (z. B. Personen, Firmeninterna): sofort antwort_geben mit keine_quelle, ohne Suche.
- Lies keine Einheit zweimal.

Regeln:
- Nutze ausschließlich gelesene Rechtseinheiten. Kein Vorwissen, keine Vermutungen.
- Jede Fundstelle: unit_id exakt wie geliefert, zitat wörtlich und zusammenhängend aus dieser Einheit (max. 300 Zeichen).
- Reichen die Quellen nicht aus: keine_quelle=true, keine Fundstellen, in luecken nennen, welche Quelle fehlt (z. B. nationales Recht).
- keine_quelle=true gilt auch, wenn du passende Artikel gelesen hast, diese aber die konkrete Frage nicht regeln (z. B. Kosten, Preise, Bußgeldbeträge, Anbieter). Zitiere dann keine Absätze, nur weil du sie gelesen hast.
- Eine klare Antwort aus dem Gesetz ("Ja" oder "Nein, weil die Vorschrift X verlangt") ist KEIN Fall von keine_quelle. Dann mit Fundstelle antworten.
- Achte genau auf Schwellenwerte ("mehr als", "ab", "mindestens"), Kategorien, Ausnahmen und Geltungsbeginn.
- Zählt eine Vorschrift die erfassten Kategorien abschließend auf, sind nicht genannte Kategorien nicht erfasst: Antworte dann klar mit "Nein" bzw. "Ja", nenne die Aufzählung als Fundstelle und weise ggf. auf andere einschlägige Pflichten hin.
- Ist ein Stichtag vorgegeben, beantworte die Frage für diesen Tag.
- Antworte auf Deutsch, knapp und präzise. Fachliche Einordnung, keine Rechtsberatung.`;

export const TOOLS = [
  {
    name: "suche_rechtstext",
    description: "Volltextsuche (BM25) über alle geladenen Rechtseinheiten. Erkennt auch direkte Verweise wie 'Art. 77 Abs. 1' oder 'Anhang XIII'. Liefert IDs, Fundort und Textanfang.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Suchbegriffe oder Fundstelle" } },
      required: ["query"],
    },
  },
  {
    name: "lese_einheit",
    description: "Liest den vollständigen Text einer Rechtseinheit, z. B. 'BattVO:Art77(1)'. Mit einer Artikel- oder Anhang-ID ohne Absatz (z. B. 'BattVO:Art77' oder 'BattVO:AnhXIII') liefert es alle zugehörigen Einheiten mit ihren IDs.",
    parameters: {
      type: "object",
      properties: { unit_id: { type: "string" } },
      required: ["unit_id"],
    },
  },
  {
    name: "pruefe_zitat",
    description: "Prüft, ob ein Zitat wörtlich in der angegebenen Rechtseinheit steht.",
    parameters: {
      type: "object",
      properties: { unit_id: { type: "string" }, zitat: { type: "string" } },
      required: ["unit_id", "zitat"],
    },
  },
  {
    name: "antwort_geben",
    description: "Gibt die endgültige, strukturierte Antwort mit Fundstellen ab. Beendet die Arbeit.",
    parameters: ANSWER_SCHEMA,
  },
] as const;

type Call = { id: string; name: string; args: Record<string, unknown> };
export type Usage = { input: number; cached: number; output: number; calls: number };
type StepResult = { text: string; calls: Call[]; usage?: { input: number; cached: number; output: number } };

/** Ein Gesprächsverlauf mit dem Modell. final=true: keine Werkzeuge mehr, Antwort als JSON erzwingen. */
interface Chat {
  step(final: boolean): Promise<StepResult>;
  addResults(results: { id: string; name: string; content: string }[]): void;
  nudge(text: string): void;
}

const TOOL_DEFS = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const TOOL_NAMES = new Set<string>(TOOLS.map((t) => t.name));
const FINAL_NUDGE = "Gib jetzt deine endgültige Antwort als JSON-Objekt mit den Feldern antwort, begruendung, fundstellen, stichtag, sicherheit, luecken, keine_quelle.";

// Aufrufe, die nur als Text kamen, bekommen ihr Ergebnis als normale Nachricht zurück
const asUserResult = (name: string, content: string) => ({ role: "user", content: `Ergebnis von ${name}:\n${content}` });

let callSeq = 0;
const newId = () => `call_${++callSeq}`;

const asArgs = (a: unknown): Record<string, unknown> => (typeof a === "string" ? safeJson(a) : ((a ?? {}) as Record<string, unknown>));

// kleine Modelle schreiben Tool-Calls manchmal als JSON in den Text
function jsonObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          out.push(JSON.parse(text.slice(i, j + 1)));
          i = j;
        } catch {
          /* kein gültiges JSON, weitersuchen */
        }
        break;
      }
    }
  }
  return out;
}

function callsFromText(text: string): Call[] {
  const calls: Call[] = [];
  for (const o of jsonObjects(text)) {
    const name = String(o.name ?? (o.function as { name?: string } | undefined)?.name ?? "");
    if (TOOL_NAMES.has(name)) calls.push({ id: newId(), name, args: asArgs(o.arguments ?? o.parameters ?? (o.function as { arguments?: unknown })?.arguments) });
    else if ("antwort" in o) calls.push({ id: newId(), name: "antwort_geben", args: o });
  }
  return calls;
}

function finalAnswerFrom(text: string): Call {
  const o = jsonObjects(text).find((x) => "antwort" in x);
  return {
    id: newId(),
    name: "antwort_geben",
    args: o ?? {
      antwort: text.trim().slice(0, 800) || "Das Modell hat keine auswertbare Antwort geliefert.",
      begruendung: "",
      fundstellen: [],
      stichtag: null,
      sicherheit: "niedrig",
      luecken: ["Das Modell hat die Antwort nicht im erwarteten Format geliefert."],
      keine_quelle: false,
    },
  };
}

async function readError(res: Response, p: Provider): Promise<Error> {
  const body = (await res.text()).slice(0, 400);
  if (p.name === "ollama" && res.status === 404 && /not found/i.test(body))
    return new Error(`Das Modell ${p.model} ist in Ollama noch nicht installiert. Einmal im Terminal ausführen: ollama pull ${p.model}`);
  return new Error(`Modell-Server antwortet mit ${res.status}: ${body}`);
}

// Ollama-API statt /v1, damit num_ctx und das JSON-Schema gesetzt werden können
function ollamaChat(p: Provider, system: string, user: string): Chat {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const native = new Set<string>();
  return {
    async step(final) {
      if (final) messages.push({ role: "user", content: FINAL_NUDGE });
      const res = await fetch(`${p.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: p.model,
          messages,
          stream: false,
          options: { num_ctx: Number(process.env.LLM_CONTEXT || 16384), temperature: 0.1 },
          ...(final ? { format: ANSWER_SCHEMA } : { tools: TOOL_DEFS }),
        }),
      });
      if (!res.ok) throw await readError(res, p);
      const data = (await res.json()) as {
        message: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const msg = data.message ?? {};
      messages.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
      const text = msg.content ?? "";
      let calls: Call[] = (msg.tool_calls ?? []).map((c) => ({ id: newId(), name: c.function.name, args: asArgs(c.function.arguments) }));
      calls.forEach((c) => native.add(c.id));
      if (final) calls = [finalAnswerFrom(text)];
      else if (calls.length === 0) calls = callsFromText(text);
      return {
        text: calls.length && !msg.tool_calls ? "" : text,
        calls,
        usage: { input: data.prompt_eval_count ?? 0, cached: 0, output: data.eval_count ?? 0 },
      };
    },
    addResults(results) {
      for (const r of results) messages.push(native.has(r.id) ? { role: "tool", tool_name: r.name, content: r.content } : asUserResult(r.name, r.content));
    },
    nudge(text) {
      messages.push({ role: "user", content: text });
    },
  };
}

// LM Studio, llama.cpp, vLLM usw.
function openaiChat(p: Provider, system: string, user: string): Chat {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  const effort = process.env.LLM_REASONING_EFFORT;
  const native = new Set<string>();

  async function post(body: Record<string, unknown>) {
    return fetch(`${p.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: p.model, messages, temperature: 0.1, ...(effort ? { reasoning_effort: effort } : {}), ...body }) });
  }

  return {
    async step(final) {
      let res: Response;
      if (final) {
        messages.push({ role: "user", content: FINAL_NUDGE });
        res = await post({ response_format: { type: "json_schema", json_schema: { name: "antwort", schema: ANSWER_SCHEMA } } });
        // nicht jeder Server kann JSON-Schema: dann ohne Vorgabe
        if (res.status >= 400 && res.status < 500) res = await post({});
      } else res = await post({ tools: TOOL_DEFS, tool_choice: "auto" });
      if (!res.ok) throw await readError(res, p);
      const data = (await res.json()) as {
        choices: { message: { content: string | null; tool_calls?: { id?: string; function: { name: string; arguments: unknown } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      const msg = data.choices?.[0]?.message ?? { content: "" };
      const toolCalls = (msg.tool_calls ?? []).map((c) => ({ ...c, id: c.id || newId() }));
      messages.push({ role: "assistant", content: msg.content ?? "", ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments) } })) } : {}) });
      const text = msg.content ?? "";
      let calls: Call[] = toolCalls.map((c) => ({ id: c.id, name: c.function.name, args: asArgs(c.function.arguments) }));
      calls.forEach((c) => native.add(c.id));
      if (final) calls = [finalAnswerFrom(text)];
      else if (calls.length === 0) calls = callsFromText(text);
      return {
        text: calls.length && !toolCalls.length ? "" : text,
        calls,
        usage: { input: data.usage?.prompt_tokens ?? 0, cached: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
      };
    },
    addResults(results) {
      for (const r of results) messages.push(native.has(r.id) ? { role: "tool", tool_call_id: r.id, content: r.content } : asUserResult(r.name, r.content));
    },
    nudge(text) {
      messages.push({ role: "user", content: text });
    },
  };
}

// für Tests: sucht, liest den ersten Treffer, zitiert dessen Anfang
function mockChat(_p: Provider, _s: string, user: string): Chat {
  const question = /Frage: (.*)/.exec(user)?.[1] ?? "";
  let turn = 0;
  let firstId = "";
  let firstText = "";
  return {
    async step() {
      await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 0)));
      turn++;
      if (turn === 1) return { text: "Ich suche zuerst nach passenden Rechtseinheiten.", calls: [{ id: "c1", name: "suche_rechtstext", args: { query: question } }] };
      if (turn === 2 && firstId) return { text: "", calls: [{ id: "c2", name: "lese_einheit", args: { unit_id: firstId } }] };
      const zitat = firstText.slice(0, 80);
      return {
        text: "",
        calls: [
          {
            id: "c3",
            name: "antwort_geben",
            args: firstId
              ? { antwort: "Testantwort", begruendung: "Mock", fundstellen: [{ unit_id: firstId, zitat }], stichtag: null, sicherheit: "mittel", luecken: [], keine_quelle: false }
              : { antwort: "Keine Quelle.", begruendung: "", fundstellen: [], stichtag: null, sicherheit: "niedrig", luecken: ["Testfall"], keine_quelle: true },
          },
        ],
      };
    },
    addResults(results) {
      for (const r of results) {
        const parsed = safeJson(r.content) as { treffer?: { id: string }[]; text?: string };
        if (parsed.treffer?.[0]) firstId = parsed.treffer[0].id;
        if (parsed.text) firstText = parsed.text;
      }
    },
    nudge() {},
  };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const compact = (t: string) => t.replace(/\s+/g, " ").trim();

/** Führt ein Werkzeug aus: Ergebnis für das Modell plus Kurzfassung für den Ablauf in der UI. */
function runTool(call: Call, read: Set<string>): { content: string; summary: string; refs?: string[]; ok?: boolean } {
  const { byId } = getIndex();
  if (call.name === "suche_rechtstext") {
    const hits = search(String(call.args.query ?? ""), SEARCH_HITS);
    return {
      content: JSON.stringify({ treffer: hits.map((u) => ({ id: u.id, fundort: `${u.path} – ${u.heading}`, anfang: short(u.text.replace(/\s+/g, " "), SNIPPET_CHARS) })) }),
      summary: `${hits.length} Treffer`,
      refs: hits.map((h) => h.id),
    };
  }
  if (call.name === "lese_einheit") {
    const id = String(call.args.unit_id ?? "").trim();
    const u = byId.get(id);
    if (u) {
      if (read.has(id)) return { content: JSON.stringify({ hinweis: `${id} wurde bereits gelesen, Text steht weiter oben.` }), summary: `${u.path} schon gelesen`, refs: [id] };
      read.add(id);
      return { content: JSON.stringify({ id, fundort: `${u.path} – ${u.heading}`, text: compact(u.text).slice(0, UNIT_MAX) }), summary: `${u.path} · ${u.heading} · ${u.text.length} Zeichen`, refs: [id] };
    }
    // ganzer Artikel / Anhang: alle Einheiten mit diesem Präfix
    const parts = getIndex().units.filter((x) => x.id.startsWith(id + "(") || x.id.startsWith(id + "#") || x.id.startsWith(id + "~"));
    if (parts.length === 0) return { content: JSON.stringify({ fehler: `Unbekannte ID ${id}` }), summary: `unbekannte ID ${id}`, ok: false };
    let budget = ARTICLE_BUDGET;
    const einheiten: { id: string; text: string }[] = [];
    for (const x of parts) {
      if (budget <= 0) break;
      if (read.has(x.id)) continue; // bereits gelesen: nicht erneut senden
      const t = compact(x.text);
      einheiten.push({ id: x.id, text: t.slice(0, budget) });
      budget -= t.length;
      read.add(x.id);
    }
    if (einheiten.length === 0) return { content: JSON.stringify({ hinweis: `${id} wurde bereits vollständig gelesen, Text steht weiter oben.` }), summary: `${id} schon gelesen`, refs: [] };
    return {
      content: JSON.stringify({ fundort: `${parts[0].path.replace(/ Abs\. .*| \(Teil.*/, "")} – ${parts[0].heading}`, einheiten }),
      summary: `${parts[0].path.replace(/ Abs\. .*| \(Teil.*/, "")} · ${parts[0].heading} · ${einheiten.length} Einheiten`,
      refs: einheiten.map((e) => e.id),
    };
  }
  if (call.name === "pruefe_zitat") {
    const id = String(call.args.unit_id ?? "");
    const u = byId.get(id);
    const ok = !!u && quoteInText(String(call.args.zitat ?? ""), u.text);
    return { content: JSON.stringify({ verifiziert: ok }), summary: ok ? "Zitat steht wörtlich im Text" : "Zitat NICHT gefunden", refs: [id], ok };
  }
  return { content: JSON.stringify({ fehler: `Unbekanntes Werkzeug ${call.name}` }), summary: "unbekanntes Werkzeug", ok: false };
}

const TOOL_LABEL: Record<string, string> = {
  suche_rechtstext: "Sucht in den Gesetzen",
  lese_einheit: "Liest den Gesetzestext",
  pruefe_zitat: "Prüft das eigene Zitat",
  antwort_geben: "Schreibt die Antwort",
};

export async function runAgent(
  provider: Provider,
  question: string,
  day: string,
  emit: (e: TraceEvent) => void,
): Promise<{ answer: LlmAnswer; steps: number; read: string[]; usage: Usage }> {
  const t0 = Date.now();
  const ev = (e: Omit<TraceEvent, "t">) => emit({ ...e, t: Date.now() - t0 });
  const user = `Stichtag: ${day}\nFrage: ${question}`;
  const make = provider.name === "ollama" ? ollamaChat : provider.name === "openai" ? openaiChat : mockChat;
  const chat = make(provider, AGENT_PROMPT, user);
  const read = new Set<string>();
  const usage: Usage = { input: 0, cached: 0, output: 0, calls: 0 };

  ev({ kind: "start", title: "Frage erhalten", detail: `Modell ${provider.model}` });

  for (let step = 1; step <= MAX_STEPS; step++) {
    const r = await chat.step(step === MAX_STEPS);
    usage.calls++;
    if (r.usage) {
      usage.input += r.usage.input;
      usage.cached += r.usage.cached;
      usage.output += r.usage.output;
    }
    if (r.text.trim()) ev({ kind: "denken", title: "Plant den nächsten Schritt", detail: short(r.text.trim(), 400) });

    const final = r.calls.find((c) => c.name === "antwort_geben");
    if (final) {
      ev({ kind: "tool", tool: "antwort_geben", title: TOOL_LABEL.antwort_geben, detail: `${(final.args.fundstellen as unknown[] | undefined)?.length ?? 0} Fundstellen` });
      return { answer: final.args as unknown as LlmAnswer, steps: step, read: [...read], usage };
    }
    if (r.calls.length === 0) {
      chat.nudge("Bitte schließe jetzt mit dem Werkzeug antwort_geben ab.");
      continue;
    }
    const results = r.calls.map((c) => {
      const argText = c.name === "pruefe_zitat" ? `${c.args.unit_id}: „${short(String(c.args.zitat ?? ""), 90)}“` : String(c.args.query ?? c.args.unit_id ?? "");
      ev({ kind: "tool", tool: c.name, title: TOOL_LABEL[c.name] ?? c.name, detail: argText });
      const out = runTool(c, read);
      ev({ kind: "ergebnis", tool: c.name, title: out.summary, refs: out.refs, ok: out.ok });
      return { id: c.id, name: c.name, content: out.content };
    });
    chat.addResults(results);
  }
  throw new Error("Agent hat keine Antwort abgegeben");
}

/** Für die Tests. */
export const callsFromTextForTest = callsFromText;
export const runAgentToolForTest = (name: string, args: Record<string, unknown>) => runTool({ id: "t", name, args }, new Set());
