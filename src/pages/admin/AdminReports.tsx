import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { fmtDate } from "./_components/fmtDate";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge } from "./_components/AdminTable";
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { resolveSortOrder } from "./_utils/resolveSortOrder";

const SORT_RELATIONS = ["brands"] as const;

interface Report {
  id: number;
  name: string;
  type: string | null;
  source: string | null;
  direction: string | null;
  start_date: string | null;
  end_date: string | null;
  url: string;
  brand_id: number | null;
  created_at: string;
  created_by: string | null;
  uploaded_to_chubb: boolean | null;
  uploaded_to_chubb_at: string | null;
  brand_name?: string;
}

const PAGE_SIZE = 25;

const AdminReports = () => {
  const { toast } = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Report | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = () => {
    setLoading(true);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let query = supabase
      .from("reports")
      .select("id, name, type, source, direction, start_date, end_date, url, brand_id, created_at, created_by, uploaded_to_chubb, uploaded_to_chubb_at, brands!inner(name, status)", { count: "exact" })
      .eq("brands.status", "verified")
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`name.ilike.%${search}%,type.ilike.%${search}%,source.ilike.%${search}%,direction.ilike.%${search}%,created_by.ilike.%${search}%`);
    query.then(({ data, count }) => {
      setReports((data ?? []).map((r: any) => ({ ...r, brand_name: r.brands?.name ?? "—" })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, sortKey, sortDir]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("reports").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Report deleted" });
    fetchData();
  };

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <p className="text-sm text-muted-foreground shrink-0 w-36">{label}</p>
      <p className="text-sm text-foreground text-right break-all">{value || "—"}</p>
    </div>
  );

  return (
    <>
      <AdminTable
        title="Reports"
        data={reports as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onView={(row) => setViewing(row as unknown as Report)}
        onDelete={(row) => setDeleteTarget(row as unknown as Report)}
        columns={[
          {
            key: "name", label: "Name", sortable: true,
            render: (row) => {
              const r = row as unknown as Report;
              return <p className="font-medium text-foreground">{r.name}</p>;
            },
          },
          { key: "brand_name", sortKey: "brands_name", label: "Brand" },
          { key: "type", label: "Type", sortable: true },
          { key: "source", label: "Source" },
          {
            key: "start_date", label: "Period", sortable: true,
            render: (row) => {
              const r = row as unknown as Report;
              const from = fmtDate(r.start_date);
              const to = fmtDate(r.end_date);
              return <span className="text-sm">{from} → {to}</span>;
            },
          },
          {
            key: "uploaded_to_chubb", label: "Chubb",
            render: (row) => {
              const r = row as unknown as Report;
              return r.uploaded_to_chubb
                ? <StatusBadge status="active" />
                : <span className="text-xs text-muted-foreground">—</span>;
            },
          },
          {
            key: "created_at", label: "Created", sortable: true,
            render: (row) => { const r = row as unknown as Report; return fmtDate(r.created_at); },
          },
        ]}
      />

      {/* View drawer */}
      <AdminDrawer open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? "Report"}>
        {viewing && (
          <div className="space-y-1">
            <InfoRow label="Name" value={viewing.name} />
            <InfoRow label="Brand" value={viewing.brand_name ?? "—"} />
            <InfoRow label="Type" value={viewing.type ?? ""} />
            <InfoRow label="Source" value={viewing.source ?? ""} />
            <InfoRow label="Direction" value={viewing.direction ?? ""} />
            <InfoRow label="Start Date" value={fmtDate(viewing.start_date)} />
            <InfoRow label="End Date" value={fmtDate(viewing.end_date)} />
            <InfoRow label="Created" value={fmtDate(viewing.created_at)} />
            <InfoRow label="Created By" value={viewing.created_by ?? ""} />
            <InfoRow label="Uploaded to Chubb" value={viewing.uploaded_to_chubb ? "Yes" : "No"} />
            {viewing.uploaded_to_chubb_at && (
              <InfoRow label="Uploaded At" value={fmtDate(viewing.uploaded_to_chubb_at)} />
            )}
            {viewing.url && (
              <div className="pt-4">
                <a
                  href={viewing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Report
                </a>
              </div>
            )}
            <div className="flex justify-end pt-6 border-t border-border mt-4">
              <button type="button" onClick={() => setViewing(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">Close</button>
            </div>
          </div>
        )}
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Report"
        description={`Delete report "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminReports;
