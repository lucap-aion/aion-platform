// Parsers shared by ChubbUploadStatus (per-row inline file viewer) and
// ChubbUploadAlertBanner (coverage check that scans actual file rows vs DB).

export type ParsedReport = { columns: string[]; rows: string[][] };

// Matches pandas to_csv(escapechar="\\", quoting=QUOTE_NONNUMERIC).
export function parseCsv(text: string): ParsedReport {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    let escape = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escape) { cur += ch; escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  };

  return { columns: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

export async function parseXlsx(arrayBuffer: ArrayBuffer): Promise<ParsedReport> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { columns: [], rows: [] };
  const columns: string[] = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    columns.push(String(cell.value ?? ""));
  });
  const rows: string[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const arr: string[] = [];
    for (let c = 1; c <= columns.length; c++) {
      const v = row.getCell(c).value;
      arr.push(v === null || v === undefined ? "" : String(v));
    }
    rows.push(arr);
  }
  return { columns, rows };
}
