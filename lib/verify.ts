import type { CheckedCitation, Unit } from "./types";

export const collapse = (s: string) => s.replace(/[ \s]+/g, " ").trim();

const normChar = (c: string) => {
  if (/[„“”"«»]/.test(c)) return '"';
  if (/[‚‘’'`]/.test(c)) return "'";
  if (/[–—‑]/.test(c)) return "-";
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
};

/** Text ohne Leerraum, normalisiert; map[i] = Position im Original. */
function squashWithMap(s: string): { hay: string; map: number[] } {
  let hay = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[\s ]/.test(c)) continue;
    hay += normChar(c);
    map.push(i);
  }
  return { hay, map };
}

const quoteParts = (quote: string) =>
  quote
    .trim()
    .replace(/^["„“']+|["“”']+$/g, "")
    .split(/\s*(?:\.\.\.|…|\[…\]|\[\.\.\.\])\s*/)
    .map((p) => squashWithMap(p).hay)
    .filter((p) => p.length > 0);

/**
 * Findet ein Zitat im Text. Leerzeichen werden ignoriert (EUR-Lex-Texte enthalten fehlende/doppelte Leerzeichen),
 * Anführungszeichen und Gedankenstriche vereinheitlicht. Auslassungen ("…") sind erlaubt, Teile müssen in Reihenfolge stehen.
 * Gibt die Fundbereiche im Originaltext zurück, oder null.
 */
export function locateQuote(quote: string, text: string): [number, number][] | null {
  const { hay, map } = squashWithMap(text);
  const parts = quoteParts(quote);
  if (parts.length === 0) return null;
  const ranges: [number, number][] = [];
  let pos = 0;
  for (const part of parts) {
    const i = hay.indexOf(part, pos);
    if (i < 0) return null;
    ranges.push([map[i], map[i + part.length - 1] + 1]);
    pos = i + part.length;
  }
  return ranges;
}

export const quoteInText = (quote: string, text: string) => locateQuote(quote, text) !== null;

/** Sprungmarke im EUR-Lex-HTML: Absatz "077.001", Artikel "art_77", Anhang "anx_XIII". */
export function eurLexAnchor(unitId: string): string | null {
  const art = /:Art(\d+)(?:\((\d+)\))?/.exec(unitId);
  if (art) return art[2] ? `${art[1].padStart(3, "0")}.${art[2].padStart(3, "0")}` : `art_${art[1]}`;
  const anx = /:Anh([IVXLC]+)/.exec(unitId);
  return anx ? `anx_${anx[1]}` : null;
}

export function checkCitations(
  cites: { unit_id: string; zitat: string }[],
  byId: Map<string, Unit>,
  sourceTitle: (short: string) => string,
  sourceUrl: (short: string) => string | undefined = () => undefined,
): CheckedCitation[] {
  const base = (id: string) => id.replace(/[(#~].*$/, "");
  return cites.map((c) => {
    let u = byId.get(c.unit_id);
    let korrigiert_von: string | undefined;
    if (!u || !quoteInText(c.zitat, u.text)) {
      // Zitat steht ggf. in einer Nachbareinheit desselben Artikels/Anhangs -> eindeutig? dann ID korrigieren
      const b = base(c.unit_id);
      const hits = [...byId.values()].filter((x) => base(x.id) === b && quoteInText(c.zitat, x.text));
      if (hits.length === 1) {
        korrigiert_von = c.unit_id;
        u = hits[0];
      }
    }
    if (!u) return { ...c, status: "unbekannte_fundstelle" as const };
    return {
      korrigiert_von,
      unit_id: u.id,
      zitat: c.zitat,
      status: quoteInText(c.zitat, u.text) ? ("verifiziert" as const) : ("zitat_nicht_gefunden" as const),
      path: u.path,
      heading: u.heading,
      source_title: sourceTitle(u.source),
      text: collapse(u.text),
      link: linkFor(u, sourceUrl),
    };
  });
}

export function linkFor(u: Unit, sourceUrl: (short: string) => string | undefined): string | undefined {
  const base = sourceUrl(u.source);
  if (!base) return undefined;
  const anchor = eurLexAnchor(u.id);
  return anchor ? `${base}#${anchor}` : base;
}
