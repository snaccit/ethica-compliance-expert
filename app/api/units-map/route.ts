import { NextResponse } from "next/server";
import { getIndex } from "@/lib/search";
import { readRegistry } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Leichte Übersicht aller Absätze (nur IDs und Fundort) für das Gesetzes-Radar. */
export async function GET() {
  const { units } = getIndex();
  const reg = readRegistry().filter((r) => r.status === "geladen");
  return NextResponse.json(
    reg.map((r) => ({
      short: r.short,
      title: r.title,
      units: units.filter((u) => u.source === r.short).map((u) => ({ id: u.id, path: u.path })),
    })),
  );
}
