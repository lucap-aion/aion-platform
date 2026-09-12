import { describe, it, expect } from "vitest";
import {
  sharedStrings, sheetGrid, columnIndex, parseNumber, mapCategory, mapCoverage,
  extractPerimeter, filledNumericCells, type Sheet,
} from "../../supabase/functions/_shared/xlsx-grid.ts";

// The reader that turns a client's returned data-request workbook into a pricing
// perimeter. These are the cases that decide whether a figure reaches the business case
// as what the client meant — the ones where being wrong is silent.

const si = (...runs: string[]) => `<si>${runs.map((r) => `<t>${r}</t>`).join("")}</si>`;
const sst = (...items: string[]) => `<sst count="${items.length}">${items.join("")}</sst>`;

/** A worksheet whose cells are given as "A1"-style refs, strings held in `shared`. */
function sheetXml(cells: Record<string, { v: string; s?: boolean }>): string {
  const byRow = new Map<number, string[]>();
  for (const [ref, cell] of Object.entries(cells)) {
    const row = Number(/\d+/.exec(ref)![0]);
    const xml = cell.s
      ? `<c r="${ref}" t="s"><v>${cell.v}</v></c>`
      : `<c r="${ref}"><v>${cell.v}</v></c>`;
    byRow.set(row, [...(byRow.get(row) ?? []), xml]);
  }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, cs]) => `<row r="${n}">${cs.join("")}</row>`).join("");
  return `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

describe("shared strings", () => {
  it("concatenates the runs of one string instead of taking the first", () => {
    // "Total **covered** revenue" is three runs because someone bolded a word. Taking
    // run[0] would give "Total ", which matches no column pattern at all.
    const xml = sst(si("Total ", "covered", " revenue"), si("Jewellery"));
    expect(sharedStrings(xml)).toEqual(["Total covered revenue", "Jewellery"]);
  });

  it("decodes entities and keeps empty strings in position", () => {
    const xml = sst(si("Bags &amp; Watches"), "<si/>", si("Apparel"));
    expect(sharedStrings(xml)).toEqual(["Bags & Watches", "", "Apparel"]);
  });
});

describe("cell placement", () => {
  it("maps column letters past Z", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("BC7")).toBe(54);
  });

  it("fills the gaps left by absent cells", () => {
    // An empty cell is usually absent from the file, not blank. Appending in document
    // order would shift D into B's place and read the wrong column as revenue.
    const grid = sheetGrid(sheetXml({ A1: { v: "0", s: true }, D1: { v: "1", s: true } }), ["name", "value"]);
    expect(grid[0]).toEqual(["name", "", "", "value"]);
  });

  it("places rows by their row number, not by arrival", () => {
    const grid = sheetGrid(sheetXml({ A1: { v: "0", s: true }, A4: { v: "1", s: true } }), ["header", "data"]);
    expect(grid).toHaveLength(4);
    expect(grid[1]).toEqual([]);
    expect(grid[3]).toEqual(["data"]);
  });

  it("ignores a stray cell far below the used range", () => {
    const grid = sheetGrid(sheetXml({ A1: { v: "0", s: true }, A99999: { v: "1", s: true } }), ["header", "junk"]);
    expect(grid.length).toBeLessThanOrEqual(2000);
  });

  it("reads a formula's cached value, never its expression", () => {
    const xml = `<worksheet><sheetData><row r="1"><c r="A1"><f>B1*C1</f><v>4200</v></c></row></sheetData></worksheet>`;
    expect(sheetGrid(xml, [])[0][0]).toBe("4200");
  });
});

describe("numbers as people write them", () => {
  it("reads both separator conventions the same way", () => {
    expect(parseNumber("12.000.000")).toBe(12_000_000);
    expect(parseNumber("12,000,000")).toBe(12_000_000);
    expect(parseNumber("€ 12.000.000,50")).toBe(12_000_000.5);
    expect(parseNumber("$12,000,000.50")).toBe(12_000_000.5);
    expect(parseNumber("1 200 000")).toBe(1_200_000);
  });

  it("treats a lone separator with three digits after it as thousands", () => {
    // The case that matters: "12.000" in an Italian workbook is twelve thousand. Reading
    // it as twelve understates a perimeter by a factor of a thousand, and the premium
    // that comes out looks plausible.
    expect(parseNumber("12.000")).toBe(12000);
    expect(parseNumber("12,000")).toBe(12000);
    expect(parseNumber("12.50")).toBe(12.5);
    expect(parseNumber("0,30")).toBe(0.3);
  });

  it("turns a percentage into a ratio", () => {
    expect(parseNumber("30%")).toBeCloseTo(0.3);
  });

  it("returns null rather than zero for something that is not a number", () => {
    // Zero would price as a real segment worth nothing; null skips it.
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("TBC")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
});

describe("mapping the client's words", () => {
  it("recognises the categories the model prices", () => {
    expect(mapCategory("High Jewellery").category).toBe("jewellery");
    expect(mapCategory("Alta gioielleria").category).toBe("jewellery");
    expect(mapCategory("Orologi").category).toBe("watches");
    expect(mapCategory("Handbags").category).toBe("bags");
    expect(mapCategory("Ready-to-wear").category).toBe("apparel");
  });

  it("reads leather goods as leather, not as bags or apparel", () => {
    expect(mapCategory("Small leather goods").category).toBe("leather");
    expect(mapCategory("Pelletteria").category).toBe("leather");
  });

  it("says when it did not recognise the category rather than guessing", () => {
    const out = mapCategory("Homeware");
    expect(out.category).toBe("other");
    expect(out.matched).toBe(false);
  });

  it("reads the cover, and admits when it was not stated", () => {
    expect(mapCoverage("Theft only").coverage).toBe("theft");
    expect(mapCoverage("Furto").coverage).toBe("theft");
    expect(mapCoverage("Theft and accidental damage")).toMatchObject({ coverage: "theft_and_damage", stated: true });
    expect(mapCoverage("Furto e danni parziali")).toMatchObject({ coverage: "theft_and_damage", damage_scope: "partial" });
    expect(mapCoverage("")).toMatchObject({ coverage: "theft_and_damage", stated: false });
  });
});

describe("extracting a perimeter", () => {
  const tableSheet = (): Sheet => ({
    name: "Perimeter",
    grid: [
      ["Pilot data request", "", "", ""],
      [],
      ["Segment", "Category", "Covered revenue", "Average price", "COGS", "Coverage"],
      ["Pilot — EU", "High Jewellery", "12.000.000", "4.200", "30%", "Theft and accidental damage"],
      ["Roll-out — US", "Orologi", "8.500.000", "6.000", "0,28", "Furto"],
      ["Total", "", "20.500.000", "", "", ""],
    ],
  });

  it("reads each row of a table as a segment", () => {
    const out = extractPerimeter([tableSheet()]);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({
      name: "Pilot — EU", category: "jewellery", coverage: "theft_and_damage",
      revenues: 12_000_000, avg_price: 4200, cogs_ratio: 0.3,
    });
    expect(out.segments[1]).toMatchObject({ category: "watches", coverage: "theft", revenues: 8_500_000, cogs_ratio: 0.28 });
  });

  it("skips the totals row, and says it did", () => {
    // Counting it would double the perimeter — twice the premium, on a slide nobody
    // re-derives.
    const out = extractPerimeter([tableSheet()]);
    expect(out.segments.map((s) => s.name)).not.toContain("Total");
    expect(out.notes.some((n) => /totals row/i.test(n))).toBe(true);
  });

  it("records where each figure came from", () => {
    const out = extractPerimeter([tableSheet()]);
    expect(out.segments[0].source).toBe("Perimeter!row 4");
  });

  it("derives revenue from units x average price when no revenue column exists", () => {
    const out = extractPerimeter([{
      name: "Scope",
      grid: [
        ["Category", "Pieces", "Average price"],
        ["Bags", "2.000", "1.500"],
      ],
    }]);
    expect(out.segments[0].revenues).toBe(3_000_000);
    expect(out.notes.some((n) => /units x average price/i.test(n))).toBe(true);
  });

  it("falls back to a form layout and says the perimeter is a single segment", () => {
    const out = extractPerimeter([{
      name: "Data request",
      grid: [
        ["Question", "Answer"],
        ["Categories in scope", "Alta gioielleria"],
        ["Total covered revenue (36 months)", "€ 12.000.000"],
        ["Average retail price", "4.200"],
        ["Coverage requested", "Furto e danni"],
      ],
    }]);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toMatchObject({ category: "jewellery", revenues: 12_000_000, avg_price: 4200 });
    expect(out.notes.some((n) => /form rather than a table/i.test(n))).toBe(true);
  });

  it("prefers a table over a form when the workbook has both", () => {
    const form: Sheet = { name: "Intro", grid: [["Total covered revenue", "999"]] };
    const out = extractPerimeter([form, tableSheet()]);
    expect(out.segments).toHaveLength(2);
  });

  it("names its assumptions instead of burying them", () => {
    const out = extractPerimeter([{
      name: "Scope",
      grid: [["Segment", "Covered revenue"], ["Pilot", "5.000.000"]],
    }]);
    expect(out.segments[0].cogs_ratio).toBeNull();
    expect(out.notes.some((n) => /COGS ratio/i.test(n))).toBe(true);
    expect(out.notes.some((n) => /average price/i.test(n))).toBe(true);
    expect(out.notes.some((n) => /client's own file/i.test(n))).toBe(true);
  });

  it("returns nothing, loudly, when the workbook holds no perimeter", () => {
    const out = extractPerimeter([{ name: "Instructions", grid: [["Please complete every tab."], ["Contact: ops@aion"]] }]);
    expect(out.segments).toEqual([]);
    expect(out.notes[0]).toMatch(/Nothing in this workbook reads as a perimeter/);
    expect(out.scanned).toEqual(["Instructions"]);
  });
});

// ── The outgoing workbook ────────────────────────────────────────────────────────────────
// The data request has to leave EMPTY. It did not: the registered template was the first
// house's own returned file, the generator swapped three strings in it, and every figure
// they had typed went out in a workbook addressed to somebody else — with no name left in
// it for a name-matching check to catch.
describe("figures left in an outgoing form", () => {
  it("finds the numbers somebody typed, and says which cells", () => {
    const xml = sheetXml({
      A9: { v: "7", s: true },      // "Revenues - €", a label
      B9: { v: "1031006" },         // the previous client's revenue
      B10: { v: "267" },
      A19: { v: "8", s: true },
    });
    expect(filledNumericCells(xml)).toEqual(["B9", "B10"]);
  });

  it("passes a blank form, formulas and self-closing cells included", () => {
    const xml =
      `<worksheet><sheetData>` +
      `<row r="9"><c r="A9" t="s"><v>7</v></c><c r="B9" s="4"/></row>` +
      // A template keeps its own arithmetic: a formula with no cached result is not an answer.
      `<row r="11"><c r="A11" t="s"><v>8</v></c><c r="B11" s="4"><f>B9/B10</f></c></row>` +
      // Nor is a formula whose result is text.
      `<row r="12"><c r="B12" t="str"><f>A1&amp;""</f><v>x</v></c></row>` +
      `</sheetData></worksheet>`;
    expect(filledNumericCells(xml)).toEqual([]);
  });

  it("does catch a formula that cached a number, because that number is somebody's", () => {
    const xml = `<worksheet><sheetData><row r="25">` +
      `<c r="B25" s="4"><f>SUM(B20:B24)</f><v>267</v></c>` +
      `</row></sheetData></worksheet>`;
    expect(filledNumericCells(xml)).toEqual(["B25"]);
  });
});
