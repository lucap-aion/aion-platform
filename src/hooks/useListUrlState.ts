import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

type SortDir = "asc" | "desc";

interface Options {
  defaultSortKey: string;
  defaultSortDir?: SortDir;
  filterKeys?: readonly string[];
}

/**
 * Persists list-view state (page, search, sort, filters) in the URL query string
 * so a refresh / shared link restores the same view. Defaults are omitted from
 * the URL to keep it clean.
 *
 * URL conventions:
 *   - page: 1-indexed in URL (`?page=2` is the second page); omitted on first page
 *   - q:    free-text search
 *   - sort: sort key (omitted when equal to defaultSortKey)
 *   - dir:  asc | desc (omitted when equal to defaultSortDir)
 *   - one URL param per filterKey (`?status=verified&brand_id=3`)
 *
 * Changing any filter / search / sort resets page to 1.
 */
export function useListUrlState(opts: Options) {
  const defaultDir: SortDir = opts.defaultSortDir ?? "asc";
  const filterKeys = opts.filterKeys ?? [];
  const filterKeysSig = filterKeys.join("|");

  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(0, (Number(searchParams.get("page")) || 1) - 1);
  const search = searchParams.get("q") ?? "";
  const sortKey = searchParams.get("sort") ?? opts.defaultSortKey;
  const sortDir = ((searchParams.get("dir") as SortDir | null) ?? defaultDir);

  const filterValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of filterKeys) {
      const v = searchParams.get(k);
      if (v) out[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, filterKeysSig]);

  // react-router's setSearchParams functional updater receives the LAST
  // COMMITTED params (via a ref), not the queued state from prior calls in
  // the same tick. So two back-to-back updaters both branch from the same
  // base and the second wipes the first. We compose them ourselves via a
  // pending ref that's cleared once react-router commits.
  const pendingRef = useRef<URLSearchParams | null>(null);
  useEffect(() => { pendingRef.current = null; }, [searchParams]);

  const update = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const base = pendingRef.current ?? prev;
          const next = new URLSearchParams(base);
          mutate(next);
          pendingRef.current = next;
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setPage = useCallback(
    (p: number) => {
      update((sp) => {
        if (p <= 0) sp.delete("page");
        else sp.set("page", String(p + 1));
      });
    },
    [update]
  );

  const setSearch = useCallback(
    (q: string) => {
      update((sp) => {
        if (!q) sp.delete("q");
        else sp.set("q", q);
        sp.delete("page");
      });
    },
    [update]
  );

  const setSort = useCallback(
    (k: string, d: SortDir) => {
      update((sp) => {
        if (k === opts.defaultSortKey) sp.delete("sort");
        else sp.set("sort", k);
        if (d === defaultDir) sp.delete("dir");
        else sp.set("dir", d);
        sp.delete("page");
      });
    },
    [update, opts.defaultSortKey, defaultDir]
  );

  const setFilter = useCallback(
    (k: string, v: string) => {
      update((sp) => {
        if (!v) sp.delete(k);
        else sp.set(k, v);
        sp.delete("page");
      });
    },
    [update]
  );

  return { page, search, sortKey, sortDir, filterValues, setPage, setSearch, setSort, setFilter };
}

/**
 * Persist a single string-valued param in the URL. Hook returns a [value, setter]
 * tuple matching the useState shape. When `value === defaultValue`, the param is
 * removed from the URL (kept clean).
 *
 * For non-string values (numbers, enums), use `parse` / `serialize`.
 */
export function useUrlParam<T>(
  key: string,
  defaultValue: T,
  options?: {
    parse?: (raw: string) => T;
    serialize?: (value: T) => string;
  }
): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const parse = options?.parse;
  const serialize = options?.serialize;

  const raw = searchParams.get(key);
  const value: T = raw == null
    ? defaultValue
    : parse
      ? parse(raw)
      : (raw as unknown as T);

  // See note in useListUrlState — compose synchronous updaters so back-to-back
  // setValue calls (e.g. changing period + shop in the same tick) don't race.
  const pendingRef = useRef<URLSearchParams | null>(null);
  useEffect(() => { pendingRef.current = null; }, [searchParams]);

  const setValue = useCallback(
    (next: T) => {
      const isDefault = next === defaultValue;
      setSearchParams(
        (prev) => {
          const base = pendingRef.current ?? prev;
          const sp = new URLSearchParams(base);
          if (isDefault) sp.delete(key);
          else sp.set(key, serialize ? serialize(next) : String(next));
          pendingRef.current = sp;
          return sp;
        },
        { replace: true }
      );
    },
    [key, defaultValue, serialize, setSearchParams]
  );

  return [value, setValue];
}
