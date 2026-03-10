/** Fields that are too large / binary to be useful in a CSV export */
const SKIP_KEYS = new Set(["faq_en", "faq_it"]);

export interface ExportColumn {
  key: string;
  label: string;
}

/**
 * Recursively flattens a row object.
 * Nested objects become prefixed keys (e.g. brands.name → brands_name).
 * Arrays are joined with ", ".
 */
function flattenRow(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEYS.has(k)) continue;
    const key = prefix ? `${prefix}_${k}` : k;
    if (v === null || v === undefined) {
      result[key] = "";
    } else if (Array.isArray(v)) {
      result[key] = v.map(String).join(", ");
    } else if (typeof v === "object") {
      Object.assign(result, flattenRow(v as Record<string, unknown>, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

function toCsvValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Flattens rows (exploding FK nested objects), applies an optional schema to
 * select, order and relabel columns, then generates a UTF-8 CSV with BOM
 * (for Excel compatibility) and triggers a browser download.
 *
 * When `schema` is provided only those columns are emitted, in the given order,
 * with the human-friendly labels as the header row.
 */
export function exportToCsv(
  rows: Record<string, unknown>[],
  filename: string,
  schema?: ExportColumn[]
) {
  if (!rows.length) return;
  const flat = rows.map((r) => flattenRow(r));

  let headerKeys: string[];
  let headerLabels: string[];

  if (schema?.length) {
    headerKeys = schema.map((s) => s.key);
    headerLabels = schema.map((s) => s.label);
  } else {
    // Fall back: auto-collect all keys in insertion order
    const headerSet = new Set<string>();
    flat.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
    headerKeys = Array.from(headerSet);
    headerLabels = headerKeys;
  }

  const csv = [
    headerLabels.map(toCsvValue).join(","),
    ...flat.map((r) =>
      headerKeys.map((h) => toCsvValue(r[h] ?? "")).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
