import { useState, useEffect, useRef, useMemo } from "react";
import {
  Search, Plus, Pencil, Trash2, Eye, EyeOff,
  ChevronDown, X, ChevronsUpDown, Download, SlidersHorizontal, Pin, GripVertical,
} from "lucide-react";
import { exportToCsv, type ExportColumn } from "../_utils/exportCsv";

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Converts snake_case or camelCase to Title Case for display */
export const toTitleCase = (str: string): string =>
  str.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());

/** Word-level abbreviation map used when auto-generating column labels */
const ABBREV: Record<string, string> = {
  id: "ID", sku: "SKU", url: "URL", faq: "FAQ",
  rrp: "RRP", cogs: "COGS", hq: "HQ", api: "API",
};

/** Singularise common Supabase join table-name prefixes so labels read naturally */
const SINGULAR: Record<string, string> = {
  brands: "brand", profiles: "profile", catalogues: "catalogue",
  shops: "shop", policies: "policy", admins: "admin",
};

/**
 * Converts a snake_case flat key (possibly with a join-table prefix) into a
 * human-friendly label, respecting abbreviations and singularisation.
 * e.g. "brands_name" → "Brand Name", "item_sku" → "Item SKU"
 */
function friendlyLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i === 0 && SINGULAR[lw]) return SINGULAR[lw].charAt(0).toUpperCase() + SINGULAR[lw].slice(1);
      return ABBREV[lw] ?? (w.charAt(0).toUpperCase() + w.slice(1));
    })
    .join(" ");
}

/** Keys that should never appear as auto-generated columns (at any nesting depth) */
/** Suffix-based skip list — matches both bare keys and prefixed variants like `brands_logo_small` */
const SKIP_SUFFIXES = new Set([
  "logo_small", "logo_big", "logo", "avatar", "picture",
  "auth_background_image", "top_banner_image", "theft_image",
  "damage_image", "faq_image", "feedback_image",
  "faq_en", "faq_it", "media",
]);

function isSkippedKey(k: string): boolean {
  if (SKIP_SUFFIXES.has(k)) return true;
  for (const s of SKIP_SUFFIXES) {
    if (k.endsWith(`_${s}`)) return true;
  }
  return false;
}

/**
 * Scans a pre-flattened row (produced by `flattenSupabaseRow`) and yields
 * auto-generated Column definitions for every scalar key not already declared
 * in the primary `columns` prop and not in the skip list.
 * Also handles legacy un-flattened rows by recursing into nested objects.
 */
function collectLeafCols<T>(
  obj: Record<string, unknown>,
  definedKeys: Set<string>,
  primaryValues: Set<unknown>,
  prefix = "",
  path: string[] = [],
): Column<T>[] {
  const result: Column<T>[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const flatKey = prefix ? `${prefix}_${k}` : k;
    if (isSkippedKey(flatKey)) continue;
    const currentPath = [...path, k];
    if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
      result.push(...collectLeafCols<T>(
        v as Record<string, unknown>, definedKeys, primaryValues, flatKey, currentPath,
      ));
    } else {
      if (definedKeys.has(flatKey)) continue;
      if (path.length > 0 && v != null && v !== "" && v !== "—" && primaryValues.has(v)) continue;
      const capPath = currentPath;
      result.push({
        key: flatKey,
        label: friendlyLabel(flatKey),
        render: path.length > 0
          ? (row: T) => {
              let val: unknown = row;
              for (const p of capPath) val = (val as Record<string, unknown>)?.[p];
              return <span className="block truncate">{String(val ?? "—")}</span>;
            }
          : undefined,
      });
    }
  }
  return result;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: number;
  render?: (row: T) => React.ReactNode;
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface AdminTableProps<T extends Record<string, unknown>> {
  title: string;
  data: T[];
  columns: Column<T>[];
  total: number;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onSearch: (q: string) => void;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string, dir: "asc" | "desc") => void;
  loading?: boolean;
  action?: React.ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  onView?: (row: T) => void;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  filters?: FilterDef[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  extraRowAction?: (row: T) => React.ReactNode;
  onExport?: () => Promise<Record<string, unknown>[]>;
  exportFilename?: string;
  exportSchema?: ExportColumn[];
}

/** Persisted per-table column preferences */
interface ColSettings {
  hidden: string[];
  frozen: string[];
  order: string[];
  widths: Record<string, number>;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function lsKey(title: string) {
  return `admin_col_${title.toLowerCase().replace(/\s+/g, "_")}`;
}

function loadSettings(title: string): ColSettings | null {
  try {
    const raw = localStorage.getItem(lsKey(title));
    return raw ? (JSON.parse(raw) as ColSettings) : null;
  } catch {
    return null;
  }
}

function saveSettings(title: string, s: ColSettings) {
  try { localStorage.setItem(lsKey(title), JSON.stringify(s)); } catch {}
}

function defaultSettings<T>(primaryCols: Column<T>[], allCols: Column<T>[]): ColSettings {
  const primaryKeys = new Set(primaryCols.map((c) => c.key));
  return {
    hidden: allCols.filter((c) => !primaryKeys.has(c.key)).map((c) => c.key),
    frozen: [],
    order: allCols.map((c) => c.key),
    widths: Object.fromEntries(allCols.map((c) => [c.key, c.width ?? defaultColWidth(c.key)])),
  };
}

/** Merge saved settings with current column set (handles added/removed columns) */
function mergeSettings<T>(
  saved: ColSettings,
  allCols: Column<T>[],
  primaryCols: Column<T>[],
): ColSettings {
  const allKeys = allCols.map((c) => c.key);
  const primaryKeys = new Set(primaryCols.map((c) => c.key));
  const newKeys = allKeys.filter((k) => !saved.order.includes(k));
  return {
    hidden: [
      ...saved.hidden.filter((k) => allKeys.includes(k)),
      ...newKeys.filter((k) => !primaryKeys.has(k)),
    ],
    frozen: saved.frozen.filter((k) => allKeys.includes(k)),
    order: [...saved.order.filter((k) => allKeys.includes(k)), ...newKeys],
    widths: {
      ...Object.fromEntries(allCols.map((c) => [c.key, c.width ?? defaultColWidth(c.key)])),
      ...saved.widths,
    },
  };
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  verified: "bg-green-100 text-green-700 border-green-200",
  active:   "bg-green-100 text-green-700 border-green-200",
  live:     "bg-green-100 text-green-700 border-green-200",
  open:     "bg-blue-100 text-blue-700 border-blue-200",
  pending:  "bg-yellow-100 text-yellow-700 border-yellow-200",
  under_review: "bg-yellow-100 text-yellow-700 border-yellow-200",
  closed:   "bg-gray-100 text-gray-600 border-gray-200",
  cancelled:"bg-red-100 text-red-700 border-red-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  inactive: "bg-gray-100 text-gray-600 border-gray-200",
  blocked:  "bg-red-100 text-red-700 border-red-200",
};

const StatusBadge = ({ status }: { status: string }) => {
  const cls = STATUS_COLORS[status?.toLowerCase()] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {toTitleCase(status)}
    </span>
  );
};
export { StatusBadge };

// ─── defaultColWidth ──────────────────────────────────────────────────────────

function defaultColWidth(key: string): number {
  if (key === "id") return 64;
  if (key === "status") return 108;
  if (key === "type") return 130;
  if (key === "is_master") return 104;
  if (key === "brand_sale_id") return 140;
  if (key === "brand_item_id") return 140;
  if (key === "sku") return 130;
  if (key === "category" || key === "collection") return 130;
  if (key === "quantity") return 90;
  if (key.includes("price") || key === "cogs" || key.includes("rrp") || key.includes("recommended")) return 116;
  if (key.endsWith("_at") || key.includes("date") || key === "registered_at") return 128;
  if (key === "hq_country" || key === "country") return 120;
  if (key === "website") return 160;
  if (key === "contact") return 150;
  if (key === "email") return 200;
  if (key === "city" || key.includes("location") || key.includes("city")) return 150;
  if (key.includes("brand") || key === "shop_name") return 164;
  if (key.includes("customer")) return 200;
  if (key.includes("item")) return 200;
  if (key === "name" || key.includes("_name")) return 180;
  if (key === "first_name") return 200;
  if (key === "description") return 220;
  return 150;
}

// ─── AdminTable ───────────────────────────────────────────────────────────────

function AdminTable<T extends Record<string, unknown>>({
  title,
  data,
  columns,
  total,
  page,
  pageSize = 25,
  onPageChange,
  onSearch,
  sortKey,
  sortDir = "asc",
  onSort,
  loading = false,
  action,
  onAdd,
  addLabel = "Add",
  onView,
  onEdit,
  onDelete,
  filters,
  filterValues = {},
  onFilterChange,
  extraRowAction,
  onExport,
  exportFilename = title,
  exportSchema,
}: AdminTableProps<T>) {

  // ── Auto-detect extra columns from data ─────────────────────────────
  const firstRowKeySig = data[0] ? Object.keys(data[0]).join(",") : "";
  const allColumns = useMemo<Column<T>[]>(() => {
    const definedKeys = new Set(columns.map((c) => c.key));
    if (!data[0]) return [...columns];
    const row0 = data[0] as Record<string, unknown>;
    // Build from ALL flat scalar values in row0 (not just declared column values) so
    // helper fields like customer_first/customer_last also block nested duplicates.
    const primaryValues = new Set<unknown>();
    for (const [, v] of Object.entries(row0)) {
      if (v != null && v !== "" && v !== "—" && typeof v !== "object" && !Array.isArray(v))
        primaryValues.add(v);
    }
    const extras = collectLeafCols<T>(row0, definedKeys, primaryValues);
    return [...columns, ...extras];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, firstRowKeySig]);

  const allColMap = useMemo(() => new Map(allColumns.map((c) => [c.key, c])), [allColumns]);

  // ── Column settings (persisted) ─────────────────────────────────────
  const [settings, setSettings] = useState<ColSettings>(() => {
    const saved = loadSettings(title);
    return saved
      ? mergeSettings(saved, allColumns, columns)
      : defaultSettings(columns, allColumns);
  });

  // Reload when navigating to a different table
  const prevTitle = useRef(title);
  useEffect(() => {
    if (prevTitle.current === title) return;
    prevTitle.current = title;
    const saved = loadSettings(title);
    setSettings(
      saved
        ? mergeSettings(saved, allColumns, columns)
        : defaultSettings(columns, allColumns),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  // Add newly-detected extra columns to settings (hidden by default)
  const allColKeySig = allColumns.map((c) => c.key).join(",");
  useEffect(() => {
    setSettings((prev) => {
      const newKeys = allColumns
        .map((c) => c.key)
        .filter((k) => !prev.order.includes(k));
      if (!newKeys.length) return prev;
      return {
        ...prev,
        order: [...prev.order, ...newKeys],
        hidden: [...prev.hidden, ...newKeys],
        widths: {
          ...prev.widths,
          ...Object.fromEntries(newKeys.map((k) => [k, defaultColWidth(k)])),
        },
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allColKeySig]);

  // Persist to localStorage (debounced to avoid excessive writes on resize)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSettings(title, settings), 150);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [settings, title]);

  // ── Settings mutation helpers ────────────────────────────────────────
  const toggleVisibility = (key: string) =>
    setSettings((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(key)
        ? prev.hidden.filter((k) => k !== key)
        : [...prev.hidden, key],
      // Also unfreeze when hiding
      frozen: prev.hidden.includes(key) ? prev.frozen : prev.frozen.filter((k) => k !== key),
    }));

  const toggleFreeze = (key: string) =>
    setSettings((prev) => ({
      ...prev,
      frozen: prev.frozen.includes(key)
        ? prev.frozen.filter((k) => k !== key)
        : [...prev.frozen, key],
    }));

  const resetSettings = () => {
    const fresh = defaultSettings(columns, allColumns);
    setSettings(fresh);
  };

  const updateWidth = (key: string, w: number) =>
    setSettings((prev) => ({ ...prev, widths: { ...prev.widths, [key]: w } }));

  const reorderCols = (fromKey: string, toKey: string) => {
    setSettings((prev) => {
      const order = [...prev.order];
      const fi = order.indexOf(fromKey);
      const ti = order.indexOf(toKey);
      if (fi === -1 || ti === -1) return prev;
      order.splice(fi, 1);
      order.splice(ti, 0, fromKey);
      return { ...prev, order };
    });
  };

  // ── Derived rendering data ───────────────────────────────────────────
  const frozenVisible = settings.order.filter(
    (k) => settings.frozen.includes(k) && !settings.hidden.includes(k) && allColMap.has(k),
  );
  const normalVisible = settings.order.filter(
    (k) => !settings.frozen.includes(k) && !settings.hidden.includes(k) && allColMap.has(k),
  );
  const visibleColKeys = [...frozenVisible, ...normalVisible];
  const visibleColumns = visibleColKeys
    .map((k) => allColMap.get(k)!)
    .filter(Boolean);

  // Compute sticky left offsets for frozen columns
  const stickyLeft: Record<string, number> = {};
  let leftAcc = 0;
  for (const key of frozenVisible) {
    stickyLeft[key] = leftAcc;
    leftAcc += settings.widths[key] ?? defaultColWidth(key);
  }
  const lastFrozenKey = frozenVisible[frozenVisible.length - 1];

  // ── Resize handler ──────────────────────────────────────────────────
  const startResize = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = settings.widths[key] ?? defaultColWidth(key);
    const onMove = (ev: PointerEvent) =>
      updateWidth(key, Math.max(60, startW + ev.clientX - startX));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // ── Sort ────────────────────────────────────────────────────────────
  const handleSort = (key: string) => {
    if (!onSort) return;
    onSort(key, sortKey === key && sortDir === "asc" ? "desc" : "asc");
    onPageChange(0);
  };

  // ── Search debounce ─────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { onSearch(inputValue); onPageChange(0); }, 350);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  // ── Drag-to-reorder in table header ─────────────────────────────────
  const dragSrcKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const handleDrop = (targetKey: string) => {
    const src = dragSrcKey.current;
    if (!src || src === targetKey) { setDragOverKey(null); return; }
    reorderCols(src, targetKey);
    setDragOverKey(null);
    dragSrcKey.current = null;
  };

  // ── Column picker drag-to-reorder ───────────────────────────────────
  const pickerDragSrc = useRef<string | null>(null);
  const [pickerDragOver, setPickerDragOver] = useState<string | null>(null);

  const handlePickerDrop = (targetKey: string) => {
    const src = pickerDragSrc.current;
    if (!src || src === targetKey) { setPickerDragOver(null); return; }
    reorderCols(src, targetKey);
    setPickerDragOver(null);
    pickerDragSrc.current = null;
  };

  // ── Column picker panel ─────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const hiddenCount = settings.hidden.length;
  const visibleCount = visibleColumns.length;

  // ── Export ──────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (!onExport) return;
    setExporting(true);
    try {
      exportToCsv(await onExport(), exportFilename, exportSchema);
    } finally {
      setExporting(false);
    }
  };

  // ── Misc ────────────────────────────────────────────────────────────
  const hasActiveFilters = filters?.some((f) => filterValues[f.key]);
  const hasRowActions = onView || onEdit || onDelete || extraRowAction;
  const pageCount = Math.ceil(total / pageSize);
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  const ACTIONS_W = 100;
  const totalMinWidth =
    visibleColumns.reduce((s, c) => s + (settings.widths[c.key] ?? defaultColWidth(c.key)), 0) +
    (hasRowActions ? ACTIONS_W : 0);

  // ── Frozen cell style helpers ────────────────────────────────────────
  const frozenThStyle = (key: string): React.CSSProperties => ({
    overflow: "hidden",
    position: "sticky",
    left: stickyLeft[key],
    zIndex: 4,
    backgroundColor: "hsl(var(--secondary))",
    boxShadow: key === lastFrozenKey ? "3px 0 6px -2px rgba(0,0,0,0.12)" : undefined,
  });
  const frozenTdStyle = (key: string): React.CSSProperties => ({
    overflow: "hidden",
    maxWidth: settings.widths[key] ?? defaultColWidth(key),
    position: "sticky",
    left: stickyLeft[key],
    zIndex: 1,
    backgroundColor: "hsl(var(--background))",
    boxShadow: key === lastFrozenKey ? "3px 0 6px -2px rgba(0,0,0,0.08)" : undefined,
  });
  const normalThStyle: React.CSSProperties = { overflow: "hidden" };
  const normalTdStyle = (key: string): React.CSSProperties => ({
    overflow: "hidden",
    maxWidth: settings.widths[key] ?? defaultColWidth(key),
  });

  // ────────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col p-6 md:p-8 gap-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total.toLocaleString()} records</p>
        </div>
        <div className="flex items-center gap-2">
          {action}
          {onExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              title="Export to CSV (opens in Excel)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {exporting
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <Download className="h-4 w-4" />}
              Export
            </button>
          )}
          {onAdd && (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {addLabel}
            </button>
          )}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="rounded-lg border border-input bg-background pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary w-56"
          />
        </div>

        {/* Filters */}
        {filters?.map((f) => (
          <div key={f.key} className="relative">
            <select
              value={filterValues[f.key] ?? ""}
              onChange={(e) => { onFilterChange?.(f.key, e.target.value); onPageChange(0); }}
              className="appearance-none rounded-lg border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All {f.label}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        ))}

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={() => { filters?.forEach((f) => onFilterChange?.(f.key, "")); onPageChange(0); }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}

        {/* ── Column picker ── */}
        <div className="relative ml-auto" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              pickerOpen
                ? "border-primary text-primary bg-primary/5"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary",
            ].join(" ")}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Columns
            {hiddenCount > 0 && (
              <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5 leading-5">
                {hiddenCount}
              </span>
            )}
          </button>

          {pickerOpen && (
            <div className="absolute top-full mt-1 right-0 z-50 w-64 rounded-xl border border-border bg-background shadow-xl overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                <span className="text-xs font-semibold text-foreground">
                  {visibleCount} of {allColumns.length} columns visible
                </span>
                <button
                  onClick={resetSettings}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset
                </button>
              </div>

              {/* Column rows */}
              <div className="max-h-80 overflow-y-auto py-1">
                {allColumns.map((col) => {
                  const isHidden = settings.hidden.includes(col.key);
                  const isFrozen = settings.frozen.includes(col.key);
                  const isDragOver = pickerDragOver === col.key;
                  return (
                    <div
                      key={col.key}
                      draggable
                      onDragStart={() => { pickerDragSrc.current = col.key; }}
                      onDragOver={(e) => { e.preventDefault(); setPickerDragOver(col.key); }}
                      onDragLeave={() => setPickerDragOver(null)}
                      onDrop={() => handlePickerDrop(col.key)}
                      onDragEnd={() => { pickerDragSrc.current = null; setPickerDragOver(null); }}
                      className={[
                        "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
                        isDragOver ? "bg-primary/10" : "hover:bg-secondary/50",
                      ].join(" ")}
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 cursor-grab active:cursor-grabbing" />
                      <span
                        className={[
                          "flex-1 text-sm truncate",
                          isHidden ? "text-muted-foreground/60" : "text-foreground",
                        ].join(" ")}
                        title={friendlyLabel(col.label)}
                      >
                        {friendlyLabel(col.label)}
                      </span>

                      {/* Freeze toggle (only meaningful when visible) */}
                      <button
                        onClick={() => { if (!isHidden) toggleFreeze(col.key); }}
                        title={isFrozen ? "Unpin column" : "Pin column to left"}
                        disabled={isHidden}
                        className={[
                          "rounded p-1 transition-colors disabled:opacity-20",
                          isFrozen
                            ? "text-primary"
                            : "text-muted-foreground/30 hover:text-muted-foreground",
                        ].join(" ")}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>

                      {/* Visibility toggle */}
                      <button
                        onClick={() => toggleVisibility(col.key)}
                        title={isHidden ? "Show column" : "Hide column"}
                        className={[
                          "rounded p-1 transition-colors",
                          isHidden
                            ? "text-muted-foreground/30 hover:text-foreground"
                            : "text-foreground hover:text-muted-foreground",
                        ].join(" ")}
                      >
                        {isHidden
                          ? <EyeOff className="h-3.5 w-3.5" />
                          : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Frozen hint */}
              {frozenVisible.length > 0 && (
                <div className="px-3 py-2 border-t border-border">
                  <p className="text-[11px] text-muted-foreground">
                    <Pin className="inline h-3 w-3 mr-0.5 text-primary" />
                    {frozenVisible.length} column{frozenVisible.length > 1 ? "s" : ""} pinned to left
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 flex flex-col rounded-xl border border-border overflow-hidden min-h-0">
        <div className="flex-1 overflow-auto">
          <table
            className="text-sm border-collapse"
            style={{ tableLayout: "fixed", width: "100%", minWidth: totalMinWidth }}
          >
            <colgroup>
              {visibleColumns.map((col) => (
                <col key={col.key} style={{ width: settings.widths[col.key] ?? defaultColWidth(col.key) }} />
              ))}
              {hasRowActions && <col style={{ width: ACTIONS_W }} />}
            </colgroup>

            <thead>
              <tr className="bg-secondary/50 border-b border-border">
                {visibleColumns.map((col) => {
                  const isFrozen = frozenVisible.includes(col.key);
                  return (
                    <th
                      key={col.key}
                      draggable={!isFrozen}
                      onDragStart={() => { if (!isFrozen) dragSrcKey.current = col.key; }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverKey(col.key); }}
                      onDragLeave={() => setDragOverKey(null)}
                      onDrop={() => handleDrop(col.key)}
                      onDragEnd={() => { dragSrcKey.current = null; setDragOverKey(null); }}
                      onClick={col.sortable && onSort ? () => handleSort(col.key) : undefined}
                      className={[
                        "relative px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide select-none",
                        "border-r border-border/40",
                        !isFrozen ? "cursor-grab active:cursor-grabbing" : "cursor-default",
                        col.sortable && onSort ? "hover:text-foreground" : "",
                        dragOverKey === col.key ? "bg-primary/10" : "",
                      ].join(" ")}
                      style={isFrozen ? frozenThStyle(col.key) : normalThStyle}
                    >
                      <span className="inline-flex items-center gap-1 truncate">
                        {isFrozen && (
                          <Pin className="h-3 w-3 text-primary/50 shrink-0" />
                        )}
                        {friendlyLabel(col.label)}
                        {col.sortable && onSort && (
                          <ChevronsUpDown
                            className={`h-3.5 w-3.5 ml-0.5 shrink-0 ${
                              sortKey === col.key ? "text-primary" : "text-muted-foreground/40"
                            }`}
                          />
                        )}
                      </span>
                      {/* Resize handle — always-visible grip */}
                      <div
                        className="absolute right-0 top-0 h-full w-[9px] cursor-col-resize z-10 flex items-center justify-center gap-px group/resize"
                        onPointerDown={(e) => startResize(e, col.key)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="h-3.5 w-px rounded-full bg-border/60 group-hover/resize:bg-primary/70 transition-colors" />
                        <div className="h-3.5 w-px rounded-full bg-border/60 group-hover/resize:bg-primary/70 transition-colors" />
                      </div>
                    </th>
                  );
                })}
                {hasRowActions && (
                  <th
                    className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                    style={{ width: ACTIONS_W }}
                  />
                )}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div className="h-4 w-3/4 bg-secondary animate-pulse rounded" />
                      </td>
                    ))}
                    {hasRowActions && <td className="px-4 py-3" />}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + (hasRowActions ? 1 : 0)}
                    className="px-4 py-12 text-center text-muted-foreground text-sm"
                  >
                    No records found.
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors group"
                  >
                    {visibleColumns.map((col) => {
                      const isFrozen = frozenVisible.includes(col.key);
                      return (
                        <td
                          key={col.key}
                          className="px-4 py-3 text-foreground"
                          style={isFrozen ? frozenTdStyle(col.key) : normalTdStyle(col.key)}
                        >
                          {col.render
                            ? col.render(row)
                            : <span className="block truncate">{String(row[col.key] ?? "—")}</span>}
                        </td>
                      );
                    })}
                    {hasRowActions && (
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {extraRowAction && extraRowAction(row)}
                          {onView && (
                            <button
                              onClick={() => onView(row)}
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                              title="View"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onEdit && (
                            <button
                              onClick={() => onEdit(row)}
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onDelete && (
                            <button
                              onClick={() => onDelete(row)}
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-background shrink-0">
          <p className="text-xs text-muted-foreground">
            {total === 0 ? "No records" : `${from}–${to} of ${total.toLocaleString()}`}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(0)} disabled={page === 0} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">«</button>
            <button onClick={() => onPageChange(page - 1)} disabled={page === 0} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
            <span className="px-3 py-1.5 text-xs text-muted-foreground">{page + 1} / {Math.max(1, pageCount)}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= pageCount - 1} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
            <button onClick={() => onPageChange(pageCount - 1)} disabled={page >= pageCount - 1} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">»</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminTable;
