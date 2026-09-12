// ==============================|| READING A WORKBOOK BACK ||============================== //
// Turning the client's returned data-request workbook into a pricing perimeter.
//
// AION generates the workbook, sends it, the client fills it in and sends it back — and
// then someone retypes its contents into the business case by hand, eight fields per
// segment. That is where the two hours in "Business Case / Pricing (2h)" actually go, and
// it is the one part of the cycle the platform never touched.
//
// This does not try to be a spreadsheet engine. It reads the cells, finds the numbers that
// look like a perimeter, and proposes segments for a human to check. Every guess it makes
// is reported in `notes`, because a silently wrong revenue figure is far worse than an
// obviously missing one: the whole point is that somebody reads what came out.
//
// No imports on purpose. JSZip lives in the caller, so everything here is a pure function
// over strings and can be unit-tested from the frontend test suite.

// ── XML ────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
};

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * The workbook's string table. A cell with t="s" holds an index into this.
 *
 * Each <si> may be split into several <t> runs when part of the text is formatted
 * differently — "Total **covered** revenue" is three runs — so the runs are concatenated
 * rather than the first one taken, which would silently truncate exactly the headers that
 * someone bothered to emphasise.
 */
export function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    const body = m[1] ?? "";
    let text = "";
    for (const t of body.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += decodeXml(t[1] ?? "");
    out.push(text);
  }
  return out;
}

/** "BC" -> 54. Column letters are base-26 with no zero. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1] ?? "";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * One sheet as a dense grid of display strings.
 *
 * Cells are sparse in the file — an empty cell is usually absent rather than blank — so
 * the row is placed by its `r` attribute and the gaps filled, otherwise a column offset by
 * one blank cell reads as belonging to its neighbour.
 */
export function sheetGrid(sheetXml: string, shared: string[], maxRows = 2000): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = rowMatch[1] ?? "";
    const body = rowMatch[2] ?? "";
    const rowNum = Number(/\br="(\d+)"/.exec(attrs)?.[1] ?? 0);
    // A single stray cell far down a sheet would otherwise have the gap filled all the way
    // to it — a formatted-to-row-100000 workbook is common and would allocate for nothing.
    if (rowNum > maxRows || rows.length >= maxRows) continue;
    const cells: string[] = [];
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cAttrs = cellMatch[1] ?? "";
      const cBody = cellMatch[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(cAttrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/.exec(cAttrs)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        for (const t of cBody.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) value += decodeXml(t[1] ?? "");
      } else {
        // <v> only. A formula's <f> is the expression, not the result, and reading it
        // would put "=B4*C4" where a number belongs.
        const raw = decodeXml(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cBody)?.[1] ?? "");
        value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
      }
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value.trim();
    }
    if (rowNum > 0) {
      while (rows.length < rowNum - 1) rows.push([]);
      rows[rowNum - 1] = cells;
    } else {
      rows.push(cells);
    }
  }
  return rows;
}

export type Sheet = { name: string; grid: string[][] };

// ── Numbers as people write them ───────────────────────────────────────────────────────

/**
 * "€ 12.000.000,50", "12,000,000.50", "1 200 000" and "30%" all mean something.
 *
 * The separator ambiguity is resolved by position, not by locale: whichever of "." and ","
 * appears LAST is the decimal point, because no thousands separator ever follows the
 * decimal one. A lone separator with exactly three digits after it is thousands — "12.000"
 * is twelve thousand in the workbooks these clients send, not twelve.
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const isPercent = /%/.test(raw);
  let s = raw.replace(/[^\d.,\-]/g, "");
  if (!s || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    const whole = s.slice(0, decimalAt).replace(/[.,]/g, "");
    const frac = s.slice(decimalAt + 1).replace(/[.,]/g, "");
    s = `${whole}.${frac}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const sep = s[at];
    const after = s.slice(at + 1);
    const occurrences = s.split(sep).length - 1;
    // One separator, exactly three digits after it, and no other -> thousands.
    s = occurrences === 1 && after.length !== 3
      ? `${s.slice(0, at).replace(/[.,]/g, "")}.${after}`
      : s.replace(/[.,]/g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return isPercent ? n / 100 : n;
}

// ── What a column might be ─────────────────────────────────────────────────────────────
// English and Italian both: these workbooks come back in whichever language the client's
// finance team works in, and a data request that only reads one of them is half a feature.

const COLUMN_PATTERNS: { key: PerimeterField; re: RegExp }[] = [
  { key: "category", re: /categor|tipolog|product\s*(type|line)|linea\s*prodott/i },
  { key: "revenues", re: /revenue|turnover|sales|gmv|fatturat|ricav|volume|covered\s*value|valore\s*copert/i },
  { key: "units", re: /\bunits?\b|pieces|pezzi|quantit|\bqty\b|n\.?\s*(of\s*)?(items|pieces)/i },
  { key: "avg_price", re: /average|\bavg\b|\bmean\b|medio|media|prezzo\s*medio/i },
  { key: "cogs", re: /\bcogs\b|cost\s*of\s*goods|costo\s*del\s*venduto|\bcosto\b|margin|margine/i },
  { key: "coverage", re: /coverage|copertura|\bcover\b|theft|furto|damage|danni?\b/i },
  { key: "start", re: /start(\s*month)?|inizio|decorrenza|from\s*month/i },
  // Last: the loosest pattern, so a column called "Product category" is a category and not
  // a name. Order in this list is precedence.
  { key: "name", re: /segment|perimeter|perimetro|scope|\bline\b|linea|descri|\bname\b|\bnome\b/i },
];

type PerimeterField = "name" | "category" | "revenues" | "units" | "avg_price" | "cogs" | "coverage" | "start";

function fieldFor(header: string): PerimeterField | null {
  const h = header.trim();
  if (!h) return null;
  for (const p of COLUMN_PATTERNS) if (p.re.test(h)) return p.key;
  return null;
}

const CATEGORY_PATTERNS: { category: string; re: RegExp }[] = [
  { category: "jewellery", re: /jewel|gioiell|gioell|bijou|high\s*jewel|alta\s*gioiell/i },
  { category: "watches", re: /watch|orolog|timepiece/i },
  // Before bags AND before apparel: "small leather goods" and "leather bags" are both
  // real answers, and the first word that matches wins.
  { category: "leather", re: /leather|pellett|slg\b/i },
  { category: "bags", re: /\bbags?\b|handbag|borse|borsa/i },
  { category: "apparel", re: /apparel|clothing|ready[\s-]*to[\s-]*wear|\brtw\b|abbigliament|silk|seta|scarf|foulard|tie\b|cravatt/i },
];

export function mapCategory(raw: string): { category: string; matched: boolean } {
  for (const p of CATEGORY_PATTERNS) if (p.re.test(raw)) return { category: p.category, matched: true };
  return { category: "other", matched: false };
}

export function mapCoverage(raw: string): { coverage: string; damage_scope: string; stated: boolean } {
  const damage = /damage|danni?\b|accidental|accidental/i.test(raw);
  const theft = /theft|furto|stolen/i.test(raw);
  const scope = /partial|parzial/i.test(raw) ? "partial" : /total|totale|full/i.test(raw) ? "total" : "";
  if (damage) return { coverage: "theft_and_damage", damage_scope: scope, stated: true };
  if (theft) return { coverage: "theft", damage_scope: "", stated: true };
  return { coverage: "theft_and_damage", damage_scope: scope, stated: false };
}

// ── The perimeter ──────────────────────────────────────────────────────────────────────

export type ExtractedSegment = {
  name: string;
  category: string;
  coverage: string;
  damage_scope: string;
  revenues: number;
  cogs_ratio: number | null;
  avg_price: number | null;
  start_month: number;
  /** Where in the workbook this came from, so a figure can be traced back. */
  source: string;
};

export type Extraction = {
  segments: ExtractedSegment[];
  notes: string[];
  /** Sheets the reader actually looked at, whether or not it found anything. */
  scanned: string[];
};

const COGS_DEFAULT = 0.3;

/** A COGS figure may arrive as 0.3, as 30, or as "30%". Anything above 1 is a percentage. */
function normaliseCogs(n: number | null): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const ratio = n > 1 ? n / 100 : n;
  return ratio > 0 && ratio < 1 ? ratio : null;
}

const isBlankRow = (row: string[] | undefined) => !row || row.every((c) => !c.trim());

/**
 * Layout 1: a table. A header row naming the columns, then one row per segment.
 *
 * Requires a revenue or a unit column — without one there is nothing to price, and every
 * other column is decoration.
 */
function fromTable(sheet: Sheet, notes: string[]): ExtractedSegment[] {
  const { name: sheetName, grid } = sheet;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const columns = new Map<PerimeterField, number>();
    row.forEach((cell, c) => {
      const field = fieldFor(cell);
      // First column wins: a workbook with both "Category" and "Product category" should
      // read the leftmost, not silently prefer whichever comes last.
      if (field && !columns.has(field)) columns.set(field, c);
    });
    if (columns.size < 2) continue;
    if (!columns.has("revenues") && !columns.has("units")) continue;

    const segments: ExtractedSegment[] = [];
    let blanks = 0;
    for (let d = r + 1; d < grid.length && blanks < 2; d++) {
      const data = grid[d] ?? [];
      if (isBlankRow(data)) { blanks++; continue; }
      blanks = 0;
      const at = (f: PerimeterField) => {
        const c = columns.get(f);
        return c == null ? "" : (data[c] ?? "").trim();
      };
      // A totals row restates figures already counted; adding it would double the
      // perimeter, which prices at twice the premium and nobody notices until Chubb does.
      const label = at("name") || at("category");
      if (/^\s*(total|totale|totals|sum|somma|grand\s*total)\b/i.test(label)) {
        notes.push(`Skipped a totals row ("${label}") on ${sheetName} — its figures are already in the segments above.`);
        continue;
      }
      const revenues = parseNumber(at("revenues"));
      const units = parseNumber(at("units"));
      const avgPrice = parseNumber(at("avg_price"));
      const value = revenues ?? (units != null && avgPrice != null ? units * avgPrice : null);
      if (value == null || value <= 0) continue;
      if (revenues == null && value > 0) {
        notes.push(`${label || "A segment"}: no revenue column, so it was taken as units x average price (${units} x ${avgPrice}).`);
      }

      const categoryRaw = at("category") || label;
      const mapped = mapCategory(categoryRaw);
      if (!mapped.matched && categoryRaw) {
        notes.push(`"${categoryRaw}" is not one of the priced categories — filed as "other", which will not price until a rate exists for it.`);
      }
      const cover = mapCoverage(`${at("coverage")} ${label}`);
      segments.push({
        name: label || `${sheetName} ${d + 1}`,
        category: mapped.category,
        coverage: cover.coverage,
        damage_scope: cover.damage_scope,
        revenues: Math.round(value),
        cogs_ratio: normaliseCogs(parseNumber(at("cogs"))),
        avg_price: avgPrice != null && avgPrice > 0 ? Math.round(avgPrice) : null,
        start_month: Math.max(1, Math.round(parseNumber(at("start")) ?? 1)),
        source: `${sheetName}!row ${d + 1}`,
      });
    }

    if (segments.length) {
      notes.push(`Read ${segments.length} segment${segments.length === 1 ? "" : "s"} from the table on "${sheetName}" (header at row ${r + 1}).`);
      return segments;
    }
  }
  return [];
}

/**
 * Layout 2: a form. "Total covered revenue" in one cell, the answer in the next.
 *
 * This is what the pilot workbook actually looks like — a question sheet, not a table — so
 * it yields ONE segment covering the whole declared perimeter, which is usually right for a
 * pilot and is in any case a starting point somebody can split.
 */
function fromForm(sheet: Sheet, notes: string[]): ExtractedSegment[] {
  const { name: sheetName, grid } = sheet;
  const found = new Map<PerimeterField, { value: string; at: string }>();
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      const field = fieldFor(cell);
      if (!field || found.has(field)) return;
      // The answer is the first non-empty cell to the right on the same row.
      for (let k = c + 1; k < row.length; k++) {
        const v = (row[k] ?? "").trim();
        if (v) { found.set(field, { value: v, at: `${sheetName}!row ${r + 1}` }); return; }
      }
    });
  });

  const revenues = parseNumber(found.get("revenues")?.value ?? "");
  const units = parseNumber(found.get("units")?.value ?? "");
  const avgPrice = parseNumber(found.get("avg_price")?.value ?? "");
  const value = revenues ?? (units != null && avgPrice != null ? units * avgPrice : null);
  if (value == null || value <= 0) return [];

  const categoryRaw = found.get("category")?.value ?? "";
  const mapped = mapCategory(categoryRaw);
  if (categoryRaw && !mapped.matched) {
    notes.push(`"${categoryRaw}" is not one of the priced categories — filed as "other".`);
  }
  const cover = mapCoverage(found.get("coverage")?.value ?? "");
  notes.push(
    `"${sheetName}" reads as a form rather than a table, so it yielded one segment for the whole declared perimeter. ` +
    "Split it if the pilot covers more than one category.",
  );
  return [{
    name: found.get("name")?.value || "Declared perimeter",
    category: mapped.category,
    coverage: cover.coverage,
    damage_scope: cover.damage_scope,
    revenues: Math.round(value),
    cogs_ratio: normaliseCogs(parseNumber(found.get("cogs")?.value ?? "")),
    avg_price: avgPrice != null && avgPrice > 0 ? Math.round(avgPrice) : null,
    start_month: Math.max(1, Math.round(parseNumber(found.get("start")?.value ?? "") ?? 1)),
    source: found.get("revenues")?.at ?? sheetName,
  }];
}

/**
 * The client's returned workbook -> a perimeter to check.
 *
 * Tables are preferred over forms because they carry more: a table that yields three
 * segments says more than a form that yields one total. Sheets are tried in order and the
 * FIRST that yields anything wins — a workbook usually has one perimeter and several sheets
 * of instructions, and merging every sheet that happens to contain a number would produce a
 * perimeter nobody declared.
 */
export function extractPerimeter(sheets: Sheet[]): Extraction {
  const notes: string[] = [];
  const scanned = sheets.map((s) => s.name);

  let segments: ExtractedSegment[] = [];
  for (const sheet of sheets) {
    segments = fromTable(sheet, notes);
    if (segments.length) break;
  }
  if (!segments.length) {
    for (const sheet of sheets) {
      segments = fromForm(sheet, notes);
      if (segments.length) break;
    }
  }

  if (!segments.length) {
    return {
      segments: [],
      notes: [
        `Nothing in this workbook reads as a perimeter. Looked at ${scanned.length} sheet${scanned.length === 1 ? "" : "s"}: ${scanned.join(", ")}.`,
        "A perimeter needs at least a covered revenue or a number of pieces, next to or under a label naming it.",
        "Enter it by hand below — the workbook is attached to the brand either way.",
      ],
      scanned,
    };
  }

  const missingCogs = segments.filter((s) => s.cogs_ratio == null).length;
  if (missingCogs) {
    notes.push(`${missingCogs === segments.length ? "No segment" : `${missingCogs} segment${missingCogs === 1 ? "" : "s"}`} declared a COGS ratio — left at the ${Math.round(COGS_DEFAULT * 100)}% default, which drives the premium directly.`);
  }
  const missingPrice = segments.filter((s) => s.avg_price == null).length;
  if (missingPrice) {
    notes.push(`${missingPrice} segment${missingPrice === 1 ? "" : "s"} without an average price — the per-piece figures stay blank until one is set.`);
  }
  notes.push("Every figure here came out of the client's own file. Read them against what they meant before you price anything.");

  return { segments, notes, scanned };
}

// ── Has this form been filled in? ───────────────────────────────────────────────────────
/**
 * The cells of one worksheet that carry a typed-in NUMBER.
 *
 * Used on the way OUT, not on the way in: a data request is a form nobody has answered yet,
 * so a figure in it belongs to whoever last filled the template. The workbook registered as
 * the template was for months the first house's own returned file, and the three strings the
 * generator swapped left every one of their figures behind — revenues, units, average
 * prices, COGS, the volumes in each price band — in a workbook addressed to a different
 * house. No name was left to catch, so names were never going to catch it.
 *
 * Labels are shared strings (`t="s"`) and a template's own formulas carry `<f>` with no
 * cached result, so neither trips this. Anything else with a `<v>` was typed by somebody.
 */
export function filledNumericCells(sheetXml: string): string[] {
  const out: string[] = [];
  for (const m of sheetXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, inner = ""] = m;
    if (/\st="(s|inlineStr|str)"/.test(attrs)) continue;
    if (!/<v>/.test(inner)) continue;
    out.push(ref);
  }
  return out;
}
