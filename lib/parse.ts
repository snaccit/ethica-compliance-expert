import * as cheerio from "cheerio";
import type { Unit } from "./types";

/**
 * Zerlegt einen EUR-Lex-Rechtstext (deutsche HTML-Fassung) in Rechtseinheiten:
 * Artikel / Absatz und Anhang. Arbeitet textbasiert, damit alte und neue EUR-Lex-Layouts funktionieren.
 */

const MAX_UNIT_CHARS = 3500;

const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t\r\f\v]+/g, " ").trim();

const STRUCTURE = /^(ANHANG|Artikel|KAPITEL|ABSCHNITT|TITEL|TEIL)\s+[IVXLC\d]+[a-z]?$|^Geschehen zu /;

const ENUM_ONLY =/^(\(\d+[a-z]?\)|\(?[a-z]{1,2}\)|\(?[ivx]+\)|\d{1,3}\.|[—–-])$/;

export function htmlToLines(html: string): string[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, head").remove();
  let raw: string[] = [];
  const ps = $("p");
  if (ps.length > 20) {
    // Absätze plus Tabellenzellen, deren Text nicht in <p> steht (z. B. <td><span>…</span></td>)
    $("p, td").each((_, el) => {
      const isTd = (el as { tagName?: string }).tagName === "td";
      if (isTd && $(el).find("p").length > 0) return;
      raw.push($(el).text());
    });
  } else {
    $("br").replaceWith("\n");
    $("div, p, li, tr, h1, h2, h3, h4, h5, table").each((_, el) => {
      $(el).append("\n");
    });
    raw = $.root().text().split("\n");
  }
  const lines = raw.map(clean).filter(Boolean);
  // Aufzählungszeichen in eigener Tabellenzelle ("a)", "(1)") mit der folgenden Zeile zusammenführen
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ENUM_ONLY.test(lines[i]) && i + 1 < lines.length && !STRUCTURE.test(lines[i + 1])) {
      merged.push(`${lines[i]} ${lines[i + 1]}`);
      i++;
    } else merged.push(lines[i]);
  }
  return merged;
}

type Cur = {
  kind: "art" | "anx";
  num: string;
  heading: string;
  para: string | null;
  buf: string[];
};

export function linesToUnits(lines: string[], short: string): Unit[] {
  const units: Unit[] = [];
  const seen = new Set<string>();
  let order = 0;

  let start = lines.findIndex((l) => /HABEN FOLGENDE (VERORDNUNG|RICHTLINIE|BESCHLUSS)/i.test(l));
  if (start < 0) start = lines.findIndex((l) => /^Artikel 1$/.test(l)) - 1;
  if (start < -1) return [];

  let mode: "articles" | "after" | "annex" = "articles";
  let cur: Cur | null = null;
  let expectHeading = false;
  let skipNext = false;

  const pushUnit = (id: string, pathStr: string, heading: string, text: string) => {
    let uid = id;
    let k = 2;
    while (seen.has(uid)) uid = `${id}~${k++}`;
    seen.add(uid);
    units.push({ id: uid, source: short, path: pathStr, heading, text, order: order++ });
  };

  const flush = () => {
    if (!cur || cur.buf.length === 0) return;
    const baseId =
      cur.kind === "art"
        ? `${short}:Art${cur.num}${cur.para ? `(${cur.para})` : ""}`
        : `${short}:Anh${cur.num}${cur.para ? `(${cur.para})` : ""}`;
    const basePath =
      cur.kind === "art" ? `Art. ${cur.num}${cur.para ? ` Abs. ${cur.para}` : ""}` : `Anhang ${cur.num}${cur.para ? ` Nr. ${cur.para}` : ""}`;
    // lange Einheiten an Zeilengrenzen teilen
    const chunks: string[][] = [[]];
    let len = 0;
    for (const line of cur.buf) {
      if (len + line.length > MAX_UNIT_CHARS && chunks[chunks.length - 1].length > 0) {
        chunks.push([]);
        len = 0;
      }
      chunks[chunks.length - 1].push(line);
      len += line.length + 1;
    }
    chunks.forEach((c, i) => {
      const suffix = chunks.length > 1 ? `#${i + 1}` : "";
      pushUnit(baseId + suffix, basePath + (suffix ? ` (Teil ${i + 1})` : ""), cur!.heading, c.join("\n"));
    });
    cur.buf = [];
  };

  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];

    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (mode === "articles" && /^Geschehen zu /.test(l)) {
      flush();
      cur = null;
      mode = "after";
      continue;
    }

    const anx = /^ANHANG\s+([IVXLC]+[a-z]?)$/.exec(l);
    if (anx && mode !== "articles") {
      flush();
      cur = { kind: "anx", num: anx[1], heading: "", para: null, buf: [] };
      mode = "annex";
      expectHeading = true;
      continue;
    }
    if (mode === "after") continue;

    if (mode === "articles") {
      if (/^(KAPITEL|ABSCHNITT|TITEL|TEIL)\s+[IVXLC\d]+[a-z]?$/.test(l)) {
        skipNext = true; // Kapitelüberschrift folgt
        continue;
      }
      const art = /^Artikel\s+(\d+[a-z]?)$/.exec(l);
      if (art) {
        flush();
        cur = { kind: "art", num: art[1], heading: "", para: null, buf: [] };
        expectHeading = true;
        continue;
      }
    }

    if (!cur) continue;

    if (expectHeading) {
      expectHeading = false;
      if (!/^\(\d+/.test(l) && l.length < 200) {
        cur.heading = l;
        continue;
      }
    }

    if (cur.kind === "art" || cur.kind === "anx") {
      const para = /^\((\d+[a-z]?)\)\s+/.exec(l);
      if (para) {
        flush();
        cur.para = para[1];
      }
    }
    cur.buf.push(l);
  }
  flush();
  return units;
}

/** EUR-Lex-HTML → Absätze mit fester ID (z. B. BattVO:Art77(1)). Darin sucht später der Agent. */
export function parseEurLex(html: string, short: string): Unit[] {
  return linesToUnits(htmlToLines(html), short);
}
