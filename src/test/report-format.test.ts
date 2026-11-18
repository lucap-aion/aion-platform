import { describe, it, expect } from "vitest";
import { capSlices, eur, eurAxis, fmtCell, grp, isDateCol, isNumericCol, looksMoney, parseDisplayNumber, parseIsoDate } from "../lib/reportFormat";
import { sectionHasData, sectionsToSheets, type ReportPayload } from "../components/assistant/ReportView";
import { sanitizeFilename } from "../lib/reportExport";
import { pdfSafe } from "../lib/reportPdf";

// What a report says, the same way on screen, in the PDF and in the Excel. Every case
// here was a defect a client could see (full review, 2026-11-18).

describe("money or count", () => {
  it("is money when the name says so", () => {
    for (const c of ["spesa", "spesa_eur", "fatturato_totale", "scontrino_medio", "Spesa Eur", "total_revenue", "avg_ticket", "selling_price", "ltv", "spesa_clienti", "valore_totale_eur"]) {
      expect(looksMoney(c), c).toBe(true);
    }
  });
  it("is a count when a count word is anywhere in the name", () => {
    // "Total Policies = €468" and "numero_scontrini" shown as euros.
    for (const c of ["total_policies", "Total Policies", "numero_scontrini", "pezzi_venduti", "clienti_attivi", "anno", "quota_pct", "best_selling", "totale"]) {
      expect(looksMoney(c), c).toBe(false);
    }
  });
});

describe("numbers", () => {
  it("groups four-digit amounts like the five-digit ones", () => {
    expect(eur(9800)).toBe("€9.800");
    expect(eur(53333)).toBe("€53.333");
    expect(grp(1234.5)).toBe("1.234,5");
  });
  it("puts the minus before the euro sign", () => {
    expect(eur(-500)).toBe("-€500");
  });
  it("labels small axis values in full, not as €0k", () => {
    expect(eurAxis(450)).toBe("€450");
    expect(eurAxis(899452)).toBe("€899k");
  });
});

describe("a table cell", () => {
  it("reads a year as a year", () => {
    expect(fmtCell("anno", "Anno", 2025)).toBe("2025");
    expect(fmtCell("year", "Year", "2025")).toBe("2025");
  });
  it("reads a date as a day, in Rome", () => {
    expect(fmtCell("data_inizio", "Data Inizio", "2026-06-15")).toBe("15/06/2026");
    // 23:30 UTC on 31 Oct is already 1 Nov in Rome.
    expect(fmtCell("start_date", "Start Date", "2026-10-31T23:30:00+00:00")).toBe("01/11/2026");
  });
  it("collapses padding and line breaks", () => {
    expect(fmtCell("negozio", "Negozio", "Roberto Coin S.P.A. Roma      Boutique")).toBe("Roberto Coin S.P.A. Roma Boutique");
    expect(fmtCell("note", "Note", "a\nb")).toBe("a b");
  });
  it("takes the server's unit over the column's name", () => {
    // COUNT(po.id) AS total_sales is a count, whatever "sales" sounds like.
    expect(fmtCell("total_sales", "Total Sales", 468, "num")).toBe("468");
    expect(fmtCell("avg", "Avg", 5862, "eur")).toBe("€5.862");
  });
    it("never prints [object Object] or €0 for an empty money cell", () => {
    expect(fmtCell("spesa", "Spesa", "")).toBe("—");
    expect(fmtCell("tags", "Tags", ["a", "b"])).toBe("a, b");
    expect(fmtCell("meta", "Meta", { a: 1 })).toBe('{"a":1}');
  });
});

describe("column kinds", () => {
  const rows = [{ n: "12.5", d: "2026-01-01", t: "x" }, { n: 3, d: null, t: "y" }];
  it("tells numbers, dates and text apart", () => {
    expect(isNumericCol(rows, "n")).toBe(true);
    expect(isDateCol(rows, "d")).toBe(true);
    expect(isNumericCol(rows, "t")).toBe(false);
    expect(parseIsoDate("not a date")).toBeNull();
  });
});

describe("KPI values read back for Excel", () => {
  it("parses what the KPI band shows", () => {
    expect(parseDisplayNumber("€3.159.612")).toEqual({ value: 3159612, money: true });
    expect(parseDisplayNumber("41")).toEqual({ value: 41, money: false });
    expect(parseDisplayNumber("-€500")).toEqual({ value: -500, money: true });
    expect(parseDisplayNumber("4/5")).toBeNull();
    expect(parseDisplayNumber("Roma")).toBeNull();
  });
});

describe("a pie", () => {
  it("folds everything past the seventh slice into Altro", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ label: `C${i}`, value: 12 - i }));
    const out = capSlices(data, "it");
    expect(out).toHaveLength(8);
    expect(out[7]).toEqual({ label: "Altro", value: 5 + 4 + 3 + 2 + 1 });
  });
});

describe("a chart of zeros", () => {
  it("is not data on screen, in the PDF or in the Excel", () => {
    expect(sectionHasData({ type: "bar", data: [{ label: "a", value: 0 }] })).toBe(false);
    expect(sectionHasData({ type: "bar", data: [{ label: "a", value: -3 }] })).toBe(true);
  });
});

describe("sheet names Excel accepts", () => {
  const rep = (...titles: string[]): ReportPayload => ({
    title: "t", generated_at: "2026-11-18T00:00:00Z", brand: null,
    sections: titles.map((title) => ({ type: "table", title, columns: [{ key: "a", header: "A" }], rows: [{ a: 1 }] })),
  });
  it("never repeats a name that differs only in case", () => {
    const names = sectionsToSheets(rep("Top clienti", "Top Clienti"), "it").map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(2);
  });
  it("never ends a cut name on an apostrophe, or uses History", () => {
    const [a, b] = sectionsToSheets(rep("Andamento delle vendite dell'anno", "History"), "it").map((s) => s.name);
    expect(a.endsWith("'")).toBe(false);
    expect(a.length).toBeLessThanOrEqual(31);
    expect(b.toLowerCase()).not.toBe("history");
  });
  it("marks the KPI summary so its values become numbers", () => {
    const sheets = sectionsToSheets({ title: "t", generated_at: "x", brand: null, sections: [{ type: "kpis", items: [{ label: "Ricavi", value: "€1.000" }] }] }, "it");
    expect(sheets[0].kpi).toBe(true);
  });
});

describe("file names", () => {
  it("fold accents instead of dropping letters, and keep other scripts", () => {
    expect(sanitizeFilename("Vendite per città")).toBe("Vendite_per_citta");
    expect(sanitizeFilename("报告")).toBe("报告");
  });
});

describe("PDF text", () => {
  it("keeps letters jsPDF's fonts can't draw readable", () => {
    expect(pdfSafe("Pečečnik")).toBe("Pececnik");
    expect(pdfSafe("Králová")).toBe("Králová");
    expect(pdfSafe("€ 9.800")).toBe("€ 9.800");
    expect(pdfSafe("王")).toBe("?");
  });
});
