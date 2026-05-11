import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useListUrlState } from "@/hooks/useListUrlState";
import AdminTable from "./_components/AdminTable";
import AdminDrawer from "./_components/AdminDrawer";
import { FormField, Input } from "./_components/FormField";
import { fmtDate } from "./_components/fmtDate";
import { resolveSortOrder } from "./_utils/resolveSortOrder";
import type { ExportColumn } from "./_utils/exportCsv";
import { Star } from "lucide-react";

const SORT_RELATIONS = ["brands", "profiles"] as const;

const FEEDBACK_SCHEMA: ExportColumn[] = [
  { key: "id",                   label: "ID" },
  { key: "created_at",           label: "Date" },
  { key: "profiles_first_name",  label: "Customer First Name" },
  { key: "profiles_last_name",   label: "Customer Last Name" },
  { key: "profiles_email",       label: "Customer Email" },
  { key: "brands_name",          label: "Brand" },
  { key: "satisfaction_rate",    label: "Satisfaction Rate" },
  { key: "recommendation_rate",  label: "Recommendation Rate" },
  { key: "peace_of_mind_rate",   label: "Peace of Mind Rate" },
  { key: "comment",              label: "Comment" },
];

interface Feedback {
  id: number;
  brand_id: number | null;
  user_id: string | null;
  comment: string | null;
  satisfaction_rate: number | null;
  recommendation_rate: number | null;
  peace_of_mind_rate: number | null;
  created_at: string;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_first?: string | null;
  customer_last?: string | null;
  customer_avatar?: string | null;
  brand_name?: string | null;
  brand_logo?: string | null;
}

interface BrandOption { id: number; name: string | null; }

const PAGE_SIZE = 25;

const RateCell = ({ value }: { value: number | null }) => {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <Star className="h-3.5 w-3.5 fill-primary text-primary" />
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
};

const AdminFeedback = () => {
  const [rows, setRows] = useState<Feedback[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [total, setTotal] = useState(0);
  const { page, search, sortKey, sortDir, filterValues, setPage, setSearch, setSort, setFilter } =
    useListUrlState({ defaultSortKey: "created_at", defaultSortDir: "desc", filterKeys: ["brand_id"] });
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewing, setViewing] = useState<Feedback | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    if (brands.length === 0) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    const brandFilterIds = filterValues.brand_id ? [Number(filterValues.brand_id)] : brands.map((b) => b.id);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let query = supabase
      .from("feedback")
      .select("*, brands(*), profiles(id, first_name, last_name, email, avatar)", { count: "exact" })
      .in("brand_id", brandFilterIds)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.ilike("comment", `%${search}%`);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setRows((data ?? []).map((r: any) => ({
        ...r,
        customer_email: r.profiles?.email ?? null,
        customer_first: r.profiles?.first_name ?? null,
        customer_last: r.profiles?.last_name ?? null,
        customer_name: [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") || null,
        customer_avatar: r.profiles?.avatar ?? null,
        brand_name: r.brands?.name ?? "—",
        brand_logo: r.brands?.logo_small ?? null,
      })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir, brands]);

  useEffect(() => {
    supabase.from("brands").select("id, name").eq("status", "verified").order("name").then(({ data }) => setBrands((data as BrandOption[]) ?? []));
  }, []);

  const openView = (row: Record<string, unknown>) => {
    setViewing(row as unknown as Feedback);
    setDrawerOpen(true);
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    const brandFilterIds = filterValues.brand_id ? [Number(filterValues.brand_id)] : brands.map((b) => b.id);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let q = supabase
      .from("feedback")
      .select("*, brands(*), profiles(id, first_name, last_name, email)")
      .in("brand_id", brandFilterIds)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .limit(10000);
    if (search) q = q.ilike("comment", `%${search}%`);
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  };

  return (
    <>
      <AdminTable
        title="Feedback"
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
        onExport={handleExport} exportFilename="feedback" exportSchema={FEEDBACK_SCHEMA}
        onView={openView}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
        ]}
        filterValues={filterValues}
        onFilterChange={setFilter}
        columns={[
          {
            key: "customer_email", sortKey: "profiles_email", label: "Customer", width: 240,
            render: (row) => {
              const r = row as unknown as Feedback;
              const name = r.customer_name || r.customer_email || "—";
              const initials = `${(r.customer_first?.[0] || r.customer_email?.[0] || "?").toUpperCase()}${(r.customer_last?.[0] || "").toUpperCase()}`;
              return (
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {r.customer_avatar ? <img src={r.customer_avatar} alt={name} className="h-full w-full object-cover" /> : initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{name}</p>
                    {r.customer_name && <p className="text-xs text-muted-foreground truncate">{r.customer_email}</p>}
                  </div>
                </div>
              );
            },
          },
          {
            key: "brand_name", sortKey: "brands_name", label: "Brand",
            render: (row) => {
              const r = row as unknown as Feedback;
              return (
                <div className="flex items-center gap-2">
                  {r.brand_logo
                    ? <div className="h-6 w-6 rounded bg-white flex items-center justify-center shrink-0 border border-border/30"><img src={r.brand_logo} alt={r.brand_name ?? ""} className="h-5 w-5 object-contain" /></div>
                    : <div className="h-6 w-6 rounded bg-muted shrink-0" />}
                  <span className="text-sm text-foreground">{r.brand_name}</span>
                </div>
              );
            },
          },
          {
            key: "satisfaction_rate", label: "Satisfaction", sortable: true, width: 120,
            render: (row) => <RateCell value={(row as unknown as Feedback).satisfaction_rate} />,
          },
          {
            key: "recommendation_rate", label: "Recommendation", sortable: true, width: 140,
            render: (row) => <RateCell value={(row as unknown as Feedback).recommendation_rate} />,
          },
          {
            key: "peace_of_mind_rate", label: "Peace of Mind", sortable: true, width: 130,
            render: (row) => <RateCell value={(row as unknown as Feedback).peace_of_mind_rate} />,
          },
          {
            key: "comment", label: "Comment", sortable: false,
            render: (row) => {
              const r = row as unknown as Feedback;
              if (!r.comment) return <span className="text-muted-foreground">—</span>;
              return <span className="text-sm text-foreground line-clamp-1" title={r.comment}>{r.comment}</span>;
            },
          },
          {
            key: "created_at", label: "Date", sortable: true, width: 160,
            render: (row) => fmtDate((row as unknown as Feedback).created_at),
          },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="View Feedback">
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Customer">
                <Input disabled value={viewing.customer_name || viewing.customer_email || "—"} />
              </FormField>
              <FormField label="Email">
                <Input disabled value={viewing.customer_email ?? "—"} />
              </FormField>
            </div>
            <FormField label="Brand">
              <Input disabled value={viewing.brand_name ?? "—"} />
            </FormField>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Satisfaction">
                <Input disabled value={viewing.satisfaction_rate != null ? String(viewing.satisfaction_rate) : "—"} />
              </FormField>
              <FormField label="Recommendation">
                <Input disabled value={viewing.recommendation_rate != null ? String(viewing.recommendation_rate) : "—"} />
              </FormField>
              <FormField label="Peace of Mind">
                <Input disabled value={viewing.peace_of_mind_rate != null ? String(viewing.peace_of_mind_rate) : "—"} />
              </FormField>
            </div>
            <FormField label="Comment">
              <textarea
                disabled
                rows={6}
                value={viewing.comment ?? ""}
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground resize-none"
              />
            </FormField>
            <FormField label="Date">
              <Input disabled value={fmtDate(viewing.created_at)} />
            </FormField>
            <div className="flex justify-end pt-4 border-t border-border mt-4">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </AdminDrawer>
    </>
  );
};

export default AdminFeedback;
