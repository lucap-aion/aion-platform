import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable from "./_components/AdminTable";
import type { ExportColumn } from "./_utils/exportCsv";
import { resolveSortOrder } from "./_utils/resolveSortOrder";

const SORT_RELATIONS = ["brands"] as const;

const CATALOGUES_SCHEMA: ExportColumn[] = [
  { key: "id",            label: "ID" },
  { key: "name",          label: "Item Name" },
  { key: "brands_name",   label: "Brand" },
  { key: "brand_item_id", label: "Brand Item ID" },
  { key: "sku",           label: "SKU" },
  { key: "slug",          label: "Slug" },
  { key: "category",      label: "Category" },
  { key: "collection",    label: "Collection" },
  { key: "composition",   label: "Composition" },
  { key: "description",   label: "Description" },
  { key: "brand_id",      label: "Brand ID" },
];
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, TextArea, SaveBar } from "./_components/FormField";
import { SearchableSelect } from "./_components/SearchableSelect";
import { ImageUpload } from "./_components/ImageUpload";

interface Catalogue {
  id: number;
  name: string | null;
  brand_id: number | null;
  brand_item_id: string | null;
  sku: string | null;
  slug: string | null;
  category: string | null;
  collection: string | null;
  composition: string | null;
  description: string | null;
  picture: string | null;
  brand_name?: string;
  brand_logo?: string | null;
}

interface BrandOption { id: number; name: string | null; }
interface CategoryOption { brand_id: number | null; category: string | null; }

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Catalogue> => ({
  name: "", brand_id: null, brand_item_id: "", sku: "", slug: "",
  category: "", collection: "", composition: "", description: "", picture: "",
});

const AdminCatalogues = () => {
  const { toast } = useToast();
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editing, setEditing] = useState<Partial<Catalogue>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Catalogue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [brandCategories, setBrandCategories] = useState<CategoryOption[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    if (brands.length === 0) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    const brandFilterIds = filterValues.brand_id ? [Number(filterValues.brand_id)] : brands.map((b) => b.id);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let query = supabase
      .from("catalogues")
      .select("id, name, brand_id, brand_item_id, sku, slug, category, collection, composition, description, picture, brands(name, logo_small)", { count: "exact" })
      .in("brand_id", brandFilterIds)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,slug.ilike.%${search}%,category.ilike.%${search}%,collection.ilike.%${search}%,composition.ilike.%${search}%,description.ilike.%${search}%,brand_item_id.ilike.%${search}%`);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setCatalogues((data ?? []).map((c: any) => ({ ...c, brand_name: c.brands?.name ?? "—", brand_logo: c.brands?.logo_small ?? null })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir, brands]);

  useEffect(() => {
    Promise.all([
      supabase.from("brands").select("id, name").eq("status", "verified").order("name"),
      supabase.from("manufacturing_costs").select("brand_id, category"),
    ]).then(([{ data: brandsData }, { data: costsData }]) => {
      setBrands((brandsData as BrandOption[]) ?? []);
      setBrandCategories((costsData as CategoryOption[]) ?? []);
    });
  }, []);

  const openAdd = () => { setEditing(empty()); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Catalogue>); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Catalogue>); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: editing.name ?? null, brand_id: editing.brand_id ?? null,
      brand_item_id: editing.brand_item_id ?? null, sku: editing.sku ?? null,
      slug: editing.slug ?? null, category: editing.category ?? null,
      collection: editing.collection ?? null, composition: editing.composition ?? null,
      description: editing.description ?? null, picture: editing.picture ?? null,
    };
    const { error } = mode === "add"
      ? await supabase.from("catalogues").insert(payload)
      : await supabase.from("catalogues").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Item created" : "Item updated" });
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("catalogues").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Item deleted" });
    fetchData();
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    const brandFilterIds = filterValues.brand_id ? [Number(filterValues.brand_id)] : brands.map((b) => b.id);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let q = supabase
      .from("catalogues")
      .select("id, name, brand_id, brand_item_id, sku, slug, category, collection, composition, description, brands(name)")
      .in("brand_id", brandFilterIds)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .limit(10000);
    if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%,slug.ilike.%${search}%,category.ilike.%${search}%,collection.ilike.%${search}%,composition.ilike.%${search}%,description.ilike.%${search}%,brand_item_id.ilike.%${search}%`);
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  };

  const set = (k: keyof Catalogue, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const ro = mode === "view";
  const drawerTitle = mode === "add" ? "New Catalogue Item" : mode === "edit" ? `Edit: ${editing.name ?? ""}` : `${editing.name ?? ""}`;

  // Categories available for the selected brand (from manufacturing_costs)
  const categoryOptions = editing.brand_id
    ? [...new Set(brandCategories.filter((m) => m.brand_id === editing.brand_id && m.category).map((m) => m.category!))]
    : [];

  return (
    <>
      <AdminTable
        title="Catalogues"
        data={catalogues as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onExport={handleExport} exportFilename="catalogues" exportSchema={CATALOGUES_SCHEMA}
        onAdd={openAdd} addLabel="New Item"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Catalogue)}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        columns={[
          {
            key: "name", label: "Item", sortable: true, width: 220,
            render: (row) => {
              const r = row as unknown as Catalogue;
              return (
                <div className="flex items-center gap-3">
                  {r.picture ? (
                    <img src={r.picture} alt={r.name ?? ""} className="h-9 w-9 rounded-lg object-cover shrink-0 border border-border" />
                  ) : (
                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-xs font-semibold shrink-0">{(r.name?.[0] ?? "?").toUpperCase()}</div>
                  )}
                  <div>
                    <p className="font-medium text-foreground">{r.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{r.sku ?? "—"}</p>
                  </div>
                </div>
              );
            },
          },
          {
            key: "brand_name", sortKey: "brands_name", label: "Brand",
            render: (row) => {
              const r = row as unknown as Catalogue;
              return (
                <div className="flex items-center gap-2">
                  {r.brand_logo
                    ? <div className="h-6 w-6 rounded bg-white flex items-center justify-center shrink-0 border border-border/30"><img src={r.brand_logo} alt={r.brand_name} className="h-5 w-5 object-contain" /></div>
                    : <div className="h-6 w-6 rounded bg-muted shrink-0" />}
                  <span className="text-sm text-foreground">{r.brand_name}</span>
                </div>
              );
            },
          },
          { key: "category", label: "Category", sortable: true },
          { key: "collection", label: "Collection", sortable: true },
          { key: "brand_item_id", label: "Brand Item ID" },
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
          <div className="grid grid-cols-2 gap-4">
            <FormField label="SKU" required={!ro}><Input disabled={ro} value={editing.sku ?? ""} onChange={(e) => set("sku", e.target.value)} required={!ro} /></FormField>
            <FormField label="Slug"><Input disabled={ro} value={editing.slug ?? ""} onChange={(e) => set("slug", e.target.value)} /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Category">
              {ro ? <Input disabled value={editing.category ?? ""} /> : categoryOptions.length > 0 ? (
                <Select value={editing.category ?? ""} onChange={(e) => set("category", e.target.value)}>
                  <option value="">Select category…</option>
                  {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              ) : (
                <Input disabled={ro} value={editing.category ?? ""} onChange={(e) => set("category", e.target.value)} placeholder={editing.brand_id ? "No categories configured" : "Select a brand first"} />
              )}
            </FormField>
            <FormField label="Collection"><Input disabled={ro} value={editing.collection ?? ""} onChange={(e) => set("collection", e.target.value)} /></FormField>
          </div>
          <FormField label="Brand Item ID"><Input disabled={ro} value={editing.brand_item_id ?? ""} onChange={(e) => set("brand_item_id", e.target.value)} /></FormField>
          <FormField label="Composition"><Input disabled={ro} value={editing.composition ?? ""} onChange={(e) => set("composition", e.target.value)} /></FormField>
          <FormField label="Description">
            <TextArea disabled={ro} value={editing.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={3} />
          </FormField>
          <FormField label="Picture">
            {ro ? (
              editing.picture
                ? <img src={editing.picture} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
                : <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <ImageUpload
                value={editing.picture}
                onChange={(url) => set("picture", url)}
                bucket="products_media"
                path={`catalogue/${editing.id ?? editing.sku ?? `new-${Date.now()}`}`}
              />
            )}
          </FormField>
          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Item" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Item"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminCatalogues;
