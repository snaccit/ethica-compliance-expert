import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEurLex } from "../lib/parse";
import { quoteInText } from "../lib/verify";

const html = fs.readFileSync(path.join(__dirname, "fixtures", "mini-eurlex.html"), "utf8");
const units = parseEurLex(html, "TestVO");

describe("parseEurLex", () => {
  it("überspringt Erwägungsgründe und Kapitelüberschriften", () => {
    expect(units.some((u) => u.text.includes("Erwägungsgrund"))).toBe(false);
    expect(units.some((u) => u.text.includes("ALLGEMEINE BESTIMMUNGEN"))).toBe(false);
  });
  it("erkennt Artikel, Absätze und Überschriften", () => {
    const ids = units.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(["TestVO:Art1", "TestVO:Art77(1)", "TestVO:Art77(2)", "TestVO:AnhI"]));
    const a = units.find((u) => u.id === "TestVO:Art77(1)")!;
    expect(a.heading).toBe("Testpass");
    expect(a.path).toBe("Art. 77 Abs. 1");
    expect(a.text).toContain("mehr als 5 kWh");
  });
  it("hängt Aufzählungen an den Absatz an", () => {
    expect(units.find((u) => u.id === "TestVO:Art77(2)")!.text).toContain("a) die Kennung;");
  });
  it("liest Tabellenzellen ohne <p> und trennt Anhänge sauber", () => {
    const a2 = units.find((u) => u.id === "TestVO:AnhII(1)")!;
    expect(a2.text).toContain("Text nur in einer Tabellenzelle");
    expect(units.find((u) => u.id === "TestVO:AnhI")!.text).not.toContain("ANHANG II");
  });
  it("legt keine Artikel aus Anhängen an", () => {
    expect(units.some((u) => u.id === "TestVO:Art5")).toBe(false);
    expect(units.find((u) => u.id === "TestVO:AnhI")!.heading).toBe("ANGABEN IM TESTPASS");
  });
});

describe("quoteInText", () => {
  const text = "(1) Ab dem 1. Januar 2030 muss jedes Testgerät mit einer Kapazität von mehr als 5 kWh und Testbatterieüber einen Testpass verfügen.";
  it("akzeptiert wörtliche Zitate trotz Whitespace/Groß-Klein", () => {
    expect(quoteInText("mit einer  Kapazität von MEHR als 5 kWh", text)).toBe(true);
  });
  it("akzeptiert Auslassungen in Reihenfolge", () => {
    expect(quoteInText("Ab dem 1. Januar 2030 … mehr als 5 kWh", text)).toBe(true);
    expect(quoteInText("mehr als 5 kWh … Ab dem 1. Januar 2030", text)).toBe(false);
  });
  it("toleriert fehlende Leerzeichen im Quelltext", () => {
    expect(quoteInText("5 kWh und Testbatterie über einen Testpass", text)).toBe(true);
  });
  it("lehnt umformulierte Zitate ab", () => {
    expect(quoteInText("über 5 kWh", text)).toBe(false);
  });
});

describe("ask (mock-LLM)", () => {
  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-"));
    process.env.DPP_DATA_DIR = dir;
    process.env.LLM_PROVIDER = "mock";
    fs.writeFileSync(path.join(dir, "units.json"), JSON.stringify(units));
    fs.writeFileSync(path.join(dir, "registry.json"), JSON.stringify([{ short: "TestVO", title: "Testverordnung", status: "geladen", fetched_at: new Date().toISOString() }]));
  });
  it("findet Art. 77 über direkten Verweis und verifiziert das Zitat", async () => {
    const { ask } = await import("../lib/ask");
    const r = await ask("Gilt Art. 77 Abs. 1 für 5 kWh?");
    expect(r.retrieved[0].id).toBe("TestVO:Art77(1)");
    expect(r.status).toBe("belegt");
    expect(r.citations[0].status).toBe("verifiziert");
    const tools = r.trace.filter((e) => e.kind === "tool").map((e) => e.tool);
    expect(tools).toEqual(["suche_rechtstext", "lese_einheit", "antwort_geben"]);
    expect(r.trace.some((e) => e.kind === "pruefung" && e.ok)).toBe(true);
  });
});

describe("lese_einheit mit Artikel-ID", () => {
  it("liefert alle Absätze eines Artikels", async () => {
    const { runAgentToolForTest } = await import("../lib/agent");
    const out = runAgentToolForTest("lese_einheit", { unit_id: "TestVO:Art77" });
    expect(out.refs).toEqual(["TestVO:Art77(1)", "TestVO:Art77(2)"]);
  });
});

describe("grade", () => {
  it("erkennt Begriffe trotz Sonder-Bindestrich", async () => {
    const { grade } = await import("../lib/evaluate");
    const r = { mode: "llm", status: "belegt", answer: { antwort: "Für jede LV\u2011Batterie", begruendung: "" }, citations: [{ unit_id: "X:Art77(1)", zitat: "a", status: "verifiziert" }] } as never;
    const g = grade({ id: "Q", frage: "", erwartet: "", status: "", check: { must_include: ["LV-Batterie"], must_cite: "X:Art77" } }, r);
    expect(g.passed).toBe(true);
  });
});

describe("checkCitations", () => {
  it("korrigiert eine Nachbareinheit desselben Artikels, wenn eindeutig", async () => {
    const { checkCitations } = await import("../lib/verify");
    const byId = new Map(units.map((u) => [u.id, u]));
    const [c] = checkCitations([{ unit_id: "TestVO:Art77(1)", zitat: "Der Testpass enthält folgende Angaben" }], byId, (s) => s);
    expect(c.status).toBe("verifiziert");
    expect(c.unit_id).toBe("TestVO:Art77(2)");
    expect(c.korrigiert_von).toBe("TestVO:Art77(1)");
  });
});

describe("Antwort-Cache", () => {
  it("liefert die zweite gleiche Frage aus dem Cache", async () => {
    const { ask } = await import("../lib/ask");
    const q = "Gilt Art. 77 Abs. 1 für 5 kWh? (Cache-Test)";
    const a = await ask(q);
    const b = await ask(q);
    expect(a.cached).toBeFalsy();
    expect(b.cached).toBe(true);
    const c = await ask(q, undefined, undefined, "eval", { noCache: true });
    expect(c.cached).toBeFalsy();
  });
});

describe("Fingerabdruck", () => {
  it("bleibt gleich, wenn sich nur Seiten-Beiwerk ändert", async () => {
    const fs2 = await import("node:fs");
    const os2 = await import("node:os");
    const path2 = await import("node:path");
    const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), "dpp-ingest-"));
    process.env.DPP_DATA_DIR = dir;
    fs2.writeFileSync(path2.join(dir, "sources.yaml"), "- short: TestVO\n  title: Test\n  celex: x\n  url: http://127.0.0.1:9/none\n  phase: 1\n");
    fs2.mkdirSync(path2.join(dir, "raw"));
    const { refreshSources } = await import("../lib/ingest");
    fs2.writeFileSync(path2.join(dir, "raw", "TestVO.html"), html.replace("</body>", "<script>var session = 111;</script><input type=\"hidden\" value=\"111\"></body>"));
    const a = await refreshSources({ offline: true });
    const h1 = JSON.parse(fs2.readFileSync(path2.join(dir, "registry.json"), "utf8"))[0].sha256;
    fs2.writeFileSync(path2.join(dir, "raw", "TestVO.html"), html.replace("<head>", "<head><meta name='x' content='222'>"));
    await refreshSources({ offline: true });
    const h2 = JSON.parse(fs2.readFileSync(path2.join(dir, "registry.json"), "utf8"))[0].sha256;
    expect(a[0].units).toBeGreaterThan(0);
    expect(h2).toBe(h1);
  });
});

describe("Werkzeugaufrufe als Text (kleine lokale Modelle)", () => {
  it("erkennt <tool_call>-Blöcke und JSON im Fließtext", async () => {
    const { callsFromTextForTest } = await import("../lib/agent");
    const a = callsFromTextForTest('Ich lese nach. <tool_call>\n{"name": "lese_einheit", "arguments": {"unit_id": "BattVO:Art77"}}\n</tool_call>');
    expect(a.map((c) => [c.name, c.args.unit_id])).toEqual([["lese_einheit", "BattVO:Art77"]]);
    const b = callsFromTextForTest('```json\n{"antwort": "Nein", "fundstellen": []}\n```');
    expect(b[0].name).toBe("antwort_geben");
    expect(callsFromTextForTest("Keine Ahnung {kaputt")).toEqual([]);
  });
});
