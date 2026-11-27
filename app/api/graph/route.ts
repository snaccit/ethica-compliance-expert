import { NextResponse } from "next/server";
import { buildGraph } from "@/lib/graph";
import { getIndex } from "@/lib/search";
import { readRegistry } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/graph?law=BattVO – Verweis-Graph eines Gesetzes */
export async function GET(req: Request) {
  const law = new URL(req.url).searchParams.get("law") ?? "BattVO";
  const reg = readRegistry().find((r) => r.short === law);
  if (!reg) return NextResponse.json({ error: "Gesetz nicht geladen" }, { status: 404 });
  return NextResponse.json({ ...buildGraph(getIndex().units, law), url: reg.url, title: reg.title });
}
