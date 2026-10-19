// Questions the assistant sent us — cross-brand.
//
// The brand already sees its own knowledge gaps and 👎s on its Knowledge page.
// This is the other half, and it is ours: what associates asked that the
// assistant could not answer because the answer isn't the house's to give —
// an integration, a feature, something that looks broken. Two ways in: the
// associate pressed "Ask AION" on an answer, or the assistant filed it itself.
//
// Cross-brand on purpose. One house asking about Shopify is a support ticket;
// four houses asking in a month is a roadmap item, and that is only visible
// from here.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useListUrlState } from "@/hooks/useListUrlState";
import AdminTable from "./_components/AdminTable";
import AdminDrawer from "./_components/AdminDrawer";
import { FormField, Input } from "./_components/FormField";
import { fmtDate } from "./_components/fmtDate";
import { resolveSortOrder } from "./_utils/resolveSortOrder";
import type { ExportColumn } from "./_utils/exportCsv";
import { toast } from "sonner";
import { LifeBuoy, Sparkles } from "lucide-react";

const SORT_RELATIONS = ["brands", "profiles"] as const;
const PAGE_SIZE = 25;

const EXPORT_SCHEMA: ExportColumn[] = [
  { key: "created_at",     label: "First asked" },
  { key: "last_seen",      label: "Last asked" },
  { key: "brands_name",    label: "Brand" },
  { key: "source",         label: "Source" },
  { key: "question",       label: "Question" },
  { key: "note",           label: "Their note" },
  { key: "answer_excerpt", label: "What the assistant said" },
  { key: "hits",           label: "Times asked" },
  { key: "status",         label: "Status" },
  { key: "admin_note",     label: "Our note" },
];

interface Escalation {
  id: string;
  brand_id: number | null;
  profile_id: string | null;
  chat_id: string | null;
  source: "associate" | "assistant";
  question: string;
  note: string | null;
  answer_excerpt: string | null;
  hits: number;
  status: "open" | "handled";
  admin_note: string | null;
  handled_at: string | null;
  last_seen: string;
  created_at: string;
  brand_name?: string | null;
  brand_logo?: string | null;
  asker_name?: string | null;
  asker_email?: string | null;
}

interface BrandOption { id: number; name: string | null; }

// A free-text term for or(): or() is split on commas BEFORE unescaping, so a
// comma in the search box silently matched nothing until the value was quoted.
const ilikeTerm = (raw: string): string => {
  const t = raw.trim();
  if (!t) return "";
  const literal = t.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `"%${literal.replace(/["\\]/g, (c) => `\\${c}`)}%"`;
};

const SourceBadge = ({ source }: { source: Escalation["source"] }) => {
  const isAssistant = source === "assistant";
  const Icon = isAssistant ? Sparkles : LifeBuoy;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
      <Icon className="h-3 w-3 text-primary" />
      {isAssistant ? "Assistant" : "Associate"}
    </span>
  );
};

const StatusBadge = ({ status }: { status: Escalation["status"] }) => (
  <span
    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
      status === "open"
        ? "bg-amber-500/10 text-amber-600"
        : "bg-emerald-500/10 text-emerald-600"
    }`}
  >
    {status === "open" ? "Open" : "Handled"}
  </span>
);

const AdminAssistantInbox = () => {
  const [rows, setRows] = useState<Escalation[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const { page, search, sortKey, sortDir, filterValues, setPage, setSearch, setSort, setFilter } =
    useListUrlState({ defaultSortKey: "last_seen", defaultSortDir: "desc", filterKeys: ["brand_id", "status", "source"] });
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewing, setViewing] = useState<Escalation | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const decorate = (r: Record<string, unknown>): Escalation => {
    const rel = r as unknown as Escalation & {
      brands?: { name?: string; logo_small?: string } | null;
      profiles?: { first_name?: string; last_name?: string; email?: string } | null;
    };
    return {
      ...(r as unknown as Escalation),
      brand_name: rel.brands?.name ?? "—",
      brand_logo: rel.brands?.logo_small ?? null,
      asker_name: [rel.profiles?.first_name, rel.profiles?.last_name].filter(Boolean).join(" ") || null,
      asker_email: rel.profiles?.email ?? null,
    };
  };

  const baseSelect = "*, brands(name, logo_small), profiles(first_name, last_name, email)";

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let query = supabase
      .from("assistant_escalations" as never)
      .select(baseSelect, { count: "exact" })
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (filterValues.brand_id) query = query.eq("brand_id", Number(filterValues.brand_id));
    if (filterValues.status) query = query.eq("status", filterValues.status);
    if (filterValues.source) query = query.eq("source", filterValues.source);
    if (search) {
      const safe = ilikeTerm(search);
      query = query.or(`question.ilike.${safe},note.ilike.${safe}`);
    }
    void query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      if (error) { console.error("[assistant inbox]", error.message); setLoading(false); return; }
      setRows(((data ?? []) as unknown as Record<string, unknown>[]).map(decorate));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(fetchData, [page, search, filterValues, sortKey, sortDir]);

  useEffect(() => {
    void supabase.from("brands").select("id, name").order("name")
      .then(({ data }) => setBrands((data as BrandOption[]) ?? []));
  }, []);

  // The number that matters on this page: how many are still waiting on us.
  const refreshOpenCount = () => {
    void supabase
      .from("assistant_escalations" as never)
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .then(({ count }) => setOpenCount(count ?? 0));
  };
  useEffect(refreshOpenCount, [rows]);

  const openView = (row: Record<string, unknown>) => {
    const r = row as unknown as Escalation;
    setViewing(r);
    setAdminNote(r.admin_note ?? "");
    setDrawerOpen(true);
  };

  const save = async (nextStatus?: Escalation["status"]) => {
    if (!viewing) return;
    setSaving(true);
    const patch: Record<string, unknown> = { admin_note: adminNote.trim() || null };
    if (nextStatus) {
      patch.status = nextStatus;
      patch.handled_at = nextStatus === "handled" ? new Date().toISOString() : null;
    }
    const { error } = await supabase
      .from("assistant_escalations" as never)
      .update(patch as never)
      .eq("id", viewing.id);
    setSaving(false);
    if (error) { toast.error("Couldn't save."); return; }
    toast.success(nextStatus === "handled" ? "Marked handled." : nextStatus === "open" ? "Reopened." : "Note saved.");
    setRows((rs) => rs.map((r) => (r.id === viewing.id ? { ...r, ...(patch as Partial<Escalation>) } : r)));
    setViewing((v) => (v ? { ...v, ...(patch as Partial<Escalation>) } : v));
    if (nextStatus) setDrawerOpen(false);
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let q = supabase
      .from("assistant_escalations" as never)
      .select(baseSelect)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .limit(10000);
    if (filterValues.brand_id) q = q.eq("brand_id", Number(filterValues.brand_id));
    if (filterValues.status) q = q.eq("status", filterValues.status);
    if (filterValues.source) q = q.eq("source", filterValues.source);
    const { data } = await q;
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(decorate) as unknown as Record<string, unknown>[];
  };

  return (
    <>
      <AdminTable
        title={openCount > 0 ? `Assistant Inbox · ${openCount} open` : "Assistant Inbox"}
        data={rows as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={setSearch}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={setSort}
        onExport={handleExport} exportFilename="assistant-inbox" exportSchema={EXPORT_SCHEMA}
        onView={openView}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
          { key: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "handled", label: "Handled" }] },
          { key: "source", label: "Source", options: [{ value: "associate", label: "Associate" }, { value: "assistant", label: "Assistant" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={setFilter}
        columns={[
          {
            key: "question", label: "Question", sortable: false,
            render: (row) => {
              const r = row as unknown as Escalation;
              return (
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground line-clamp-1" title={r.question}>{r.question}</p>
                  {r.note && <p className="text-xs text-muted-foreground line-clamp-1" title={r.note}>{r.note}</p>}
                </div>
              );
            },
          },
          {
            key: "brand_name", sortKey: "brands_name", label: "Brand", width: 180,
            render: (row) => {
              const r = row as unknown as Escalation;
              return (
                <div className="flex items-center gap-2">
                  {r.brand_logo
                    ? <div className="h-6 w-6 rounded bg-white flex items-center justify-center shrink-0 border border-border/30"><img src={r.brand_logo} alt={r.brand_name ?? ""} className="h-5 w-5 object-contain" /></div>
                    : <div className="h-6 w-6 rounded bg-muted shrink-0" />}
                  <span className="text-sm text-foreground truncate">{r.brand_name}</span>
                </div>
              );
            },
          },
          {
            key: "source", label: "From", width: 130,
            render: (row) => <SourceBadge source={(row as unknown as Escalation).source} />,
          },
          {
            key: "hits", label: "Asked", sortable: true, width: 90,
            render: (row) => {
              const n = (row as unknown as Escalation).hits;
              return <span className="text-sm tabular-nums text-foreground">{n > 1 ? `${n}×` : "1×"}</span>;
            },
          },
          {
            key: "status", label: "Status", sortable: true, width: 110,
            render: (row) => <StatusBadge status={(row as unknown as Escalation).status} />,
          },
          {
            key: "last_seen", label: "Last asked", sortable: true, width: 160,
            render: (row) => fmtDate((row as unknown as Escalation).last_seen),
          },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Question to AION">
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Brand">
                <Input disabled value={viewing.brand_name ?? "—"} />
              </FormField>
              <FormField label="Asked by">
                <Input disabled value={viewing.asker_name || viewing.asker_email || "—"} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="From">
                <Input disabled value={viewing.source === "assistant" ? "Assistant" : "Associate"} />
              </FormField>
              <FormField label="Times asked">
                <Input disabled value={String(viewing.hits)} />
              </FormField>
              <FormField label="Last asked">
                <Input disabled value={fmtDate(viewing.last_seen)} />
              </FormField>
            </div>

            <FormField label="Question">
              <textarea
                disabled rows={3} value={viewing.question}
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground resize-none"
              />
            </FormField>

            {viewing.note && (
              <FormField label="What they added">
                <textarea
                  disabled rows={3} value={viewing.note}
                  className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground resize-none"
                />
              </FormField>
            )}

            {viewing.answer_excerpt && (
              <FormField label="What the assistant had answered">
                <textarea
                  disabled rows={4} value={viewing.answer_excerpt}
                  className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground resize-none"
                />
              </FormField>
            )}

            <FormField label="Our note (never shown to the brand)">
              <textarea
                rows={4} value={adminNote} onChange={(e) => setAdminNote(e.target.value)}
                placeholder="What we answered, or what this turns into."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none outline-none focus:border-primary/50"
              />
            </FormField>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button" disabled={saving} onClick={() => void save()}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Save note
              </button>
              {viewing.status === "open" ? (
                <button
                  type="button" disabled={saving} onClick={() => void save("handled")}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Mark handled
                </button>
              ) : (
                <button
                  type="button" disabled={saving} onClick={() => void save("open")}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Reopen
                </button>
              )}
            </div>
          </div>
        )}
      </AdminDrawer>
    </>
  );
};

export default AdminAssistantInbox;
