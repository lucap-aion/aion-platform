import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge, toTitleCase } from "./_components/AdminTable";
import { Mail } from "lucide-react";
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, SaveBar } from "./_components/FormField";
import { SearchableSelect } from "./_components/SearchableSelect";
import { sendEmail } from "@/utils/sendEmail";
import { siteUrl } from "@/utils/siteUrl";
import { fmtDate } from "./_components/fmtDate";

interface Assistant {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string | null;
  is_master: boolean;
  status: string | null;
  brand_id: number | null;
  shop_id: number | null;
  brand_name?: string;
  brand_logo?: string | null;
  shop_name?: string;
  avatar?: string | null;
  created_at: string | null;
  registered_at: string | null;
  email_confirmed_at: string | null;
}

interface BrandOption { id: number; name: string | null; }
interface ShopOption { id: number; name: string | null; brand_id: number | null; }

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Assistant> => ({
  first_name: "", last_name: "", email: "", role: "brand",
  is_master: false, status: "pending", brand_id: null, shop_id: null,
});

const AdminShopAssistants = () => {
  const { toast } = useToast();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("email");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editing, setEditing] = useState<Partial<Assistant>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Assistant | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    let query = supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role, is_master, status, brand_id, shop_id, avatar, created_at, registered_at, email_confirmed_at, brands(name, logo_small), shops(name)", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .eq("role", "brand")
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    if (filterValues.brand_id) query = query.eq("brand_id", Number(filterValues.brand_id));
    if (filterValues.status) query = query.eq("status", filterValues.status);
    if (filterValues.is_master !== undefined && filterValues.is_master !== "") query = query.eq("is_master", filterValues.is_master === "true");
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setAssistants((data ?? []).map((p: any) => ({
        ...p,
        brand_name: p.brands?.name ?? "—",
        brand_logo: p.brands?.logo_small ?? null,
        shop_name: p.shops?.name ?? "—",
        avatar: p.avatar ?? null,
      })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, sortKey, sortDir, filterValues]);

  useEffect(() => {
    Promise.all([
      supabase.from("brands").select("id, name").order("name"),
      supabase.from("shops").select("id, name, brand_id").order("name"),
    ]).then(([{ data: b }, { data: s }]) => {
      setBrands((b as BrandOption[]) ?? []);
      setShops((s as ShopOption[]) ?? []);
    });
  }, []);

  const openAdd = () => { setEditing(empty()); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Assistant>); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Assistant>); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (mode === "add") {
      const { error } = await supabase.from("profiles").insert({
        first_name: editing.first_name ?? null, last_name: editing.last_name ?? null,
        email: editing.email!, role: "brand",
        is_master: editing.is_master ?? false,
        status: "pending", brand_id: editing.brand_id ?? null,
        shop_id: editing.shop_id ?? null,
      });
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Assistant created" });
      if (editing.brand_id) {
        const { data: brandData } = await supabase.from("brands").select("name, slug").eq("id", editing.brand_id).single();
        if (brandData) {
          const emailError = await sendEmail("brand_user_invite", {
            brandUser: { email: editing.email, first_name: editing.first_name ?? null, brand_name: brandData.name },
            url: `${siteUrl()}/${brandData.slug}/signup`,
          });
          if (emailError) toast({ title: "Invite email failed", description: emailError, variant: "destructive" });
          else toast({ title: "Invite email sent", description: editing.email });
        }
      }
    } else {
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: editing.first_name ?? null, last_name: editing.last_name ?? null,
          is_master: editing.is_master ?? false,
          status: editing.status ?? null,
          brand_id: editing.brand_id ?? null, shop_id: editing.shop_id ?? null,
        })
        .eq("id", editing.id!);
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Assistant updated" });
    }
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("profiles").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Assistant deleted" });
    fetchData();
  };

  const handleResendInvite = async (row: Record<string, unknown>) => {
    const r = row as unknown as Assistant;
    if (!r.brand_id) { toast({ title: "No brand assigned", variant: "destructive" }); return; }
    const { data: brandData } = await supabase.from("brands").select("name, slug").eq("id", r.brand_id).single();
    if (!brandData) { toast({ title: "Brand not found", variant: "destructive" }); return; }
    const emailError = await sendEmail("brand_user_invite", {
      brandUser: { email: r.email, first_name: r.first_name ?? null, brand_name: brandData.name },
      url: `${siteUrl()}/${brandData.slug}/signup`,
    });
    if (emailError) toast({ title: "Invite email failed", description: emailError, variant: "destructive" });
    else toast({ title: "Invite email sent", description: r.email });
  };

  const set = (k: keyof Assistant, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const filteredShops = editing.brand_id ? shops.filter((s) => s.brand_id === Number(editing.brand_id)) : shops;
  const ro = mode === "view";
  const displayName = [editing.first_name, editing.last_name].filter(Boolean).join(" ") || editing.email || "";
  const drawerTitle = mode === "add" ? "New Shop Assistant" : mode === "edit" ? `Edit: ${displayName}` : displayName;

  return (
    <>
      <AdminTable
        title="Shop Assistants"
        data={assistants as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onAdd={openAdd} addLabel="New Assistant"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Assistant)}
        action={undefined}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
          { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "pending", label: "Pending" }] },
          { key: "is_master", label: "Access", options: [{ value: "true", label: "Master" }, { value: "false", label: "Read Only" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        extraRowAction={(row) => (
          <button
            onClick={() => handleResendInvite(row)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Resend invite email"
          >
            <Mail className="h-3.5 w-3.5" />
          </button>
        )}
        columns={[
          {
            key: "first_name", label: "Name", sortable: true, width: 220,
            render: (row) => {
              const r = row as unknown as Assistant;
              const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
              const initials = `${(r.first_name?.[0] || r.email?.[0] || "?").toUpperCase()}${(r.last_name?.[0] || "").toUpperCase()}`;
              return (
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {r.avatar ? <img src={r.avatar} alt={name} className="h-full w-full object-cover" /> : initials}
                  </div>
                  <div><p className="font-medium text-foreground">{name}</p><p className="text-xs text-muted-foreground">{r.email}</p></div>
                </div>
              );
            },
          },
          {
            key: "brand_name", label: "Brand",
            render: (row) => {
              const r = row as unknown as Assistant;
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
          { key: "shop_name", label: "Shop" },
          {
            key: "is_master", label: "Access", sortable: true,
            render: (row) => {
              const r = row as unknown as Assistant;
              return r.is_master
                ? <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 border-purple-200">Master</span>
                : <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 border-gray-200">Read Only</span>;
            },
          },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Assistant; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
          { key: "created_at", label: "Invited", sortable: true, render: (row) => { const r = row as unknown as Assistant; return <span className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</span>; } },
          { key: "registered_at", label: "Registered", sortable: true, render: (row) => { const r = row as unknown as Assistant; return <span className="text-sm text-muted-foreground">{fmtDate(r.registered_at)}</span>; } },
          { key: "email_confirmed_at", label: "Email Verified", sortable: true, render: (row) => { const r = row as unknown as Assistant; return <span className="text-sm text-muted-foreground">{fmtDate(r.email_confirmed_at)}</span>; } },
        ]}
      />

      <AdminDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        <form onSubmit={handleSave} className="space-y-4">
          <FormField label="Email" required={mode === "add"}>
            <Input type="email" disabled={mode !== "add"} value={editing.email ?? ""} onChange={(e) => set("email", e.target.value)} required={mode === "add"} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="First Name"><Input disabled={ro} value={editing.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></FormField>
            <FormField label="Last Name"><Input disabled={ro} value={editing.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Access Level">
              {ro ? (
                <Input disabled value={editing.is_master ? "Master" : "Read Only"} />
              ) : (
                <Select value={editing.is_master ? "true" : "false"} onChange={(e) => set("is_master", e.target.value === "true")}>
                  <option value="false">Read Only</option>
                  <option value="true">Master</option>
                </Select>
              )}
            </FormField>
            {mode !== "add" && (
              <FormField label="Status">
                {ro ? <Input disabled value={editing.status ? toTitleCase(editing.status) : ""} /> : (
                  <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="pending">Pending</option>
                  </Select>
                )}
              </FormField>
            )}
          </div>
          <FormField label="Brand" required={mode === "add"}>
            {ro ? <Input disabled value={(editing as any).brand_name ?? ""} /> : (
              <SearchableSelect
                value={editing.brand_id}
                onChange={(v) => { set("brand_id", v ? Number(v) : null); set("shop_id", null); }}
                options={brands.map((b) => ({ value: b.id, label: b.name ?? "" }))}
                placeholder="Select brand…"
                required={mode === "add"}
              />
            )}
          </FormField>
          <FormField label="Shop">
            {ro ? <Input disabled value={(editing as any).shop_name ?? ""} /> : (
              <SearchableSelect
                value={editing.shop_id}
                onChange={(v) => set("shop_id", v ? Number(v) : null)}
                options={filteredShops.map((s) => ({ value: s.id, label: s.name ?? "" }))}
                placeholder={editing.brand_id ? "Select shop…" : "Select brand first…"}
              />
            )}
          </FormField>
          {mode !== "add" && (
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Invited"><Input disabled value={fmtDate(editing.created_at)} /></FormField>
              <FormField label="Registered"><Input disabled value={fmtDate(editing.registered_at)} /></FormField>
              <FormField label="Email Verified"><Input disabled value={fmtDate(editing.email_confirmed_at)} /></FormField>
            </div>
          )}
          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Assistant" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Assistant"
        description={`Delete "${[deleteTarget?.first_name, deleteTarget?.last_name].filter(Boolean).join(" ") || deleteTarget?.email}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminShopAssistants;
