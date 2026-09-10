import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { ExternalLink } from "lucide-react";
import { formatCountry, formatWebsiteLabel, websiteHref } from "@/lib/format";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, TextArea, SaveBar } from "./_components/FormField";
import { ImageUpload } from "./_components/ImageUpload";
import { DEFAULT_MAX_COVERED_VALUE } from "@/lib/coverage";

const PAGE_SIZE = 25;

const AdminBrands = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [total, setTotal] = useState(0);
  const { page, search, sortKey, sortDir, filterValues, setPage, setSearch, setSort, setFilter } =
    useListUrlState({ defaultSortKey: "name", defaultSortDir: "asc", filterKeys: ["status"] });
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
      .select("id, name, slug, email, website, hq_country, status, logo_small, logo_big", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%,hq_country.ilike.%${search}%,website.ilike.%${search}%,status.ilike.%${search}%`);
    if (filterValues.status) query = query.eq("status", filterValues.status);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setBrands((data as Brand[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir]);


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
      .select("id, name, slug, email, website, hq_country, status, enable_chubb_reporting, chubb_policy_prefix, activation_fee, insurance_premium, aion_premium_fee, max_covered_value, min_covered_value")
      .order(sortKey, { ascending: sortDir === "asc" })
      .limit(10000);
    if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%,hq_country.ilike.%${search}%,website.ilike.%${search}%,status.ilike.%${search}%`);
    if (filterValues.status) q = q.eq("status", filterValues.status);
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
