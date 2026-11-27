import { NextResponse } from "next/server";
import { refreshSources } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/sources/refresh – Gesetze neu von EUR-Lex holen und Änderungen melden */
export async function POST() {
  try {
    return NextResponse.json({ results: await refreshSources() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
