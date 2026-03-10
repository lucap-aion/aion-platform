import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge } from "./_components/AdminTable";
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, SaveBar } from "./_components/FormField";
import { SearchableSelect } from "./_components/SearchableSelect";
import { fmtDate } from "./_components/fmtDate";

interface Cover {
  id: number;
  brand_sale_id: string;
  status: string | null;
  start_date: string;
  expiration_date: string | null;
  selling_price: number | null;
  cogs: number | null;
  recommended_retail_price: number | null;
  quantity: number | null;
  brand_id: number | null;
  customer_id: string | null;
  item_id: number | null;
  brand_name?: string;
  brand_logo?: string | null;
  item_name?: string;
  customer_email?: string;
}

interface BrandOption { id: number; name: string | null; }
interface CustomerOption { id: string; email: string; first_name: string | null; last_name: string | null; brand_id: number | null; }
interface CatalogueOption { id: number; name: string | null; brand_id: number | null; category: string | null; }
interface ManufacturingCost { category: string | null; cost_pct: number | null; brand_id: number | null; }

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const addTwoYears = (dateStr: string): string => {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().slice(0, 10);
};

const empty = (): Partial<Cover> => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    brand_sale_id: "", status: "live", start_date: today,
    expiration_date: addTwoYears(today),
    selling_price: null, cogs: null, recommended_retail_price: null,
    quantity: null, brand_id: null, customer_id: null, item_id: null,
  };
};

const AdminCovers = () => {
  const { toast } = useToast();
  const [covers, setCovers] = useState<Cover[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [catalogues, setCatalogues] = useState<CatalogueOption[]>([]);
  const [manufacturingCosts, setManufacturingCosts] = useState<ManufacturingCost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editing, setEditing] = useState<Partial<Cover>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Cover | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    let query = supabase
      .from("policies")
      .select("id, brand_sale_id, status, start_date, expiration_date, selling_price, cogs, recommended_retail_price, quantity, brand_id, customer_id, item_id, created_at, brands(name, logo_small), catalogues(name, sku, picture), profiles(email, first_name, last_name, avatar)", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`brand_sale_id.ilike.%${search}%`);
    if (filterValues.brand_id) query = query.eq("brand_id", Number(filterValues.brand_id));
    if (filterValues.status) query = query.eq("status", filterValues.status);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setCovers((data ?? []).map((p: any) => ({
        ...p,
        brand_name: p.brands?.name ?? "—",
        brand_logo: p.brands?.logo_small ?? null,
        item_name: p.catalogues?.name ?? "—",
        item_sku: p.catalogues?.sku ?? null,
        item_picture: p.catalogues?.picture ?? null,
        customer_email: p.profiles?.email ?? "—",
        customer_first: p.profiles?.first_name ?? null,
        customer_last: p.profiles?.last_name ?? null,
        customer_avatar: p.profiles?.avatar ?? null,
        customer_name: [p.profiles?.first_name, p.profiles?.last_name].filter(Boolean).join(" ") || null,
      })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir]);

  useEffect(() => {
    Promise.all([
      supabase.from("brands").select("id, name").order("name"),
      supabase.from("profiles").select("id, email, first_name, last_name, brand_id").eq("role", "customer").order("email").limit(500),
      supabase.from("catalogues").select("id, name, brand_id, category").order("name"),
      supabase.from("manufacturing_costs").select("category, cost_pct, brand_id"),
    ]).then(([{ data: b }, { data: c }, { data: cat }, { data: mc }]) => {
      setBrands((b as BrandOption[]) ?? []);
      setCustomers((c as CustomerOption[]) ?? []);
      setCatalogues((cat as CatalogueOption[]) ?? []);
      setManufacturingCosts((mc as ManufacturingCost[]) ?? []);
    });
  }, []);

  const openAdd = () => { setEditing(empty()); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Cover>); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Cover>); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      brand_sale_id: editing.brand_sale_id ?? "",
      status: editing.status ?? null,
      start_date: editing.start_date ?? null,
      expiration_date: editing.expiration_date ?? null,
      selling_price: editing.selling_price ?? null,
      cogs: editing.cogs ?? null,
      recommended_retail_price: editing.recommended_retail_price ?? null,
      quantity: editing.quantity ?? null,
      brand_id: editing.brand_id ?? null,
      customer_id: editing.customer_id ?? null,
      item_id: editing.item_id ?? null,
    };
    const { error } = mode === "add"
      ? await supabase.from("policies").insert(payload)
      : await supabase.from("policies").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Cover created" : "Cover updated" });
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("policies").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cover deleted" });
    fetchData();
  };

  const set = (k: keyof Cover, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));

  const handleStartDateChange = (val: string) => {
    set("start_date", val || null);
    if (val) set("expiration_date", addTwoYears(val));
  };

  useEffect(() => {
    if (mode === "view") return;
    const cat = catalogues.find((c) => c.id === editing.item_id);
    const costEntry = cat?.category
      ? manufacturingCosts.find(
          (m) => m.category === cat.category &&
          (m.brand_id === editing.brand_id || m.brand_id === null)
        )
      : undefined;
    if (costEntry?.cost_pct != null && editing.recommended_retail_price != null) {
      const cogs = Math.round(editing.recommended_retail_price * costEntry.cost_pct * 100) / 100;
      set("cogs", cogs);
    } else {
      set("cogs", null);
    }
  }, [editing.item_id, editing.recommended_retail_price, editing.brand_id, catalogues, manufacturingCosts, mode]);

  const ro = mode === "view";

  // Cascading filters
  const filteredCatalogues = editing.brand_id
    ? catalogues.filter((c) => c.brand_id === Number(editing.brand_id))
    : catalogues;
  const filteredCustomers = editing.brand_id
    ? customers.filter((c) => c.brand_id === Number(editing.brand_id))
    : customers;

  const drawerTitle = mode === "add" ? "New Cover" : mode === "edit" ? "Edit Cover" : "View Cover";

  return (
    <>
      <AdminTable
        title="Covers"
        data={covers as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onAdd={openAdd} addLabel="New Cover"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Cover)}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
          { key: "status", label: "Status", options: [{ value: "live", label: "Live" }, { value: "pending", label: "Pending" }, { value: "blocked", label: "Blocked" }, { value: "cancelled", label: "Cancelled" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        columns={[
          { key: "id", label: "ID", sortable: true, width: 64, render: (row) => <span className="text-muted-foreground text-xs">#{(row as unknown as Cover).id}</span> },
          { key: "brand_sale_id", label: "Sale ID", sortable: true },
          {
            key: "brand_name", label: "Brand", width: 164,
            render: (row) => {
              const r = row as unknown as Cover;
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
            key: "item_name", label: "Item", width: 210,
            render: (row) => {
              const r = row as any;
              return (
                <div className="flex items-center gap-3">
                  {r.item_picture ? (
                    <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-1">
                      <img src={r.item_picture} alt={r.item_name} className="h-full w-full object-contain mix-blend-multiply" />
                    </div>
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-secondary" />
                  )}
                  <div>
                    <p className="text-sm text-foreground">{r.item_name}</p>
                    {r.item_sku && <p className="text-xs text-muted-foreground">{r.item_sku}</p>}
                  </div>
                </div>
              );
            },
          },
          { key: "customer_email", label: "Customer", width: 210, render: (row) => { const r = row as any; const initials = `${(r.customer_first?.[0] || r.customer_email?.[0] || "?").toUpperCase()}${(r.customer_last?.[0] || "").toUpperCase()}`; return <div className="flex items-center gap-2.5"><div className="h-9 w-9 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">{r.customer_avatar ? <img src={r.customer_avatar} alt="" className="h-full w-full object-cover" /> : initials}</div><div><p className="text-sm text-foreground">{r.customer_name || r.customer_email}</p>{r.customer_name && <p className="text-xs text-muted-foreground">{r.customer_email}</p>}</div></div>; } },
          {
            key: "recommended_retail_price", label: "RRP", sortable: true,
            render: (row) => { const r = row as unknown as Cover; return r.recommended_retail_price != null ? `€${r.recommended_retail_price.toLocaleString("en-EU", { minimumFractionDigits: 2 })}` : "—"; },
          },
          {
            key: "selling_price", label: "Selling Price", sortable: true,
            render: (row) => { const r = row as unknown as Cover; return r.selling_price != null ? `€${r.selling_price.toLocaleString("en-EU", { minimumFractionDigits: 2 })}` : "—"; },
          },
          {
            key: "cogs", label: "COGS", sortable: true,
            render: (row) => { const r = row as unknown as Cover; return r.cogs != null ? `€${r.cogs.toLocaleString("en-EU", { minimumFractionDigits: 2 })}` : "—"; },
          },
          {
            key: "start_date", label: "Start", sortable: true,
            render: (row) => { const r = row as unknown as Cover; return fmtDate(r.start_date); },
          },
          {
            key: "expiration_date", label: "Expires", sortable: true,
            render: (row) => { const r = row as unknown as Cover; return fmtDate(r.expiration_date); },
          },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Cover; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        <form onSubmit={handleSave} className="space-y-4">
          {/* Sale ID + Status */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Sale ID" required={!ro}>
              <Input disabled={ro} value={editing.brand_sale_id ?? ""} onChange={(e) => set("brand_sale_id", e.target.value)} required={!ro} />
            </FormField>
            <FormField label="Status">
              {ro ? <Input disabled value={editing.status ?? ""} /> : (
                <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                  <option value="live">Live</option>
                  <option value="pending">Pending</option>
                  <option value="blocked">Blocked</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              )}
            </FormField>
          </div>

          {/* Brand */}
          <FormField label="Brand" required={!ro}>
            {ro ? <Input disabled value={(editing as any).brand_name ?? ""} /> : (
              <SearchableSelect
                value={editing.brand_id}
                onChange={(v) => { set("brand_id", v ? Number(v) : null); set("item_id", null); set("customer_id", null); }}
                options={brands.map((b) => ({ value: b.id, label: b.name ?? "" }))}
                placeholder="Select brand…"
                required={!ro}
              />
            )}
          </FormField>

          {/* Customer (filtered by brand) */}
          <FormField label="Customer" required={!ro}>
            {ro ? <Input disabled value={(editing as any).customer_email ?? ""} /> : (
              <SearchableSelect
                value={editing.customer_id}
                onChange={(v) => set("customer_id", v || null)}
                options={filteredCustomers.map((c) => ({
                  value: c.id,
                  label: `${[c.first_name, c.last_name].filter(Boolean).join(" ")}${c.email ? ` — ${c.email}` : ""}`.trim(),
                }))}
                placeholder={editing.brand_id ? "Select customer…" : "Select brand first…"}
                required={!ro}
              />
            )}
          </FormField>

          {/* Item (filtered by brand) */}
          <FormField label="Item (Catalogue)" required={!ro}>
            {ro ? <Input disabled value={(editing as any).item_name ?? ""} /> : (
              <SearchableSelect
                value={editing.item_id}
                onChange={(v) => set("item_id", v ? Number(v) : null)}
                options={filteredCatalogues.map((c) => ({ value: c.id, label: c.name ?? "" }))}
                placeholder={editing.brand_id ? "Select item…" : "Select brand first…"}
                required={!ro}
              />
            )}
          </FormField>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Start Date" required={!ro}>
              <Input
                type="date"
                disabled={ro}
                value={editing.start_date ? editing.start_date.slice(0, 10) : ""}
                onChange={(e) => handleStartDateChange(e.target.value)}
                required={!ro}
              />
            </FormField>
            <FormField label="Expiry Date">
              <Input
                type="date"
                disabled={ro}
                value={editing.expiration_date ? editing.expiration_date.slice(0, 10) : ""}
                onChange={(e) => set("expiration_date", e.target.value || null)}
              />
            </FormField>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Selling Price">
              <Input type="number" step="0.01" disabled={ro} value={editing.selling_price ?? ""} onChange={(e) => set("selling_price", e.target.value ? Number(e.target.value) : null)} />
            </FormField>
            <FormField label="COGS (auto)">
              <Input type="number" step="0.01" disabled value={editing.cogs ?? ""} readOnly />
            </FormField>
            <FormField label="RRP">
              <Input type="number" step="0.01" disabled={ro} value={editing.recommended_retail_price ?? ""} onChange={(e) => set("recommended_retail_price", e.target.value ? Number(e.target.value) : null)} />
            </FormField>
          </div>

          {/* Quantity */}
          <FormField label="Quantity">
            <Input type="number" disabled={ro} value={editing.quantity ?? ""} onChange={(e) => set("quantity", e.target.value ? Number(e.target.value) : null)} />
          </FormField>

          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Cover" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Cover"
        description={`Delete cover "${deleteTarget?.brand_sale_id}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminCovers;
