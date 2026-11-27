/**
 * Welches Sprachmodell antwortet?
 *
 *   LLM_PROVIDER=ollama   (Standard) lokales Modell über Ollama, z. B. qwen2.5:7b
 *   LLM_PROVIDER=openai   jeder Server mit OpenAI-kompatibler API (LM Studio, llama.cpp, vLLM …)
 *   LLM_PROVIDER=mock     ohne Modell, feste Testantworten (für Tests und zum Durchklicken)
 *
 * Läuft kein Modell, fällt die App automatisch in den Suchmodus zurück.
 */
export type ProviderName = "ollama" | "openai" | "mock";
export type Provider = { name: ProviderName; model: string; baseUrl: string; apiKey?: string };

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function getProvider(): Provider {
  const name = (process.env.LLM_PROVIDER || "ollama").toLowerCase() as ProviderName;
  if (name === "mock") return { name, model: "mock", baseUrl: "" };
  if (name === "openai")
    return {
      name,
      model: process.env.LLM_MODEL || "local-model",
      baseUrl: trimSlash(process.env.LLM_BASE_URL || "http://localhost:1234/v1"),
      apiKey: process.env.LLM_API_KEY || undefined,
    };
  return {
    name: "ollama",
    model: process.env.LLM_MODEL || "qwen2.5:7b",
    baseUrl: trimSlash(process.env.LLM_BASE_URL || process.env.OLLAMA_HOST || "http://localhost:11434"),
  };
}

export function providerLabel(p: Provider): string {
  if (p.name === "mock") return "Testmodus";
  if (p.name === "ollama") return `Ollama · ${p.model}`;
  const host = p.baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `${/localhost:1234|127\.0\.0\.1:1234/.test(host) ? "LM Studio" : host} · ${p.model}`;
}

/** Kurzer Check, ob der Modell-Server antwortet. Ergebnis 30 s zwischengespeichert. */
let ping: { at: number; ok: boolean; key: string } | null = null;
export async function providerReachable(p: Provider): Promise<boolean> {
  if (p.name === "mock") return true;
  const key = `${p.name}|${p.baseUrl}`;
  if (ping && ping.key === key && Date.now() - ping.at < 30_000) return ping.ok;
  const url = p.name === "ollama" ? `${p.baseUrl}/api/tags` : `${p.baseUrl}/models`;
  let ok = false;
  try {
    const res = await fetch(url, {
      headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {},
      signal: AbortSignal.timeout(1500),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  ping = { at: Date.now(), ok, key };
  return ok;
}

/** Fehler, bei denen kein Modell-Server läuft (dann Suchmodus statt Fehlermeldung). */
export function isConnectionError(e: unknown): boolean {
  const err = e as { cause?: { code?: string }; message?: string; name?: string };
  const code = err?.cause?.code ?? "";
  return ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET"].includes(code) || /fetch failed/i.test(err?.message ?? "");
}

export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    antwort: { type: "string", description: "Kurzantwort in 1–3 Sätzen" },
    begruendung: { type: "string", description: "Herleitung: Schwellenwerte, Kategorien, Ausnahmen, Geltungsbeginn" },
    fundstellen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          unit_id: { type: "string", description: "ID exakt wie geliefert, z. B. BattVO:Art77(1)" },
          zitat: { type: "string", description: "Wörtlicher, zusammenhängender Ausschnitt aus genau dieser Einheit, max. 300 Zeichen" },
        },
        required: ["unit_id", "zitat"],
      },
    },
    stichtag: { type: ["string", "null"], description: "Relevantes Datum im Format JJJJ-MM-TT, sonst null" },
    sicherheit: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
    luecken: { type: "array", items: { type: "string" }, description: "Was fehlt für eine sichere Antwort" },
    keine_quelle: { type: "boolean", description: "true, wenn die gelesenen Texte die Frage nicht beantworten" },
  },
  required: ["antwort", "begruendung", "fundstellen", "stichtag", "sicherheit", "luecken", "keine_quelle"],
} as const;
