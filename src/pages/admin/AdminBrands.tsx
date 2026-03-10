import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge } from "./_components/AdminTable";
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, TextArea, SaveBar } from "./_components/FormField";
import { ImageUpload } from "./_components/ImageUpload";

interface Brand {
  id: number;
  name: string | null;
  slug: string | null;
  email: string | null;
  website: string | null;
  hq_country: string | null;
  status: string | null;
  logo_small: string | null;
  logo_big: string | null;
  auth_background_image: string | null;
  top_banner_image: string | null;
  theft_image: string | null;
  damage_image: string | null;
  faq_image: string | null;
  feedback_image: string | null;
  faq_en: any;
  faq_it: any;
  enable_chubb_reporting: boolean | null;
  chubb_policy_prefix: string | null;
  activation_fee: number | null;
  insurance_premium: number | null;
  aion_premium_fee: number | null;
}

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Brand> => ({
  name: "", slug: "", email: "", website: "", hq_country: "", status: "active",
  logo_small: "", logo_big: "",
  auth_background_image: null, top_banner_image: null,
  theft_image: null, damage_image: null, faq_image: null, feedback_image: null,
  faq_en: null, faq_it: null,
  enable_chubb_reporting: false, chubb_policy_prefix: "",
  activation_fee: null, insurance_premium: null, aion_premium_fee: null,
});

const toJsonStr = (v: any) => v ? JSON.stringify(v, null, 2) : "";
const fromJsonStr = (s: string): any => {
  if (!s.trim()) return null;
  try { return JSON.parse(s); } catch { return s; }
};

const AdminBrands = () => {
  const { toast } = useToast();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [editing, setEditing] = useState<Partial<Brand>>(empty());
  const [faqEnStr, setFaqEnStr] = useState("");
  const [faqItStr, setFaqItStr] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);
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
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,slug.ilike.%${search}%,hq_country.ilike.%${search}%`);
    if (filterValues.status) query = query.eq("status", filterValues.status);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setBrands((data as Brand[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir]);

  // Fetch all columns for a single brand — used when opening view/edit drawer
  const fetchFull = async (id: number): Promise<Partial<Brand> | null> => {
    const { data } = await supabase
      .from("brands")
      .select("id, name, slug, email, website, hq_country, status, logo_small, logo_big, auth_background_image, top_banner_image, theft_image, damage_image, faq_image, feedback_image, faq_en, faq_it, enable_chubb_reporting, chubb_policy_prefix, activation_fee, insurance_premium, aion_premium_fee")
      .eq("id", id)
      .single();
    return data as Partial<Brand> | null;
  };

  const openAdd = () => {
    const row = empty();
    setEditing(row);
    setFaqEnStr(toJsonStr(row.faq_en));
    setFaqItStr(toJsonStr(row.faq_it));
    setMode("add");
    setDrawerOpen(true);
  };

  const openView = async (row: Record<string, unknown>) => {
    const full = await fetchFull((row as any).id);
    const brand = full ?? (row as Partial<Brand>);
    setEditing(brand);
    setFaqEnStr(toJsonStr(brand.faq_en));
    setFaqItStr(toJsonStr(brand.faq_it));
    setMode("view");
    setDrawerOpen(true);
  };

  const openEdit = async (row: Record<string, unknown>) => {
    const full = await fetchFull((row as any).id);
    const brand = full ?? (row as Partial<Brand>);
    setEditing(brand);
    setFaqEnStr(toJsonStr(brand.faq_en));
    setFaqItStr(toJsonStr(brand.faq_it));
    setMode("edit");
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: editing.name ?? null, slug: editing.slug ?? null, email: editing.email ?? null,
      website: editing.website ?? null, hq_country: editing.hq_country ?? null, status: editing.status ?? null,
      logo_small: editing.logo_small ?? null, logo_big: editing.logo_big ?? null,
      auth_background_image: editing.auth_background_image ?? null,
      top_banner_image: editing.top_banner_image ?? null,
      theft_image: editing.theft_image ?? null,
      damage_image: editing.damage_image ?? null,
      faq_image: editing.faq_image ?? null,
      feedback_image: editing.feedback_image ?? null,
      faq_en: fromJsonStr(faqEnStr),
      faq_it: fromJsonStr(faqItStr),
      enable_chubb_reporting: editing.enable_chubb_reporting ?? false,
      chubb_policy_prefix: editing.chubb_policy_prefix ?? null,
      activation_fee: editing.activation_fee ?? null,
      insurance_premium: editing.insurance_premium ?? null,
      aion_premium_fee: editing.aion_premium_fee ?? null,
    };
    const { error } = mode === "add"
      ? await supabase.from("brands").insert(payload)
      : await supabase.from("brands").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Brand created" : "Brand updated" });
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("brands").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Brand deleted" });
    fetchData();
  };

  const set = (k: keyof Brand, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const ro = mode === "view";
  const brandId = editing.id ?? `new-${Date.now()}`;
  const drawerTitle = mode === "add" ? "New Brand" : mode === "edit" ? `Edit: ${editing.name ?? ""}` : `Brand: ${editing.name ?? ""}`;

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
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onAdd={openAdd} addLabel="New Brand"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Brand)}
        filters={[
          { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
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
                    <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center text-xs font-semibold shrink-0">{(r.name?.[0] ?? "?").toUpperCase()}</div>
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
          { key: "hq_country", label: "Country", sortable: true },
          { key: "website", label: "Website" },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Brand; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        <form onSubmit={handleSave} className="space-y-4">

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" required={!ro}><Input disabled={ro} value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} required={!ro} /></FormField>
            <FormField label="Slug" required={!ro} hint="Used in URLs"><Input disabled={ro} value={editing.slug ?? ""} onChange={(e) => set("slug", e.target.value)} required={!ro} /></FormField>
          </div>
          <FormField label="Email"><Input type="email" disabled={ro} value={editing.email ?? ""} onChange={(e) => set("email", e.target.value)} /></FormField>
          <FormField label="Website"><Input disabled={ro} value={editing.website ?? ""} onChange={(e) => set("website", e.target.value)} /></FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="HQ Country"><Input disabled={ro} value={editing.hq_country ?? ""} onChange={(e) => set("hq_country", e.target.value)} /></FormField>
            <FormField label="Status">
              {ro ? <Input disabled value={editing.status ?? ""} /> : (
                <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              )}
            </FormField>
          </div>

          {/* Logos */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Logos</p>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Logo (icon)" hint="Small square, used in navigation">
                {ro ? (
                  editing.logo_small ? <img src={editing.logo_small} alt="" className="h-14 rounded-lg border border-border object-contain" /> : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.logo_small} onChange={(url) => set("logo_small", url)} bucket="brand_logos" path={`brands/${brandId}-icon`} />
                )}
              </FormField>
              <FormField label="Logo (full)" hint="Full logo, used in portal header">
                {ro ? (
                  editing.logo_big ? <img src={editing.logo_big} alt="" className="h-14 rounded-lg border border-border object-contain" /> : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.logo_big} onChange={(url) => set("logo_big", url)} bucket="brand_logos" path={`brands/${brandId}-full`} />
                )}
              </FormField>
            </div>
          </div>

          {/* Portal images */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Portal Images</p>
            <div className="space-y-3">
              <FormField label="Auth Background" hint="Login / signup page background">
                {ro ? (
                  editing.auth_background_image ? <img src={editing.auth_background_image} alt="" className="h-20 w-full rounded-lg border border-border object-cover" /> : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.auth_background_image} onChange={(url) => set("auth_background_image", url)} bucket="brand_media" path={`brands/${brandId}-auth-bg`} />
                )}
              </FormField>
              <FormField label="Top Banner" hint="Customer portal top banner">
                {ro ? (
                  editing.top_banner_image ? <img src={editing.top_banner_image} alt="" className="h-20 w-full rounded-lg border border-border object-cover" /> : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.top_banner_image} onChange={(url) => set("top_banner_image", url)} bucket="brand_media" path={`brands/${brandId}-top-banner`} />
                )}
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Theft Image" hint="Used on new claim (Theft)">
                  {ro ? (
                    editing.theft_image ? <img src={editing.theft_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.theft_image} onChange={(url) => set("theft_image", url)} bucket="brand_media" path={`brands/${brandId}-theft`} />
                  )}
                </FormField>
                <FormField label="Damage Image" hint="Used on new claim (Accidental Damage)">
                  {ro ? (
                    editing.damage_image ? <img src={editing.damage_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.damage_image} onChange={(url) => set("damage_image", url)} bucket="brand_media" path={`brands/${brandId}-damage`} />
                  )}
                </FormField>
                <FormField label="FAQ Image">
                  {ro ? (
                    editing.faq_image ? <img src={editing.faq_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.faq_image} onChange={(url) => set("faq_image", url)} bucket="brand_media" path={`brands/${brandId}-faq`} />
                  )}
                </FormField>
                <FormField label="Feedback Image">
                  {ro ? (
                    editing.feedback_image ? <img src={editing.feedback_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.feedback_image} onChange={(url) => set("feedback_image", url)} bucket="brand_media" path={`brands/${brandId}-feedback`} />
                  )}
                </FormField>
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">FAQ Content (JSON)</p>
            <div className="space-y-3">
              <FormField label="FAQ (English)" hint="JSON array of { question, answer } objects">
                <TextArea disabled={ro} rows={5} value={faqEnStr} onChange={(e) => setFaqEnStr(e.target.value)} placeholder='[{"question":"...","answer":"..."}]' className="font-mono text-xs" />
              </FormField>
              <FormField label="FAQ (Italian)" hint="JSON array of { question, answer } objects">
                <TextArea disabled={ro} rows={5} value={faqItStr} onChange={(e) => setFaqItStr(e.target.value)} placeholder='[{"question":"...","answer":"..."}]' className="font-mono text-xs" />
              </FormField>
            </div>
          </div>

          {/* Fee Rates */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fee Rates</p>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Activation Fee" hint="e.g. 0.05 = 5%">
                <Input type="number" step="0.0001" disabled={ro} value={editing.activation_fee ?? ""} onChange={(e) => set("activation_fee", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
              <FormField label="Insurance Premium" hint="e.g. 0.12 = 12%">
                <Input type="number" step="0.0001" disabled={ro} value={editing.insurance_premium ?? ""} onChange={(e) => set("insurance_premium", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
              <FormField label="AION Premium Fee" hint="On net premium">
                <Input type="number" step="0.0001" disabled={ro} value={editing.aion_premium_fee ?? ""} onChange={(e) => set("aion_premium_fee", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
            </div>
          </div>

          {/* Chubb */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Chubb Reporting</p>
            <div className="grid grid-cols-2 gap-4 items-end">
              <FormField label="Policy Prefix">
                <Input disabled={ro} value={editing.chubb_policy_prefix ?? ""} onChange={(e) => set("chubb_policy_prefix", e.target.value)} placeholder="e.g. CHB-" />
              </FormField>
              <div className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  id="chubb_reporting"
                  disabled={ro}
                  checked={editing.enable_chubb_reporting ?? false}
                  onChange={(e) => set("enable_chubb_reporting", e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                />
                <label htmlFor="chubb_reporting" className="text-sm font-medium text-foreground">Enable Chubb Reporting</label>
              </div>
            </div>
          </div>

          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">Close</button>
              <button type="button" onClick={() => openDrawer(editing, "edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Brand" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

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
