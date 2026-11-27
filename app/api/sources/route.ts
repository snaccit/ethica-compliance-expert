import { NextResponse } from "next/server";
import { readRegistry } from "@/lib/store";

export async function GET() {
  return NextResponse.json(readRegistry());
}
