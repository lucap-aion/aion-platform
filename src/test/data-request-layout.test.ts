import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { stackSegments, rewriteSharedStrings } from "../../supabase/functions/_shared/data-request-layout.ts";
import { sharedStrings, sheetGrid } from "../../supabase/functions/_shared/xlsx-grid.ts";

// Against the REAL blank workbook, not a fixture. The thing being tested is a transformation
// of a specific file whose shape nobody controls from here — a handmade fixture would prove
// the transformation works on a sheet written to make it work.
const BLANK = resolve(__dirname, "../../docs/templates/AION_Data_Request_Pilot_Blank.xlsx");

async function dataSheet(segments: number) {
  const zip = await JSZip.loadAsync(readFileSync(BLANK));
  const ssXml = await zip.file("xl/sharedStrings.xml")!.async("string");
  const shared = sharedStrings(ssXml);
  // sheet2 is "Data" in this workbook; the generator resolves it through the rels.
  const xml = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  const out = stackSegments(xml, shared, segments);
  return { ...out, before: { xml, shared, ssXml } };
}

/** Column A down the sheet, so a layout can be asserted in words. */
const labels = (grid: string[][]) =>
  grid.map((r, i) => [i + 1, (r[0] ?? "").trim()] as const).filter(([, v]) => v);

describe("the data request's Data sheet, stacked", () => {
  it("puts segment 2 under segment 1 and pushes product mix below both", async () => {
    const { xml, shared, notes } = await dataSheet(2);
    const rowsOf = labels(sheetGrid(xml, shared));

    const seg1 = rowsOf.find(([, v]) => /segment 1\b/i.test(v));
    const seg2 = rowsOf.find(([, v]) => /segment 2\b/i.test(v));
    const mix = rowsOf.find(([, v]) => /^product mix/i.test(v));

    expect(seg1, "segment 1 heading").toBeTruthy();
    expect(seg2, "segment 2 heading").toBeTruthy();
    expect(mix, "product mix heading").toBeTruthy();
    // Down the page, in order, which is the whole request.
    expect(seg2![0]).toBeGreaterThan(seg1![0]);
    expect(mix![0]).toBeGreaterThan(seg2![0]);
    expect(notes.join(" ")).toMatch(/2 segments/);
  });

  it("gives every segment the same questions", async () => {
    const { xml, shared } = await dataSheet(3);
    const grid = sheetGrid(xml, shared);
    const rowsOf = labels(grid);

    for (const q of ["Revenues - €", "Total units sold - n.", "Distribution channels", "Volumes by price range"]) {
      expect(rowsOf.filter(([, v]) => v === q), `"${q}" once per segment`).toHaveLength(3);
    }
    expect(rowsOf.filter(([, v]) => /^Company information/i.test(v))).toHaveLength(3);
    expect(rowsOf.map(([, v]) => v).filter((v) => /segment 3\b/i.test(v))).toHaveLength(1);
  });

  it("carries the questions above the segments through untouched", async () => {
    const { xml, shared } = await dataSheet(2);
    const rowsOf = labels(sheetGrid(xml, shared));
    // Focus is the line the founder read as wrong; it is also the one with a placeholder in
    // it, so losing it would ship a workbook with a literal {{BRAND_FOCUS}} in the header.
    expect(rowsOf.find(([, v]) => v === "Focus")?.[0]).toBe(3);
    for (const q of ["Geography Pilot", "Geography Full Roll out", "Time for Roll out"]) {
      expect(rowsOf.some(([, v]) => v === q), q).toBe(true);
    }
  });

  it("leaves no merged range overlapping another", async () => {
    // Excel refuses to open a workbook whose merges overlap, and a block repeated N times
    // with the original merge left behind is N overlaps. This is the failure that would
    // reach a client as "the file is corrupt".
    const { xml } = await dataSheet(4);
    const refs = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)]
      .map((m) => ({ c1: m[1], r1: Number(m[2]), c2: m[3], r2: Number(m[4]) }));
    expect(refs.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const r of refs) {
      for (let row = r.r1; row <= r.r2; row++) {
        // Column ranges here are always within one row band and narrow; the cell keys are
        // enough to catch a repeated block.
        const key = `${r.c1}${r.c2}${row}`;
        expect(seen.has(key), `merge ${r.c1}${r.r1}:${r.c2}${r.r2} overlaps another`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("still opens as a workbook, and the string table still matches", async () => {
    const { xml, shared, before } = await dataSheet(3);
    const ssXml = rewriteSharedStrings(before.ssXml, shared, shared.slice(before.shared.length));

    const zip = await JSZip.loadAsync(readFileSync(BLANK));
    zip.file("xl/worksheets/sheet2.xml", xml);
    zip.file("xl/sharedStrings.xml", ssXml);
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const reopened = await JSZip.loadAsync(bytes);
    const reShared = sharedStrings(await reopened.file("xl/sharedStrings.xml")!.async("string"));
    const reGrid = sheetGrid(await reopened.file("xl/worksheets/sheet2.xml")!.async("string"), reShared);
    // Every index a cell points at has to exist in the table, or Excel shows blanks where
    // the headings were.
    expect(reShared.length).toBe(shared.length);
    expect(labels(reGrid).filter(([, v]) => /segment 3\b/i.test(v))).toHaveLength(1);
    // The declared count has to agree with what is in the file.
    const declared = /uniqueCount="(\d+)"/.exec(await reopened.file("xl/sharedStrings.xml")!.async("string"))?.[1];
    if (declared) expect(Number(declared)).toBe(reShared.length);
  });

  it("refuses to touch a sheet it does not recognise", async () => {
    // A revised template must come out exactly as it went in, with a note, rather than
    // rearranged into something nobody designed.
    const { shared } = await dataSheet(2);
    const foreign = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`;
    const out = stackSegments(foreign, shared, 3);
    expect(out.xml).toBe(foreign);
    expect(out.notes.join(" ")).toMatch(/left exactly as the template has it/);
  });
});
