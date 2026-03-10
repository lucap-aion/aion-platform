import { useState, useEffect, useRef } from "react";
import { Search, Plus, Pencil, Trash2, Eye, ChevronDown, X, ChevronsUpDown } from "lucide-react";

/** Converts snake_case or camelCase to Title Case for display */
export const toTitleCase = (str: string): string =>
  str.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());

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
}

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    verified: "bg-green-100 text-green-700 border-green-200",
    active: "bg-green-100 text-green-700 border-green-200",
    live: "bg-green-100 text-green-700 border-green-200",
    open: "bg-blue-100 text-blue-700 border-blue-200",
    pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
    under_review: "bg-yellow-100 text-yellow-700 border-yellow-200",
    closed: "bg-gray-100 text-gray-600 border-gray-200",
    cancelled: "bg-red-100 text-red-700 border-red-200",
    rejected: "bg-red-100 text-red-700 border-red-200",
    inactive: "bg-gray-100 text-gray-600 border-gray-200",
    blocked: "bg-red-100 text-red-700 border-red-200",
  };
  const cls = colors[status?.toLowerCase()] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {toTitleCase(status)}
    </span>
  );
};

export { StatusBadge };

/** Infer a sensible default column width from its key */
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
}: AdminTableProps<T>) {
  const [inputValue, setInputValue] = useState("");
  const hasActiveFilters = filters?.some((f) => filterValues[f.key]);
  const hasRowActions = onView || onEdit || onDelete || extraRowAction;
  const pageCount = Math.ceil(total / pageSize);
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  // ── Column order (drag-to-reorder) ────────────────────────────────
  const [colOrder, setColOrder] = useState<string[]>(() => columns.map((c) => c.key));
  const dragSrcKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Reset order when columns change (navigating between pages)
  useEffect(() => {
    setColOrder(columns.map((c) => c.key));
  }, [columns.map((c) => c.key).join(",")]);

  const orderedColumns = colOrder
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is Column<T> => !!c);

  // ── Column widths (resize) ────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    columns.forEach((col) => { w[col.key] = col.width ?? defaultColWidth(col.key); });
    return w;
  });

  // Initialise new keys when columns change
  useEffect(() => {
    setColWidths((prev) => {
      const next = { ...prev };
      columns.forEach((col) => { if (next[col.key] == null) next[col.key] = col.width ?? defaultColWidth(col.key); });
      return next;
    });
  }, [columns.map((c) => c.key).join(",")]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[key] ?? defaultColWidth(key);
    const onMove = (ev: PointerEvent) => {
      setColWidths((prev) => ({ ...prev, [key]: Math.max(60, startW + ev.clientX - startX) }));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // ── Sorting ───────────────────────────────────────────────────────
  const handleSort = (key: string) => {
    if (!onSort) return;
    onSort(key, sortKey === key && sortDir === "asc" ? "desc" : "asc");
    onPageChange(0);
  };

  // ── Search debounce ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { onSearch(inputValue); onPageChange(0); }, 350);
    return () => clearTimeout(t);
  }, [inputValue]);

  // ── Drag-to-reorder handlers ──────────────────────────────────────
  const handleDrop = (targetKey: string) => {
    const src = dragSrcKey.current;
    if (!src || src === targetKey) { setDragOverKey(null); return; }
    const order = [...colOrder];
    const from = order.indexOf(src);
    const to = order.indexOf(targetKey);
    order.splice(from, 1);
    order.splice(to, 0, src);
    setColOrder(order);
    setDragOverKey(null);
    dragSrcKey.current = null;
  };

  const ACTIONS_W = 100;

  return (
    <div className="h-full flex flex-col p-6 md:p-8 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total.toLocaleString()} records</p>
        </div>
        <div className="flex items-center gap-2">
          {action}
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

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
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
        {hasActiveFilters && (
          <button
            onClick={() => { filters?.forEach((f) => onFilterChange?.(f.key, "")); onPageChange(0); }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col rounded-xl border border-border overflow-hidden min-h-0">
        <div className="flex-1 overflow-auto">
          <table
            className="text-sm border-collapse"
            style={{ tableLayout: "fixed", width: orderedColumns.reduce((s, c) => s + (colWidths[c.key] ?? defaultColWidth(c.key)), 0) + (hasRowActions ? ACTIONS_W : 0) }}
          >
            <colgroup>
              {orderedColumns.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] ?? defaultColWidth(col.key) }} />
              ))}
              {hasRowActions && <col style={{ width: ACTIONS_W }} />}
            </colgroup>
            <thead>
              <tr className="bg-secondary/50 border-b border-border">
                {orderedColumns.map((col) => (
                  <th
                    key={col.key}
                    draggable
                    onDragStart={() => { dragSrcKey.current = col.key; }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverKey(col.key); }}
                    onDragLeave={() => setDragOverKey(null)}
                    onDrop={() => handleDrop(col.key)}
                    onDragEnd={() => { dragSrcKey.current = null; setDragOverKey(null); }}
                    onClick={col.sortable && onSort ? () => handleSort(col.key) : undefined}
                    className={[
                      "relative px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none",
                      "cursor-grab active:cursor-grabbing",
                      col.sortable && onSort ? "hover:text-foreground" : "",
                      dragOverKey === col.key ? "bg-primary/10" : "",
                    ].join(" ")}
                    style={{ overflow: "hidden" }}
                  >
                    <span className="inline-flex items-center gap-1 truncate">
                      {col.label}
                      {col.sortable && onSort && (
                        <ChevronsUpDown className={`h-3.5 w-3.5 ml-0.5 shrink-0 ${sortKey === col.key ? "text-primary" : "text-muted-foreground/40"}`} />
                      )}
                    </span>
                    {/* Resize handle */}
                    <div
                      className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors z-10"
                      onPointerDown={(e) => startResize(e, col.key)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                ))}
                {hasRowActions && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider" style={{ width: ACTIONS_W }} />
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {orderedColumns.map((col) => (
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
                    colSpan={orderedColumns.length + (hasRowActions ? 1 : 0)}
                    className="px-4 py-12 text-center text-muted-foreground text-sm"
                  >
                    No records found.
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors group">
                    {orderedColumns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-foreground" style={{ overflow: "hidden", maxWidth: colWidths[col.key] ?? defaultColWidth(col.key) }}>
                        {col.render
                          ? col.render(row)
                          : <span className="block truncate">{String(row[col.key] ?? "—")}</span>
                        }
                      </td>
                    ))}
                    {hasRowActions && (
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {extraRowAction && extraRowAction(row)}
                          {onView && (
                            <button onClick={() => onView(row)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="View">
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onEdit && (
                            <button onClick={() => onEdit(row)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onDelete && (
                            <button onClick={() => onDelete(row)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Delete">
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

        {/* Pagination */}
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
