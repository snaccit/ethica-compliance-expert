import fs from "node:fs";
import * as cheerio from "cheerio";
import { rawPath } from "./store";

// Link direkt auf den zitierten Satz (#077.001:~:text=…), Chrome/Edge markieren ihn.
// Nur bei eindeutigem Text, sonst bleibt es beim Sprung zum Absatz.

const norm = (s: string) => s.replace(/[­]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const docs = new Map<string, { mtime: number; text: string }>();

function docText(short: string): string | null {
  const file = rawPath(short);
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  const hit = docs.get(short);
  if (hit && hit.mtime === mtime) return hit.text;
  const $ = cheerio.load(fs.readFileSync(file, "utf8"));
  $("script, style").remove();
  const text = norm($("body").text());
  docs.set(short, { mtime, text });
  return text;
}

const count = (hay: string, needle: string) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1 && n < 2; i = hay.indexOf(needle, i + 1)) n++;
  return n;
};

const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");

// "(1)", "a)" usw. stehen bei EUR-Lex in einer eigenen Zelle
const clean = (line: string) =>
  line
    .replace(/^[\s„“"'‚‘»«.…]+|[\s„“"'‚‘»«…]+$/g, "")
    .replace(/^(\(\w{1,4}\)|\w{1,3}\)|\d{1,3}\.|[—–-])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

export function withTextFragment(link: string, unitId: string, quote: string): string {
  if (/…|\.\.\./.test(quote)) return link; // gekürzte Zitate passen nicht wörtlich
  // mehrzeilig: Anfang aus erster, Ende aus letzter Zeile
  const lines = quote.split(/\n+/).map(clean).filter((l) => l.split(" ").length >= 2);
  if (!lines.length) return link;
  const text = docText(unitId.split(":")[0]);
  if (!text) return link;
  const first = lines[0].split(" ");
  const last = lines[lines.length - 1].split(" ");
  let directive: string;
  if (lines.length === 1 && first.length <= 12) {
    if (count(text, norm(lines[0])) !== 1) return link;
    directive = enc(lines[0]);
  } else {
    const start = [8, 12, 16, 22].map((n) => first.slice(0, n).join(" ")).find((s) => count(text, norm(s)) === 1);
    if (!start) return link;
    const end = last.slice(-4).join(" ");
    directive = `${enc(start)},${enc(end)}`;
  }
  return `${link.includes("#") ? link : link + "#"}:~:text=${directive}`;
}
