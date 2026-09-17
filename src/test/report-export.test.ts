import { describe, it, expect, vi, beforeEach } from "vitest";
import { sectionHasData, sectionsToSheets, type ReportPayload } from "../components/assistant/ReportView";
import { downloadXlsx } from "../lib/reportExport";

// The assistant's "download it as Excel" promise. A custom report runs one SQL
// query per section; when a query matches nothing the section used to be kept
// anyway, with no columns and no rows. On screen that is a headerless table; in
// the workbook it is a sheet with nothing in it — the associate asks for the
// contacts of her top clients, is told the report is ready, and opens a blank
// file. These are the cases that decide whether that can happen again.

const report = (...sections: ReportPayload["sections"]): ReportPayload => ({
  title: "Top clienti Milano", generated_at: "2026-09-17T09:00:00Z", brand: "Brand", sections,
});

const CLIENTS = report({
  type: "table", title: "Top clienti Milano",
  columns: [{ key: "name", header: "Nome" }, { key: "email", header: "Email" }],
  rows: [{ name: "Giulia Rossi", email: "g@example.it" }, { name: "Anna Bianchi", email: "a@example.it" }],
});

describe("a section with nothing in it", () => {
  it("is not data, whatever its type says", () => {
    expect(sectionHasData({ type: "table", columns: [], rows: [] })).toBe(false);
    // Rows with no columns: every column the query returned was an id, so there
    // is nothing left to print — a sheet of invisible cells.
    expect(sectionHasData({ type: "table", columns: [], rows: [{ id: 1 }] })).toBe(false);
    expect(sectionHasData({ type: "bar", data: [] })).toBe(false);
    expect(sectionHasData({ type: "products", items: [] })).toBe(false);
    expect(sectionHasData({ type: "kpis", items: [] })).toBe(false);
    expect(sectionHasData({ type: "note", body: "  " })).toBe(false);
  });

  it("is data when there is something to show", () => {
    expect(sectionHasData(CLIENTS.sections[0])).toBe(true);
    expect(sectionHasData({ type: "note", body: "Non riconciliato." })).toBe(true);
  });
});

describe("sections to sheets", () => {
  it("leaves out the empty sections instead of writing blank sheets", () => {
    const sheets = sectionsToSheets(
      report(
        { type: "table", title: "Nessun match", columns: [], rows: [] },
        CLIENTS.sections[0],
      ),
      "it",
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Top clienti Milano");
    expect(sheets[0].rows).toHaveLength(2);
  });

  it("returns no sheets at all rather than a placeholder workbook", () => {
    // The old fallback was one sheet headed "—" with zero rows, which is
    // indistinguishable, once downloaded, from a broken export.
    expect(sectionsToSheets(report({ type: "note", body: "Niente da mostrare." }), "it")).toEqual([]);
    expect(sectionsToSheets(report(), "it")).toEqual([]);
  });

  it("still keeps a KPI row, a chart and product cards", () => {
    const sheets = sectionsToSheets(
      report(
        { type: "kpis", items: [{ label: "Spesa", value: "€12.000" }] },
        { type: "pie", title: "Per città", data: [{ label: "Milano", value: 3 }] },
        { type: "products", title: "Pezzi", items: [{ name: "Abito" }] },
      ),
      "it",
    );
    expect(sheets.map((s) => s.name)).toEqual(["Riepilogo", "Per città", "Pezzi"]);
  });
});

describe("downloading the workbook", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
  });

  it("refuses to save a file with no rows in it", async () => {
    await expect(downloadXlsx([], "report")).rejects.toThrow(/no data/i);
    await expect(downloadXlsx([{ name: "Vuoto", columns: [], rows: [] }], "report")).rejects.toThrow(/no data/i);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("writes a real workbook when there is something to write", async () => {
    await downloadXlsx(sectionsToSheets(CLIENTS, "it"), "Top clienti");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls[0][0];
    expect(blob.type).toMatch(/spreadsheetml/);
    expect(blob.size).toBeGreaterThan(1000); // a real xlsx zip, not an empty shell
  });
});
