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

/**
 * Returns the path string to pass to Supabase `.ilike(path, ...)` for a
 * per-column filter. For top-level columns this is the column name; for
 * joined columns it's `<foreignTable>.<column>` so PostgREST filters
 * parent rows by the embedded value.
 *
 * NOTE: Joined-column filters only restrict parent rows when the relation
 * is selected with `!inner`. Otherwise the filter just narrows the embed.
 */
export function resolveFilterPath(
  filterKey: string,
  joinedRelations: readonly string[],
): string {
  const r = resolveSortOrder(filterKey, joinedRelations);
  return r.foreignTable ? `${r.foreignTable}.${r.column}` : r.column;
}

/** Apply every non-empty entry in `columnFilters` as a `.ilike(%value%)` to the Supabase query.
 *  Joined-column filters only restrict parent rows when the relation is selected `!inner`. */
export function applyColumnFilters<Q extends { ilike: (path: string, pattern: string) => Q }>(
  query: Q,
  columnFilters: Record<string, string>,
  joinedRelations: readonly string[],
): Q {
  let q = query;
  for (const [k, v] of Object.entries(columnFilters)) {
    if (!v) continue;
    q = q.ilike(resolveFilterPath(k, joinedRelations), `%${v}%`);
  }
  return q;
}
