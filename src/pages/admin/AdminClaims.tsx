import { useEffect, useRef, useState } from "react";
import { Upload, X, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge, toTitleCase } from "./_components/AdminTable";
import type { ExportColumn } from "./_utils/exportCsv";

const CLAIMS_SCHEMA: ExportColumn[] = [
  { key: "id",                            label: "ID" },
  { key: "policies_brands_name",          label: "Brand" },
  { key: "policies_catalogues_name",      label: "Item Name" },
  { key: "policies_catalogues_sku",       label: "Item SKU" },
  { key: "policies_profiles_email",       label: "Customer Email" },
  { key: "policies_profiles_first_name",  label: "Customer First Name" },
  { key: "policies_profiles_last_name",   label: "Customer Last Name" },
  { key: "policy_id",                     label: "Policy ID" },
  { key: "type",                          label: "Type" },
  { key: "status",                        label: "Status" },
  { key: "incident_date",                 label: "Incident Date" },
  { key: "incident_city",                 label: "Incident City" },
  { key: "incident_country",              label: "Incident Country" },
  { key: "description",                   label: "Description" },
  { key: "created_at",                    label: "Created At" },
];
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, TextArea, SaveBar } from "./_components/FormField";
import { SearchableSelect } from "./_components/SearchableSelect";
import { fmtDate } from "./_components/fmtDate";

interface Claim {
  id: number;
  policy_id: number | null;
  type: string | null;
  status: string | null;
  incident_date: string | null;
  incident_city: string | null;
  incident_country: string | null;
  created_at: string;
  description: string | null;
  media?: string[] | null;
  brand_name?: string;
  brand_logo?: string | null;
  item_name?: string;
  item_picture?: string | null;
  customer_name?: string | null;
  customer_email?: string;
  customer_first?: string | null;
  customer_last?: string | null;
}

interface PolicyOption { id: number; brand_sale_id: string; brand_name: string; customer_email: string; }
interface BrandOption { id: number; name: string | null; }

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Claim> => ({
  policy_id: null, type: "", status: "open",
  incident_date: null, incident_city: "", incident_country: "", description: "",
});

const AdminClaims = () => {
  const { toast } = useToast();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editing, setEditing] = useState<Partial<Claim>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Claim | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    let query = supabase
      .from("claims")
      .select("id, policy_id, type, status, incident_date, incident_city, incident_country, created_at, description, media, policies(brands(name, logo_small), catalogues(name, picture), profiles(email, first_name, last_name))", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`type.ilike.%${search}%,incident_city.ilike.%${search}%,incident_country.ilike.%${search}%`);
    if (filterValues.status) query = query.eq("status", filterValues.status);
    if (filterValues.type) query = query.eq("type", filterValues.type);
    if (filterValues.brand_id) query = query.eq("policies.brand_id", Number(filterValues.brand_id));
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setClaims((data ?? []).map((c: any) => ({
        ...c,
        brand_name: c.policies?.brands?.name ?? "—",
        brand_logo: c.policies?.brands?.logo_small ?? null,
        item_name: c.policies?.catalogues?.name ?? "—",
        item_picture: c.policies?.catalogues?.picture ?? null,
        customer_email: c.policies?.profiles?.email ?? "—",
        customer_first: c.policies?.profiles?.first_name ?? null,
        customer_last: c.policies?.profiles?.last_name ?? null,
        customer_name: [c.policies?.profiles?.first_name, c.policies?.profiles?.last_name].filter(Boolean).join(" ") || null,
      })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir]);

  useEffect(() => {
    Promise.all([
      supabase.from("brands").select("id, name").order("name"),
      supabase.from("policies").select("id, brand_sale_id, brands(name), profiles(email)").order("brand_sale_id").limit(500),
    ]).then(([{ data: brandsData }, { data: policiesData }]) => {
      setBrands((brandsData as BrandOption[]) ?? []);
      setPolicies((policiesData ?? []).map((p: any) => ({
        id: p.id,
        brand_sale_id: p.brand_sale_id,
        brand_name: p.brands?.name ?? "—",
        customer_email: p.profiles?.email ?? "—",
      })));
    });
  }, []);

  const openAdd = () => { setEditing(empty()); setPendingFiles([]); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Claim>); setPendingFiles([]); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Claim>); setPendingFiles([]); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    // Upload any pending files to claims_media bucket
    let uploadedUrls: string[] = [];
    if (pendingFiles.length > 0) {
      const uploads = await Promise.all(
        pendingFiles.map(async (file) => {
          const ext = file.name.split(".").pop();
          const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage.from("claims_media").upload(path, file);
          if (upErr) return null;
          const { data: { publicUrl } } = supabase.storage.from("claims_media").getPublicUrl(path);
          return publicUrl;
        })
      );
      uploadedUrls = uploads.filter(Boolean) as string[];
    }

    const existingMedia: string[] = Array.isArray(editing.media) ? (editing.media as string[]) : [];
    const mergedMedia = [...existingMedia, ...uploadedUrls];

    const payload = {
      policy_id: editing.policy_id ?? null, type: editing.type ?? null,
      status: editing.status ?? null, incident_date: editing.incident_date ?? null,
      incident_city: editing.incident_city ?? null, incident_country: editing.incident_country ?? null,
      description: editing.description ?? null,
      media: mergedMedia.length > 0 ? mergedMedia : null,
    };
    const { error } = mode === "add"
      ? await supabase.from("claims").insert(payload)
      : await supabase.from("claims").update({ status: editing.status ?? null, media: mergedMedia.length > 0 ? mergedMedia : (editing.media ?? null) }).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Claim created" : "Claim updated" });
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("claims").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Claim deleted" });
    fetchData();
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    let q = supabase
      .from("claims")
      .select("id, policy_id, type, status, incident_date, incident_city, incident_country, created_at, description, policies(brands(name), catalogues(name, sku), profiles(email, first_name, last_name))")
      .order(sortKey, { ascending: sortDir === "asc" })
      .limit(10000);
    if (search) q = q.or(`type.ilike.%${search}%,incident_city.ilike.%${search}%,incident_country.ilike.%${search}%`);
    if (filterValues.status) q = q.eq("status", filterValues.status);
    if (filterValues.type) q = q.eq("type", filterValues.type);
    if (filterValues.brand_id) q = q.eq("policies.brand_id", Number(filterValues.brand_id));
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  };

  const set = (k: keyof Claim, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const ro = mode === "view";
  const drawerTitle = mode === "add" ? "New Claim" : mode === "edit" ? `Edit Claim #${editing.id}` : `Claim #${editing.id}`;

  return (
    <>
      <AdminTable
        title="Claims"
        data={claims as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onExport={handleExport} exportFilename="claims" exportSchema={CLAIMS_SCHEMA}
        onAdd={openAdd} addLabel="New Claim"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Claim)}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
          { key: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
          { key: "type", label: "Type", options: [{ value: "accidental_damage", label: "Accidental Damage" }, { value: "robbery", label: "Robbery" }, { value: "theft", label: "Theft" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        columns={[
          { key: "id", label: "#", width: 64, render: (row) => <span className="text-muted-foreground text-xs">#{(row as unknown as Claim).id}</span> },
          {
            key: "brand_name", label: "Brand", width: 164,
            render: (row) => {
              const r = row as unknown as Claim;
              return (
                <div className="flex items-center gap-2">
                  {r.brand_logo
                    ? <div className="h-6 w-6 rounded bg-white flex items-center justify-center shrink-0 border border-border/30"><img src={r.brand_logo} alt={r.brand_name} className="h-5 w-5 object-contain" /></div>
                    : <div className="h-6 w-6 rounded bg-secondary shrink-0" />}
                  <span className="text-sm text-foreground">{r.brand_name}</span>
                </div>
              );
            },
          },
          { key: "item_name", label: "Item", width: 200, render: (row) => { const r = row as any; return <div className="flex items-center gap-2.5">{r.item_picture ? <img src={r.item_picture} alt={r.item_name} className="h-9 w-9 rounded-lg object-contain bg-secondary/50 shrink-0" /> : <div className="h-9 w-9 rounded-lg bg-secondary/50 shrink-0" />}<span className="text-sm text-foreground">{r.item_name}</span></div>; } },
          { key: "customer_email", label: "Customer", width: 200, render: (row) => { const r = row as any; const initials = `${(r.customer_first?.[0] || r.customer_email?.[0] || "?").toUpperCase()}${(r.customer_last?.[0] || "").toUpperCase()}`; return <div className="flex items-center gap-2.5"><div className="h-9 w-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">{initials}</div><div><p className="text-sm text-foreground">{r.customer_name || r.customer_email}</p>{r.customer_name && <p className="text-xs text-muted-foreground">{r.customer_email}</p>}</div></div>; } },
          { key: "type", label: "Type", sortable: true, render: (row) => { const r = row as unknown as Claim; return r.type ? toTitleCase(r.type) : <span className="text-muted-foreground">—</span>; } },
          {
            key: "incident_date", label: "Incident Date", sortable: true,
            render: (row) => { const r = row as unknown as Claim; return fmtDate(r.incident_date); },
          },
          {
            key: "incident_city", label: "Location",
            render: (row) => { const r = row as unknown as Claim; return [r.incident_city, r.incident_country].filter(Boolean).join(", ") || "—"; },
          },
          {
            key: "created_at", label: "Opened", sortable: true,
            render: (row) => { const r = row as unknown as Claim; return fmtDate(r.created_at); },
          },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Claim; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        <form onSubmit={handleSave} className="space-y-4">
          {/* Cover (policy) */}
          <FormField label="Cover (Policy)" required={mode === "add"}>
            {ro ? (
              <div className="space-y-1">
                <Input disabled value={(editing as any).brand_name ?? ""} />
                <Input disabled value={(editing as any).customer_email ?? ""} />
              </div>
            ) : mode === "add" ? (
              <SearchableSelect
                value={editing.policy_id}
                onChange={(v) => set("policy_id", v ? Number(v) : null)}
                options={policies.map((p) => ({ value: p.id, label: `${p.brand_sale_id} — ${p.brand_name} — ${p.customer_email}` }))}
                placeholder="Select cover…"
                required
              />
            ) : (
              <Input disabled value={`${(editing as any).brand_name ?? ""} — ${(editing as any).customer_email ?? ""}`} />
            )}
          </FormField>

          {/* Type */}
          <FormField label="Type" required={mode === "add"}>
            {ro ? <Input disabled value={editing.type ?? ""} /> : (
              <Select value={editing.type ?? ""} onChange={(e) => set("type", e.target.value)} required={mode === "add"}>
                <option value="">Select type…</option>
                <option value="accidental_damage">Accidental Damage</option>
                <option value="robbery">Robbery</option>
                <option value="theft">Theft</option>
              </Select>
            )}
          </FormField>

          {/* Status */}
          <FormField label="Status">
            {ro ? <Input disabled value={editing.status ?? ""} /> : (
              <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </Select>
            )}
          </FormField>

          {/* Dates & Location */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Incident Date">
              <Input type="date" disabled={ro} max={new Date().toISOString().split("T")[0]} value={editing.incident_date ? editing.incident_date.slice(0, 10) : ""} onChange={(e) => set("incident_date", e.target.value || null)} />
            </FormField>
            {ro && (
              <FormField label="Opened">
                <Input disabled value={fmtDate(editing.created_at)} />
              </FormField>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Incident City"><Input disabled={ro} value={editing.incident_city ?? ""} onChange={(e) => set("incident_city", e.target.value)} /></FormField>
            <FormField label="Incident Country"><Input disabled={ro} value={editing.incident_country ?? ""} onChange={(e) => set("incident_country", e.target.value)} /></FormField>
          </div>

          {/* Description */}
          <FormField label="Description">
            <TextArea disabled={ro} value={editing.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={3} placeholder="Describe the incident…" />
          </FormField>

          {/* Attached Files */}
          {(ro || mode === "edit") && Array.isArray((editing as Claim).media) && ((editing as Claim).media?.length ?? 0) > 0 && (
            <FormField label={ro ? "Attached Files" : "Existing Files"}>
              <div className="flex flex-wrap gap-2 mt-1">
                {((editing as Claim).media as string[]).map((url, idx) => {
                  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() || "";
                  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
                  return (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-16 w-16 shrink-0 rounded-lg border border-border overflow-hidden bg-secondary/40 flex items-center justify-center hover:border-primary/40 transition-colors"
                    >
                      {isImage
                        ? <img src={url} alt="" className="h-full w-full object-cover" />
                        : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                    </a>
                  );
                })}
              </div>
            </FormField>
          )}

          {/* File Upload (add/edit only) */}
          {!ro && (
            <FormField label="Attach Files">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  if (selected.length) setPendingFiles((p) => [...p, ...selected]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-secondary/30 px-4 py-5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                <Upload className="h-4 w-4" />
                Click to upload files
              </button>
              {pendingFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingFiles.map((file, idx) => {
                    const isImage = file.type.startsWith("image/");
                    return (
                      <div key={idx} className="relative h-16 w-16 shrink-0 rounded-lg border border-border bg-secondary/40 overflow-hidden flex items-center justify-center">
                        {isImage
                          ? <img src={URL.createObjectURL(file)} alt={file.name} className="h-full w-full object-cover" />
                          : <FileText className="h-6 w-6 text-muted-foreground" />}
                        <button
                          type="button"
                          onClick={() => setPendingFiles((p) => p.filter((_, i) => i !== idx))}
                          className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-background/80 flex items-center justify-center hover:bg-destructive hover:text-white transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </FormField>
          )}

          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Claim" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Claim"
        description={`Delete claim #${deleteTarget?.id}? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminClaims;
