import { NextResponse } from "next/server";
import { ask } from "@/lib/ask";
import type { AskResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {question, date?, stream?} – mit stream=true als NDJSON: {"type":"event",...} je Schritt, zuletzt {"type":"result",...} */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: string; date?: string; stream?: boolean };
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "Frage fehlt" }, { status: 400 });

  if (!body.stream) {
    try {
      return NextResponse.json(await ask(question, body.date));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        // Die App fragt immer live (man sieht den Agenten arbeiten). Gespeicherte Antworten nur mit ANSWER_CACHE=on.
        const result = await ask(question, body.date, (event) => send({ type: "event", event }), "web", { noCache: process.env.ANSWER_CACHE !== "on" });
        send({ type: "result", result });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}

/** GET /api/ask?q=…&date=… – kompakte JSON-Antwort für andere Programme */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "Parameter q fehlt" }, { status: 400 });
  try {
    const r: AskResult = await ask(q, url.searchParams.get("date") ?? undefined, undefined, "api");
    return NextResponse.json({
      status: r.status,
      verified: r.status === "belegt",
      antwort: r.answer?.antwort ?? null,
      begruendung: r.answer?.begruendung ?? null,
      stichtag: r.answer?.stichtag ?? null,
      luecken: r.answer?.luecken ?? [],
      fundstellen: r.citations.map((c) => ({ unit_id: c.unit_id, fundort: c.path, zitat: c.zitat, status: c.status })),
      rechtsstand: r.rechtsstand,
      modell: r.model,
      schritte: r.steps,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
