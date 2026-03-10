import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge } from "./_components/AdminTable";
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, SaveBar } from "./_components/FormField";
import { SearchableSelect } from "./_components/SearchableSelect";

interface Shop {
  id: number;
  name: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact: string | null;
  status: string | null;
  brand_id: number | null;
  brand_name?: string;
  brand_logo?: string | null;
}

interface BrandOption { id: number; name: string | null; }

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Shop> => ({
  name: "", address: "", city: "", country: "", contact: "", status: "active", brand_id: null,
});

const AdminShops = () => {
  const { toast } = useToast();
  const [shops, setShops] = useState<Shop[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [editing, setEditing] = useState<Partial<Shop>>(empty());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Shop | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    let query = supabase
      .from("shops")
      .select("id, name, address, city, country, contact, status, brand_id, brands(name, logo_small)", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%,contact.ilike.%${search}%`);
    if (filterValues.brand_id) query = query.eq("brand_id", Number(filterValues.brand_id));
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setShops((data ?? []).map((s: any) => ({ ...s, brand_name: s.brands?.name ?? "—", brand_logo: s.brands?.logo_small ?? null })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, sortKey, sortDir, filterValues]);

  useEffect(() => {
    supabase.from("brands").select("id, name").order("name").then(({ data }) => setBrands((data as BrandOption[]) ?? []));
  }, []);

  const openAdd = () => { setEditing(empty()); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Shop>); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Shop>); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: editing.name ?? null, address: editing.address ?? null, city: editing.city ?? null,
      country: editing.country ?? null, contact: editing.contact ?? null,
      status: editing.status ?? null, brand_id: editing.brand_id ?? null,
    };
    const { error } = mode === "add"
      ? await supabase.from("shops").insert(payload)
      : await supabase.from("shops").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Shop created" : "Shop updated" });
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("shops").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Shop deleted" });
    fetchData();
  };

  const set = (k: keyof Shop, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const ro = mode === "view";
  const drawerTitle = mode === "add" ? "New Shop" : mode === "edit" ? `Edit: ${editing.name ?? ""}` : `Shop: ${editing.name ?? ""}`;

  return (
    <>
      <AdminTable
        title="Shops"
        data={shops as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onAdd={openAdd} addLabel="New Shop"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Shop)}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        columns={[
          {
            key: "name", label: "Shop", sortable: true, width: 200,
            render: (row) => {
              const r = row as unknown as Shop;
              return <div><p className="font-medium text-foreground">{r.name ?? "—"}</p><p className="text-xs text-muted-foreground">{r.address ?? ""}</p></div>;
            },
          },
          {
            key: "brand_name", label: "Brand",
            render: (row) => {
              const r = row as unknown as Shop;
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
          {
            key: "city", label: "Location", sortable: true,
            render: (row) => { const r = row as unknown as Shop; return [r.city, r.country].filter(Boolean).join(", ") || "—"; },
          },
          { key: "contact", label: "Contact" },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Shop; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        <form onSubmit={handleSave} className="space-y-4">
          <FormField label="Name" required={!ro}>
            <Input disabled={ro} value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} required={!ro} />
          </FormField>
          <FormField label="Brand" required={!ro}>
            {ro ? <Input disabled value={(editing as any).brand_name ?? ""} /> : (
              <SearchableSelect
                value={editing.brand_id}
                onChange={(v) => set("brand_id", v ? Number(v) : null)}
                options={brands.map((b) => ({ value: b.id, label: b.name ?? "" }))}
                placeholder="Select brand…"
                required={!ro}
              />
            )}
          </FormField>
          <FormField label="Address">
            <Input disabled={ro} value={editing.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="City"><Input disabled={ro} value={editing.city ?? ""} onChange={(e) => set("city", e.target.value)} /></FormField>
            <FormField label="Country"><Input disabled={ro} value={editing.country ?? ""} onChange={(e) => set("country", e.target.value)} /></FormField>
          </div>
          <FormField label="Contact" hint="Email or phone">
            <Input disabled={ro} value={editing.contact ?? ""} onChange={(e) => set("contact", e.target.value)} placeholder="Email or phone" />
          </FormField>
          <FormField label="Status">
            {ro ? <Input disabled value={editing.status ?? ""} /> : (
              <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            )}
          </FormField>
          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Shop" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Shop"
        description={`Delete shop "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminShops;
