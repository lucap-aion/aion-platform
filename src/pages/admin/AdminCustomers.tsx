import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge, type FilterDef } from "./_components/AdminTable";
import type { ExportColumn } from "./_utils/exportCsv";
import { resolveSortOrder } from "./_utils/resolveSortOrder";

const SORT_RELATIONS = ["brands"] as const;

const CUSTOMERS_SCHEMA: ExportColumn[] = [
  { key: "id",                  label: "ID" },
  { key: "first_name",          label: "First Name" },
  { key: "last_name",           label: "Last Name" },
  { key: "email",               label: "Email" },
  { key: "brands_name",         label: "Brand" },
  { key: "status",              label: "Status" },
  { key: "phone_number",        label: "Phone" },
  { key: "city",                label: "City" },
  { key: "country",             label: "Country" },
  { key: "address",             label: "Address" },
  { key: "postcode",            label: "Postcode" },
  { key: "created_at",          label: "Created At" },
  { key: "registered_at",       label: "Registered At" },
  { key: "email_confirmed_at",  label: "Email Confirmed At" },
  { key: "brand_id",            label: "Brand ID" },
];
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, SaveBar } from "./_components/FormField";
import { SearchableSelect } from "./_components/SearchableSelect";
import { fmtDate } from "./_components/fmtDate";
import { sendEmail } from "@/utils/sendEmail";
import { siteUrl } from "@/utils/siteUrl";
import { Mail, MailCheck, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  city: string | null;
  country: string | null;
  phone_number: string | null;
  address: string | null;
  postcode: string | null;
  status: string | null;
  created_at: string | null;
  registered_at: string | null;
  email_confirmed_at: string | null;
  brand_id: number | null;
  role: string | null;
  brand_name?: string;
  brand_logo?: string | null;
  avatar?: string | null;
}

interface BrandOption { id: number; name: string | null; }

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Customer> => ({
  first_name: "", last_name: "", email: "", city: "", country: "",
  phone_number: "", address: "", postcode: "", status: "pending",
  brand_id: null, role: "customer",
});

const AdminCustomers = () => {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
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
  const [editing, setEditing] = useState<Partial<Customer>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    if (brands.length === 0) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    const brandFilterIds = filterValues.brand_id ? [Number(filterValues.brand_id)] : brands.map((b) => b.id);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let query = supabase
      .from("profiles")
      .select("*, brands(*), shops(*)", { count: "exact" })
      .eq("role", "customer")
      .in("brand_id", brandFilterIds)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%,phone_number.ilike.%${search}%,address.ilike.%${search}%,postcode.ilike.%${search}%,status.ilike.%${search}%`);
    if (filterValues.status) query = query.eq("status", filterValues.status);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setCustomers((data ?? []).map((p: any) => ({
        ...p,
        brand_name: p.brands?.name ?? "—",
        brand_logo: p.brands?.logo_small ?? null,
        avatar: p.avatar ?? null,
      })));
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir, brands]);

  useEffect(() => {
    supabase.from("brands").select("id, name").eq("status", "verified").order("name").then(({ data }) => setBrands((data as BrandOption[]) ?? []));
  }, []);

  const openAdd = () => { setEditing(empty()); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Customer>); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Customer>); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (mode === "add") {
      const { error } = await supabase.from("profiles").insert({
        first_name: editing.first_name ?? null, last_name: editing.last_name ?? null,
        email: editing.email!, city: editing.city ?? null, country: editing.country ?? null,
        phone_number: editing.phone_number ?? null, address: editing.address ?? null,
        postcode: editing.postcode ?? null, status: "pending",
        brand_id: editing.brand_id ?? null, role: editing.role ?? "customer",
      });
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      const brandId = editing.brand_id;
      const inviteEmail = editing.email!;
      const inviteFirstName = editing.first_name ?? null;
      setDrawerOpen(false);
      fetchData();
      if (!brandId) {
        toast({ title: "Customer created", description: "No brand selected — no invite email sent" });
      } else {
        toast({ title: "Customer created" });
        (async () => {
          const { data: brandData } = await supabase.from("brands").select("name, slug, logo_small, logo_big").eq("id", brandId).single();
          if (!brandData) {
            toast({ title: "Invite email not sent", description: "Could not load brand data", variant: "destructive" });
            return;
          }
          const emailErr = await sendEmail("customer_invite", {
            customer: { email: inviteEmail, first_name: inviteFirstName },
            brand: { name: brandData.name, id: brandId },
            url: `${siteUrl()}/${brandData.slug}/signup`,
          });
          if (emailErr) toast({ title: "Invite email failed", description: emailErr, variant: "destructive" });
          else toast({ title: "Invite email sent", description: inviteEmail });
        })();
      }
    } else {
      const { error } = await supabase.from("profiles").update({
        first_name: editing.first_name ?? null, last_name: editing.last_name ?? null,
        city: editing.city ?? null, country: editing.country ?? null,
        phone_number: editing.phone_number ?? null, address: editing.address ?? null,
        postcode: editing.postcode ?? null, status: editing.status ?? null,
        brand_id: editing.brand_id ?? null,
      }).eq("id", editing.id!);
      setSaving(false);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      setDrawerOpen(false);
      fetchData();
      toast({ title: "Customer updated" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("profiles").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Customer deleted" });
    fetchData();
  };

  const handleResendInvite = async (row: Record<string, unknown>) => {
    const r = row as unknown as Customer;
    if (!r.brand_id) { toast({ title: "No brand assigned", variant: "destructive" }); return; }
    setPendingAction(`${r.id}:invite`);
    const { data: brandData } = await supabase.from("brands").select("name, slug").eq("id", r.brand_id).single();
    if (!brandData) { setPendingAction(null); toast({ title: "Brand not found", variant: "destructive" }); return; }
    const emailError = await sendEmail("customer_invite", {
      customer: { email: r.email, first_name: r.first_name ?? null },
      brand: { name: brandData.name, id: r.brand_id },
      url: `${siteUrl()}/${brandData.slug}/signup`,
    });
    setPendingAction(null);
    if (emailError) toast({ title: "Invite email failed", description: emailError, variant: "destructive" });
    else toast({ title: "Invite email sent", description: r.email });
  };

  const handleResendConfirmation = async (row: Record<string, unknown>) => {
    const r = row as unknown as Customer;
    setPendingAction(`${r.id}:confirm`);
    const { data: brandData } = r.brand_id
      ? await supabase.from("brands").select("slug").eq("id", r.brand_id).single()
      : { data: null as { slug: string } | null };
    const redirect = brandData?.slug ? `${siteUrl()}/${brandData.slug}` : siteUrl();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: r.email,
      options: { emailRedirectTo: redirect },
    });
    setPendingAction(null);
    if (error) toast({ title: "Confirmation email failed", description: error.message, variant: "destructive" });
    else toast({ title: "Confirmation email sent", description: r.email });
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    const brandFilterIds = filterValues.brand_id ? [Number(filterValues.brand_id)] : brands.map((b) => b.id);
    const order = resolveSortOrder(sortKey, SORT_RELATIONS);
    let q = supabase
      .from("profiles")
      .select("*, brands(*), shops(*)")
      .eq("role", "customer")
      .in("brand_id", brandFilterIds)
      .order(order.column, { ascending: sortDir === "asc", foreignTable: order.foreignTable })
      .limit(10000);
    if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%,phone_number.ilike.%${search}%,address.ilike.%${search}%,postcode.ilike.%${search}%,status.ilike.%${search}%`);
    if (filterValues.status) q = q.eq("status", filterValues.status);
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  };

  const set = (k: keyof Customer, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const ro = mode === "view";
  const drawerTitle = mode === "add" ? "New Customer" : mode === "edit" ? "Edit Customer" : "View Customer";

  return (
    <>
      <AdminTable
        title="Customers"
        data={customers as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onExport={handleExport} exportFilename="customers" exportSchema={CUSTOMERS_SCHEMA}
        onAdd={openAdd} addLabel="New Customer"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Customer)}
        filters={[
          { key: "brand_id", label: "Brand", options: brands.map((b) => ({ value: String(b.id), label: b.name ?? "" })) },
          { key: "status", label: "Status", options: [{ value: "pending", label: "Pending" }, { value: "verified", label: "Verified" }, { value: "blocked", label: "Blocked" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        extraRowAction={(row) => {
          const r = row as unknown as Customer;
          if (r.status !== "pending") return null;
          const invitePending = pendingAction === `${r.id}:invite`;
          const confirmPending = pendingAction === `${r.id}:confirm`;
          const hasRegistered = !!r.registered_at;
          return hasRegistered ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleResendConfirmation(row)}
                  disabled={confirmPending}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {confirmPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>Resend email confirmation</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleResendInvite(row)}
                  disabled={invitePending}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {invitePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>Resend invite email</TooltipContent>
            </Tooltip>
          );
        }}
        columns={[
          {
            key: "first_name", label: "Name", sortable: true, width: 220,
            render: (row) => {
              const r = row as unknown as Customer;
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
            key: "brand_name", sortKey: "brands_name", label: "Brand",
            render: (row) => {
              const r = row as unknown as Customer;
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
          {
            key: "city", label: "Location", sortable: true,
            render: (row) => { const r = row as unknown as Customer; return [r.city, r.country].filter(Boolean).join(", ") || "—"; },
          },
          {
            key: "created_at", label: "Creation Date", sortable: true,
            render: (row) => { const r = row as unknown as Customer; return fmtDate(r.created_at); },
          },
          {
            key: "registered_at", label: "Sign Up Date", sortable: true,
            render: (row) => { const r = row as unknown as Customer; return fmtDate(r.registered_at); },
          },
          {
            key: "email_confirmed_at", label: "Confirmation Date", sortable: true,
            render: (row) => { const r = row as unknown as Customer; return fmtDate(r.email_confirmed_at); },
          },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Customer; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
          },
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
          <FormField label="Brand" required={mode === "add"}>
            {ro ? <Input disabled value={(editing as any).brand_name ?? ""} /> : (
              <SearchableSelect
                value={editing.brand_id}
                onChange={(v) => set("brand_id", v ? Number(v) : null)}
                options={brands.map((b) => ({ value: b.id, label: b.name ?? "" }))}
                placeholder="Select brand…"
                required={mode === "add"}
              />
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="City"><Input disabled={ro} value={editing.city ?? ""} onChange={(e) => set("city", e.target.value)} /></FormField>
            <FormField label="Country"><Input disabled={ro} value={editing.country ?? ""} onChange={(e) => set("country", e.target.value)} /></FormField>
          </div>
          <FormField label="Phone"><Input disabled={ro} value={editing.phone_number ?? ""} onChange={(e) => set("phone_number", e.target.value)} /></FormField>
          <FormField label="Address"><Input disabled={ro} value={editing.address ?? ""} onChange={(e) => set("address", e.target.value)} /></FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Postcode"><Input disabled={ro} value={editing.postcode ?? ""} onChange={(e) => set("postcode", e.target.value)} /></FormField>
            {mode !== "add" && (
              <FormField label="Status">
                {ro ? <Input disabled value={editing.status ?? ""} /> : (
                  <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                    <option value="pending">Pending</option>
                    <option value="verified">Verified</option>
                    <option value="blocked">Blocked</option>
                  </Select>
                )}
              </FormField>
            )}
          </div>
          {ro && (
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Creation Date"><Input disabled value={fmtDate(editing.created_at)} /></FormField>
              <FormField label="Sign Up Date"><Input disabled value={fmtDate(editing.registered_at)} /></FormField>
              <FormField label="Confirmation Date"><Input disabled value={fmtDate(editing.email_confirmed_at)} /></FormField>
            </div>
          )}
          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Customer" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Customer"
        description={`Delete customer "${[deleteTarget?.first_name, deleteTarget?.last_name].filter(Boolean).join(" ") || deleteTarget?.email}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminCustomers;
