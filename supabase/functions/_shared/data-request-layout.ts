// The data-request workbook's Data sheet, laid out down the page instead of across it.
//
// "I would put segment 2 below segment 1 and push down product mix (in case there are other
// segments)."
//
// The blank template puts segment 1 in columns A–C and segment 2 in E–G, side by side, with
// Product mix underneath both. That shape has a hard ceiling of two: a house with three
// categories in the pilot has nowhere to put the third, and every one of these houses has
// more than two. Stacked, the same block repeats as far down as it needs to.
//
// Done here rather than by re-cutting the .xlsx because the number of segments is then an
// INPUT — a three-category pilot gets a three-segment form — instead of another binary
// somebody has to re-upload. It also keeps the template's own formatting: the blocks are the
// template's own cells re-emitted at a new row, styles and all, not cells built from nothing.
//
// Pure string work on the sheet XML, so it is unit tested against the real blank workbook.

import { columnIndex, decodeXml } from "./xlsx-grid.ts";

export type StackResult = {
  xml: string;
  /** The string table, with any headings this had to invent appended. */
  shared: string[];
  /** What it did, for the review notes. Empty when the sheet was left alone. */
  notes: string[];
};

/** A row as it appears in the sheet, kept raw so styles survive the move. */
type Row = { n: number; attrs: string; cells: { ref: string; xml: string }[] };

const MAX_SEGMENTS = 8;

/**
 * Restack the Data sheet for `segments` segments.
 *
 * Returns the sheet unchanged, with a note, whenever it cannot find the shape it expects —
 * a revised template must not come out mangled, and the generator has a "the template was
 * revised since it was mapped" path already.
 */
export function stackSegments(sheetXml: string, shared: string[], segments: number): StackResult {
  const want = Math.max(1, Math.min(MAX_SEGMENTS, Math.round(segments || 2)));
  const rows = parseRows(sheetXml);
  if (!rows.length) return { xml: sheetXml, shared, notes: ["the Data sheet has no rows to lay out"] };

  const text = (cellXml: string): string => {
    const t = /\bt="([^"]+)"/.exec(cellXml)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
    if (t === "s" && v != null) return shared[Number(v)] ?? "";
    if (t === "inlineStr") {
      let s = "";
      for (const m of cellXml.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) s += decodeXml(m[1] ?? "");
      return s;
    }
    return "";
  };
  const inColumnA = (row: Row): string => {
    const cell = row.cells.find((c) => columnIndex(c.ref) === 0);
    return cell ? text(cell.xml).trim() : "";
  };

  // The two landmarks. Everything between them is one segment block; everything from the
  // second one down is the product mix that has to move under the last block.
  const headRow = rows.find((r) => /segment\s*1\b/i.test(inColumnA(r)));
  const mixRow = rows.find((r) => /^product mix\b/i.test(inColumnA(r)));
  if (!headRow || !mixRow || mixRow.n <= headRow.n) {
    return {
      xml: sheetXml, shared,
      notes: ["the Data sheet is not in the layout this knows how to restack (no \"segment 1\" heading, or no \"Product mix\" under it) — left exactly as the template has it"],
    };
  }

  // The block is the segment's own columns only. Columns D and beyond on those rows are the
  // side-by-side segment 2, which is what this is replacing.
  const block = rows
    .filter((r) => r.n >= headRow.n && r.n < mixRow.n)
    .map((r) => ({ ...r, cells: r.cells.filter((c) => columnIndex(c.ref) <= 2) }))
    .filter((r) => r.cells.length > 0);
  if (!block.length) return { xml: sheetXml, shared, notes: ["the segment block on the Data sheet is empty — left as it is"] };

  const first = block[0].n;
  const last = block[block.length - 1].n;
  const height = last - first + 2;   // the block, plus one blank row between blocks

  const before = rows.filter((r) => r.n < headRow.n);
  const mixOnwards = rows.filter((r) => r.n >= mixRow.n);

  const shared2 = [...shared];
  const out: Row[] = [...before];

  for (let i = 0; i < want; i++) {
    const shift = i * height;
    for (const r of block) {
      const cells = r.cells.map((c) => ({
        ref: shiftRef(c.ref, shift),
        xml: shiftCell(c.xml, shift),
      }));
      // Each block says which segment it is. Segment 1 keeps the template's own string; the
      // rest get one appended to the table, which is how a shared string is added.
      if (r.n === headRow.n && i > 0) {
        const head = cells[0];
        if (head) {
          const label = inColumnA(headRow).replace(/segment\s*1\b/i, `segment ${i + 1}`);
          shared2.push(label);
          head.xml = setSharedIndex(head.xml, shared2.length - 1);
        }
      }
      out.push({ n: r.n + shift, attrs: shiftRowAttrs(r.attrs, shift), cells });
    }
  }

  // Product mix, and anything under it, below the last block.
  const mixShift = (want - 1) * height;
  for (const r of mixOnwards) {
    out.push({
      n: r.n + mixShift,
      attrs: shiftRowAttrs(r.attrs, mixShift),
      cells: r.cells.map((c) => ({ ref: shiftRef(c.ref, mixShift), xml: shiftCell(c.xml, mixShift) })),
    });
  }

  const body = out
    .sort((a, b) => a.n - b.n)
    .map((r) => `<row${r.attrs}>${r.cells.map((c) => c.xml).join("")}</row>`)
    .join("");

  let xml = sheetXml.replace(/<sheetData\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetData>)/, `<sheetData>${body}</sheetData>`);
  xml = restackMerges(xml, { first, last, height, want, mixFrom: mixRow.n, mixShift });
  // A stale dimension makes Excel scroll to a range that no longer holds anything.
  xml = xml.replace(/<dimension\b[^>]*\/>/, "");

  return {
    xml, shared: shared2,
    notes: [
      `Data sheet laid out for ${want} segment${want === 1 ? "" : "s"}, one under the other, with Product mix below them.`,
    ],
  };
}

// ── The string table, once this has added to it ─────────────────────────────────────────
/** sharedStrings.xml with the appended entries, and a count that matches. */
export function rewriteSharedStrings(xml: string, shared: string[], added: string[]): string {
  if (!added.length) return xml;
  const items = added.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join("");
  const total = shared.length;
  return xml
    .replace(/<\/sst>/, `${items}</sst>`)
    .replace(/<sst\b([^>]*)>/, (m, attrs: string) =>
      `<sst${attrs.replace(/\bcount="\d+"/, `count="${total}"`).replace(/\buniqueCount="\d+"/, `uniqueCount="${total}"`)}>`);
}

// ── Row and cell surgery ────────────────────────────────────────────────────────────────

function parseRows(sheetXml: string): Row[] {
  const rows: Row[] = [];
  for (const m of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = m[1] ?? "";
    const n = Number(/\br="(\d+)"/.exec(attrs)?.[1] ?? 0);
    if (!n) continue;
    const cells: { ref: string; xml: string }[] = [];
    for (const c of (m[2] ?? "").matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/i.exec(c[0])?.[1];
      if (ref) cells.push({ ref, xml: c[0] });
    }
    rows.push({ n, attrs, cells });
  }
  return rows;
}

/** "B14" + 18 -> "B32". */
function shiftRef(ref: string, by: number): string {
  return ref.replace(/^([A-Z]+)(\d+)$/i, (_, col: string, n: string) => `${col}${Number(n) + by}`);
}

function shiftCell(cellXml: string, by: number): string {
  return cellXml.replace(/\br="([A-Z]+\d+)"/i, (_, ref: string) => `r="${shiftRef(ref, by)}"`);
}

function shiftRowAttrs(attrs: string, by: number): string {
  // `spans` is a hint Excel recomputes; dropping it is safer than shifting it wrongly.
  return attrs
    .replace(/\br="(\d+)"/, (_, n: string) => `r="${Number(n) + by}"`)
    .replace(/\s*spans="[^"]*"/, "");
}

/** Point a shared-string cell at a different entry, making it one if it was not typed. */
function setSharedIndex(cellXml: string, index: number): string {
  const withType = /\bt="s"/.test(cellXml)
    ? cellXml
    : cellXml.replace(/^<c\b([^>]*?)(\/?)>/, (_, attrs: string, selfClose: string) =>
        `<c${attrs} t="s"${selfClose}>`);
  if (/<v>[\s\S]*?<\/v>/.test(withType)) {
    return withType.replace(/<v>[\s\S]*?<\/v>/, `<v>${index}</v>`);
  }
  // A self-closing empty cell has to become a real one to hold a value.
  return withType.replace(/<c\b([^>]*?)\/>/, (_, attrs: string) => `<c${attrs}><v>${index}</v></c>`);
}

/**
 * Merged ranges, moved with the rows they belong to.
 *
 * A merge left pointing at its old row is not cosmetic: Excel refuses to open a workbook
 * whose merges overlap, and a block copied four times with the original merge still in place
 * is four overlaps.
 */
function restackMerges(
  xml: string,
  at: { first: number; last: number; height: number; want: number; mixFrom: number; mixShift: number },
): string {
  const m = /<mergeCells\b[^>]*?(?:\/>|>([\s\S]*?)<\/mergeCells>)/.exec(xml);
  if (!m) return xml;

  const refs = [...(m[1] ?? "").matchAll(/ref="([A-Z]+\d+):([A-Z]+\d+)"/g)]
    .map((r) => ({ from: r[1], to: r[2] }));

  const kept: string[] = [];
  for (const r of refs) {
    const row = Number(/\d+$/.exec(r.from)?.[0] ?? 0);
    const startsInBlock = row >= at.first && row <= at.last;
    // A merge in the block belongs to columns A–C only; the E–G ones were segment 2's and
    // the rows they described no longer exist.
    if (startsInBlock) {
      if (columnIndex(r.from) > 2) continue;
      for (let i = 0; i < at.want; i++) {
        const shift = i * at.height;
        kept.push(`<mergeCell ref="${shiftRef(r.from, shift)}:${shiftRef(r.to, shift)}"/>`);
      }
      continue;
    }
    if (row >= at.mixFrom) {
      kept.push(`<mergeCell ref="${shiftRef(r.from, at.mixShift)}:${shiftRef(r.to, at.mixShift)}"/>`);
      continue;
    }
    kept.push(`<mergeCell ref="${r.from}:${r.to}"/>`);
  }

  const replacement = kept.length
    ? `<mergeCells count="${kept.length}">${kept.join("")}</mergeCells>`
    : "";
  return xml.replace(/<mergeCells\b[^>]*?(?:\/>|>[\s\S]*?<\/mergeCells>)/, replacement);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
