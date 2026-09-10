import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
import { useToast } from "@/hooks/use-toast";
import { useListUrlState } from "@/hooks/useListUrlState";
import { useNavigate } from "react-router-dom";
import AdminTable, { StatusBadge } from "./_components/AdminTable";
import type { Brand } from "./_components/BrandRecordForm";
import type { ExportColumn } from "./_utils/exportCsv";


const BRANDS_SCHEMA: ExportColumn[] = [
  { key: "id",                    label: "ID" },
  { key: "name",                  label: "Brand Name" },
  { key: "slug",                  label: "Slug" },
  { key: "email",                 label: "Email" },
  { key: "website",               label: "Website" },
  { key: "hq_country",            label: "HQ Country" },
  { key: "status",                label: "Status" },
  { key: "is_prospect",           label: "Prospect" },
  { key: "activation_fee",        label: "Activation Fee" },
  { key: "insurance_premium",     label: "Insurance Premium" },
  { key: "aion_premium_fee",      label: "AION Premium Fee" },
  { key: "max_covered_value",     label: "Max Covered Value" },
  { key: "min_covered_value",     label: "Min Covered Value" },
  { key: "enable_chubb_reporting",label: "Chubb Reporting" },
  { key: "chubb_policy_prefix",   label: "Chubb Policy Prefix" },
];
import AdminDrawer from "./_components/AdminDrawer";
import { Link } from "react-router-dom";
import { AlertCircle, ExternalLink } from "lucide-react";
import { CYCLE_STEPS, stepStateLabel } from "@/lib/commercialCycle";
import { formatCountry, formatWebsiteLabel, websiteHref } from "@/lib/format";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, TextArea, SaveBar } from "./_components/FormField";
import { ImageUpload } from "./_components/ImageUpload";
import { DEFAULT_MAX_COVERED_VALUE } from "@/lib/coverage";

const PAGE_SIZE = 25;

// Where every deal stands, for the list.
//
// brand_commercial_progress has recorded this per brand since the cycle shipped and nothing
// ever aggregated it: the cycle screen could answer "where is Pasquale Bruni" only if you
// already knew to open Pasquale Bruni. The question the job actually asks — "where are all
// of them, and what is anyone waiting on" — had no screen at all, and no nav item either
// once the commercial pages became redirects.
//
// One RPC for every brand, once. There are a handful of houses; a per-row query would cost
// more than the whole table.
type PipelineRow = {
  brand_id: number;
  is_prospect: boolean;
  step: number | null;
  step_state: string | null;
  steps_done: number;
  last_touch: string | null;
  blocking: string | null;
  artifacts: number;
};

// Roberto Coin has been live for a year and nobody ever recorded its cycle, so the RPC
// truthfully reports it as sitting on step 1 with an intro deck still to build. True, and
// noise: the five steps are how a house BECOMES a client, and this one already is. A deal
// always shows where it is, even on its first day; a client shows the cycle only if someone
// actually ran one.
const hasCycle = (p: PipelineRow): boolean =>
  p.is_prospect || p.steps_done > 0 || p.artifacts > 0 || p.last_touch != null;

const sinceLabel = (iso: string | null): string => {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
};

const AdminBrands = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [total, setTotal] = useState(0);
  const { page, search, sortKey, sortDir, filterValues, setPage, setSearch, setSort, setFilter } =
    useListUrlState({ defaultSortKey: "name", defaultSortDir: "asc", filterKeys: ["status", "kind"] });
  // Undefined until it has been read: an empty map would render every brand as "not started",
  // which is a claim about the deal and not a placeholder.
  const [pipeline, setPipeline] = useState<Record<number, PipelineRow> | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);
  // Brand whose demo-preparation panel is open (lead → demo, in one place).
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    // List view: only fetch columns needed for the table — heavy fields (FAQs, images, fees)
    // are loaded on-demand when a drawer is opened.
    let query = supabase
      .from("brands")
      .select("id, name, slug, email, website, hq_country, status, logo_small, logo_big, is_prospect", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%,hq_country.ilike.%${search}%,website.ilike.%${search}%,status.ilike.%${search}%`);
    if (filterValues.status) query = query.eq("status", filterValues.status);
    if (filterValues.kind) query = query.eq("is_prospect", filterValues.kind === "prospect");
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setBrands((data as Brand[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir]);

  // Once, not per page: the commercial state of four houses is smaller than one page of the
  // table it decorates, and re-reading it on every sort would be noise.
  useEffect(() => {
    void (async () => {
      const { data, error } = await untyped.rpc("commercial_pipeline");
      if (error) { setPipeline({}); return; }
      const map: Record<number, PipelineRow> = {};
      for (const r of (data ?? []) as PipelineRow[]) map[r.brand_id] = r;
      setPipeline(map);
    })();
  }, []);


  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("brands").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Brand deleted" });
    fetchData();
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    let q = supabase
      .from("brands")
      .select("id, name, slug, email, website, hq_country, status, is_prospect, enable_chubb_reporting, chubb_policy_prefix, activation_fee, insurance_premium, aion_premium_fee, max_covered_value, min_covered_value")
      .order(sortKey, { ascending: sortDir === "asc" })
      .limit(10000);
    if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%,hq_country.ilike.%${search}%,website.ilike.%${search}%,status.ilike.%${search}%`);
    if (filterValues.status) q = q.eq("status", filterValues.status);
    if (filterValues.kind) q = q.eq("is_prospect", filterValues.kind === "prospect");
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  };

  return (
    <>
      <AdminTable
        title="Brands"
        data={brands as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={setSearch}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={setSort}
        onExport={handleExport} exportFilename="brands" exportSchema={BRANDS_SCHEMA}
        onAdd={() => navigate("/admin/brands/new")} addLabel="New Brand"
        onView={(row) => navigate(`/admin/brands/${(row as unknown as Brand).id}`)}
        onEdit={(row) => navigate(`/admin/brands/${(row as unknown as Brand).id}`)}
        onDelete={(row) => setDeleteTarget(row as unknown as Brand)}
        extraRowAction={(row) => {
          const r = row as unknown as Brand;
          return (
            /* One door. Demo prep is step 3 of the cycle, and it used to open in
               a drawer here as well — the same panel in two places, with only
               one of them able to show what else had been done for the brand. */
            <Link
              to={`/admin/brands/${r.id}?tab=cycle`}
              onClick={(e) => e.stopPropagation()}
              title="The commercial cycle for this brand — deck, data request, demo, pricing, ops"
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Cycle
            </Link>
          );
        }}
        filters={[
          // A deal and a live programme are different jobs and the table has always shown
          // them mixed together, separated only by `status` — which is about account
          // verification and says nothing about whether these people have signed anything.
          { key: "kind", label: "Kind", options: [{ value: "prospect", label: "Prospects" }, { value: "client", label: "Clients" }] },
          { key: "status", label: "Status", options: [{ value: "pending", label: "Pending" }, { value: "verified", label: "Verified" }, { value: "blocked", label: "Blocked" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={setFilter}
        columns={[
          {
            key: "name", label: "Brand", sortable: true, width: 220,
            render: (row) => {
              const r = row as unknown as Brand;
              return (
                <div className="flex items-center gap-3">
                  {r.logo_small ? (
                    <div className="h-8 w-8 rounded bg-white flex items-center justify-center p-1 shrink-0">
                      <img src={r.logo_small} alt={r.name ?? ""} className="h-full w-full object-contain" />
                    </div>
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{(r.name?.[0] ?? "?").toUpperCase()}</div>
                  )}
                  <div>
                    <p className="font-medium text-foreground">{r.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{r.slug ?? "—"}</p>
                  </div>
                </div>
              );
            },
          },
          {
            // Not sortable: it is computed by commercial_pipeline() for every brand at once,
            // not a column PostgREST can order the page by.
            key: "cycle", label: "Stage", sortable: false, width: 200,
            render: (row) => {
              const r = row as unknown as Brand;
              if (!pipeline) return <span className="inline-block h-3.5 w-28 animate-pulse rounded bg-muted" />;
              const p = pipeline[r.id];
              if (!p || !hasCycle(p)) return <span className="text-muted-foreground">—</span>;
              const step = p.step == null ? null : CYCLE_STEPS.find((s) => s.n === p.step);
              return (
                <div className="min-w-0">
                  <p className="truncate text-foreground">
                    {step ? <>{step.n}. {step.title}</> : <span className="text-emerald-700 dark:text-emerald-400">All five done</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {step ? `${stepStateLabel(p.step_state)} · ` : ""}
                    {p.steps_done}/5 · {sinceLabel(p.last_touch)}
                  </p>
                </div>
              );
            },
          },
          {
            key: "blocking", label: "Waiting on", sortable: false, width: 220,
            render: (row) => {
              const r = row as unknown as Brand;
              if (!pipeline) return <span className="inline-block h-3.5 w-32 animate-pulse rounded bg-muted" />;
              const p = pipeline[r.id];
              const blocking = p && hasCycle(p) ? p.blocking : null;
              if (!blocking) return <span className="text-muted-foreground">—</span>;
              return (
                <span className="inline-flex min-w-0 items-start gap-1.5 text-amber-700 dark:text-amber-500" title={blocking}>
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{blocking}</span>
                </span>
              );
            },
          },
          { key: "email", label: "Email", sortable: true },
          {
            key: "hq_country", label: "Country", sortable: true,
            // Stored as free text, so the same country arrives as "Italy" or as "IT".
            render: (row) => <span>{formatCountry((row as unknown as Brand).hq_country)}</span>,
          },
          {
            key: "website", label: "Website",
            render: (row) => {
              const href = websiteHref((row as unknown as Brand).website);
              if (!href) return <span className="text-muted-foreground">—</span>;
              return (
                // stopPropagation: the row itself opens the brand, and a click meant for
                // the site should not also navigate away behind the new tab.
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-foreground hover:text-primary hover:underline"
                >
                  {formatWebsiteLabel((row as unknown as Brand).website)}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                </a>
              );
            },
          },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Brand; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
        ]}
      />


      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Brand"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminBrands;
