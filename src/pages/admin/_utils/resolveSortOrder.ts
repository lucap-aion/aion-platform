/**
 * Translates a flattened-row sort key (e.g. "brands_name") into the column +
 * foreignTable pair that Supabase's `.order()` expects.
 *
 *   resolveSortOrder("brands_name",  ["brands"])         → { column: "name", foreignTable: "brands" }
 *   resolveSortOrder("created_at",   ["brands"])         → { column: "created_at" }
 *
 * Pages flatten join responses via `flattenSupabaseRow`, producing keys like
 * `${table}_${col}`. AdminTable surfaces those as sortable headers, but
 * Supabase needs the bare column + foreignTable to actually order the joined
 * row. Each list page passes its own list of joined relations.
 *
 * Longest-prefix match wins so that nested relations (e.g. "policies.brands")
 * are matched before their parent ("policies").
 */
export function resolveSortOrder(
  sortKey: string,
  joinedRelations: readonly string[],
): { column: string; foreignTable?: string } {
  const sorted = [...joinedRelations].sort((a, b) => b.length - a.length);
  for (const rel of sorted) {
    const flatPrefix = rel.replace(/\./g, "_") + "_";
    if (sortKey.startsWith(flatPrefix)) {
      return { column: sortKey.slice(flatPrefix.length), foreignTable: rel };
    }
  }
  return { column: sortKey };
}
