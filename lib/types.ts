export type Unit = {
  id: string; // z. B. "BattVO:Art77(1)"
  source: string; // Kurzname, z. B. "BattVO"
  path: string; // lesbar, z. B. "Art. 77 Abs. 1"
  heading: string; // z. B. "Batteriepass"
  text: string;
  order: number;
};

export type SourceEntry = {
  short: string;
  title: string;
  celex: string;
  url: string;
  phase: number;
  note?: string;
};

export type RegistryEntry = SourceEntry & {
  fetched_at: string | null;
  sha256: string | null;
  units: number;
  status: "geladen" | "fehler" | "offen";
  origin?: "eu-api" | "eur-lex" | "lokale Datei";
  hash_basis?: "text"; // Fingerabdruck über den zerlegten Gesetzestext (nicht über die HTML-Seite)
  error?: string;
};

export type LlmAnswer = {
  antwort: string;
  begruendung: string;
  fundstellen: { unit_id: string; zitat: string }[];
  stichtag: string | null;
  sicherheit: "hoch" | "mittel" | "niedrig";
  luecken: string[];
  keine_quelle: boolean;
};

export type CheckedCitation = {
  unit_id: string;
  zitat: string;
  status: "verifiziert" | "zitat_nicht_gefunden" | "unbekannte_fundstelle";
  korrigiert_von?: string; // Modell nannte den Nachbarabsatz, Zitat steht aber hier
  link?: string; // direkt zur Stelle im EUR-Lex-Text
  path?: string;
  heading?: string;
  source_title?: string;
  text?: string;
};

export type TraceEvent = {
  t: number; // ms seit Start
  kind: "start" | "denken" | "tool" | "ergebnis" | "pruefung" | "fertig" | "fehler";
  title: string;
  detail?: string;
  tool?: string;
  refs?: string[];
  ok?: boolean;
};

export type AskResult = {
  mode: "llm" | "suche";
  question: string;
  date: string;
  model: string | null;
  status: "belegt" | "teilweise_belegt" | "nicht_belegt" | "keine_quelle" | "nur_suche";
  answer: Omit<LlmAnswer, "fundstellen"> | null;
  citations: CheckedCitation[];
  retrieved: { id: string; path: string; heading: string }[];
  rechtsstand: string;
  ms: number;
  trace: TraceEvent[];
  steps: number;
  usage?: { input: number; cached: number; output: number; calls: number };
  cached?: boolean; // kam aus dem Zwischenspeicher
};

export type EvalCase = {
  id: string;
  frage: string;
  erwartet: string;
  check: { must_include?: string[]; must_cite?: string; must_refuse?: boolean };
  status: string;
};

export type EvalCaseResult = {
  id: string;
  frage: string;
  passed: boolean;
  reasons: string[];
  status: AskResult["status"];
  antwort: string;
};

export type EvalRun = {
  id: string;
  created_at: string;
  model: string | null;
  passed: number;
  total: number;
  score: number;
  results: EvalCaseResult[];
  tokens?: number;
  avg_seconds?: number;
};
