/**
 * Recursively flattens a Supabase response row.
 * Nested FK join objects become `{table}_{field}` prefixed keys, resolved
 * all the way down until every value is a scalar.
 *
 * e.g.
 *   { brands: { name: "X", logo_small: "…" }, status: "live" }
 *   → { brands_name: "X", brands_logo_small: "…", status: "live" }
 */
export function flattenSupabaseRow(
  row: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenSupabaseRow(v as Record<string, unknown>, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}
