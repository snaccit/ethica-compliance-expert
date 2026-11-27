"use client";
import { useSyncExternalStore } from "react";
import type { AskResult, TraceEvent } from "./types";

// Chat-Verlauf, der Seitenwechsel und F5 übersteht (localStorage). Neustart der App leert ihn.
export type Turn = { id: number; question: string; date: string; events: TraceEvent[]; result?: AskResult; error?: string };
type State = { turns: Turn[]; busy: boolean; sel: number | null };

const KEY = "ce-chat-v1";
const EMPTY: State = { turns: [], busy: false, sel: null };
let state: State = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { turns?: Turn[]; sel?: number | null; boot?: string };
    // App wurde neu gestartet: mit leerem Verlauf beginnen
    if (p.boot !== bootId()) return;
    const turns = (p.turns ?? []).filter((t) => t.result || t.error);
    state = { turns, busy: false, sel: turns.some((t) => t.id === p.sel) ? (p.sel ?? null) : (turns.at(-1)?.id ?? null) };
  } catch {
    /* ignorieren */
  }
}

function bootId(): string {
  return document.querySelector('meta[name="ce-boot"]')?.getAttribute("content") ?? "";
}

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  load();
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify({ turns: state.turns, sel: state.sel, boot: bootId() }));
  } catch {
    /* Speicher voll oder gesperrt: Verlauf bleibt trotzdem bis zum Neuladen */
  }
  listeners.forEach((l) => l());
}

export function useChat() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      load();
      return state;
    },
    () => EMPTY,
  );
}

export const selectTurn = (id: number) => set({ sel: id });
export const clearChat = () => set({ turns: [], sel: null });

export async function submitQuestion(question: string) {
  load();
  if (!question.trim() || state.busy) return;
  const id = Date.now();
  const patch = (f: (t: Turn) => Turn) => set((s) => ({ turns: s.turns.map((x) => (x.id === id ? f(x) : x)) }));
  set((s) => ({ turns: [...s.turns, { id, question, date: "", events: [] }], sel: id, busy: true }));
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, stream: true }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      patch((x) => ({ ...x, error: data.error }));
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === "event") patch((x) => ({ ...x, events: [...x.events, msg.event] }));
        else if (msg.type === "result")
          // Gespeicherte Antwort: Ablauf von damals übernehmen, damit Radar und Ablauf vollständig sind
          patch((x) => ({ ...x, result: msg.result, events: msg.result.cached && msg.result.trace?.length ? msg.result.trace : x.events }));
        else if (msg.type === "error") patch((x) => ({ ...x, error: msg.error }));
      }
    }
  } catch (e) {
    patch((x) => ({ ...x, error: (e as Error).message }));
  } finally {
    set({ busy: false });
  }
}
