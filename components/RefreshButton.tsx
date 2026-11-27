"use client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { short: string; title: string; status: "unverändert" | "geändert" | "neu" | "fehler"; units: number; message: string };

const CLS: Record<Result["status"], string> = { unverändert: "ok", neu: "info", geändert: "warn", fehler: "warn" };
const LABEL: Record<Result["status"], string> = { unverändert: "unverändert", neu: "eingerichtet", geändert: "geändert", fehler: "offline" };

export default function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/sources/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" style={{ padding: "10px 16px" }} onClick={run} disabled={busy}>
        <RefreshCw size={15} className={busy ? "spin" : ""} />
        {busy ? "Lade Gesetze …" : "Gesetze aktualisieren"}
      </button>
      {error && <div className="status bad" style={{ marginTop: 12, whiteSpace: "normal" }}>{error}</div>}
      {results && (
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {results.map((r) => (
            <div key={r.short} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span className={`status ${CLS[r.status]}`} style={{ minWidth: 96, justifyContent: "center" }}>{LABEL[r.status]}</span>
              <span>
                <b>{r.short}</b> <span className="muted">{r.message}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
