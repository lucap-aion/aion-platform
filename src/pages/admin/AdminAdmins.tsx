import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sendEmail } from "@/utils/sendEmail";
import { siteUrl } from "@/utils/siteUrl";
import { useToast } from "@/hooks/use-toast";
import AdminTable, { StatusBadge } from "./_components/AdminTable";
import type { ExportColumn } from "./_utils/exportCsv";

const ADMINS_SCHEMA: ExportColumn[] = [
  { key: "id",            label: "ID" },
  { key: "first_name",    label: "First Name" },
  { key: "last_name",     label: "Last Name" },
  { key: "email",         label: "Email" },
  { key: "role",          label: "Role" },
  { key: "status",        label: "Status" },
  { key: "phone_number",  label: "Phone" },
  { key: "city",          label: "City" },
  { key: "country",       label: "Country" },
  { key: "registered_at", label: "Registered At" },
];
import AdminDrawer from "./_components/AdminDrawer";
import ConfirmDialog from "./_components/ConfirmDialog";
import { FormField, Input, Select, SaveBar } from "./_components/FormField";
import { ImageUpload } from "./_components/ImageUpload";
import { fmtDate } from "./_components/fmtDate";

interface Admin {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string | null;
  status: string | null;
  phone_number: string | null;
  city: string | null;
  country: string | null;
  avatar: string | null;
  registered_at: string | null;
}

type Mode = "view" | "edit" | "add";

const PAGE_SIZE = 25;

const empty = (): Partial<Admin> => ({
  first_name: "", last_name: "", email: "", role: "admin",
  status: "pending", phone_number: "", city: "", country: "", avatar: "",
});

const AdminAdmins = () => {
  const { toast } = useToast();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("registered_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [editing, setEditing] = useState<Partial<Admin>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    let query = supabase
      .from("admins")
      .select("id, first_name, last_name, email, role, status, phone_number, city, country, avatar, registered_at", { count: "exact" })
      .abortSignal(abortRef.current.signal)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%`);
    if (filterValues.status) query = query.eq("status", filterValues.status);
    query.then(({ data, count, error }) => {
      if (error?.name === "AbortError") return;
      setAdmins((data as Admin[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, [page, search, filterValues, sortKey, sortDir]);

  const openAdd = () => { setEditing(empty()); setMode("add"); setDrawerOpen(true); };
  const openView = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Admin>); setMode("view"); setDrawerOpen(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing({ ...row } as Partial<Admin>); setMode("edit"); setDrawerOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      first_name: editing.first_name ?? null, last_name: editing.last_name ?? null,
      role: editing.role ?? null, status: editing.status ?? null,
      phone_number: editing.phone_number ?? null, city: editing.city ?? null,
      country: editing.country ?? null, avatar: editing.avatar ?? null,
    };
    const { error } = mode === "add"
      ? await supabase.from("admins").insert({ ...payload, email: editing.email! })
      : await supabase.from("admins").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Admin created" : "Admin updated" });
    if (mode === "add") {
      sendEmail("admin_invite", {
        admin: { email: editing.email },
        url: `${siteUrl()}/admin/register?email=${encodeURIComponent(editing.email!)}`,
      });
    }
    setDrawerOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("admins").delete().eq("id", deleteTarget.id);
    setDeleting(false); setDeleteTarget(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Admin deleted" });
    fetchData();
  };

  const handleExport = async (): Promise<Record<string, unknown>[]> => {
    let q = supabase
      .from("admins")
      .select("id, first_name, last_name, email, role, status, phone_number, city, country, registered_at")
      .order(sortKey, { ascending: sortDir === "asc" })
      .limit(10000);
    if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%`);
    if (filterValues.status) q = q.eq("status", filterValues.status);
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  };

  const set = (k: keyof Admin, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));
  const ro = mode === "view";
  const displayName = (r: Partial<Admin>) => [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || "";
  const drawerTitle = mode === "add" ? "New Admin" : mode === "edit" ? `Edit: ${displayName(editing)}` : displayName(editing);

  return (
    <>
      <AdminTable
        title="Admins"
        data={admins as unknown as Record<string, unknown>[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={(q) => { setSearch(q); setPage(0); }}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d); setPage(0); }}
        onExport={handleExport} exportFilename="admins" exportSchema={ADMINS_SCHEMA}
        onAdd={openAdd} addLabel="New Admin"
        onView={openView} onEdit={openEdit}
        onDelete={(row) => setDeleteTarget(row as unknown as Admin)}
        filters={[
          { key: "status", label: "Status", options: [{ value: "pending", label: "Pending" }, { value: "verified", label: "Verified" }, { value: "blocked", label: "Blocked" }] },
        ]}
        filterValues={filterValues}
        onFilterChange={(k, v) => { setFilterValues((p) => ({ ...p, [k]: v })); setPage(0); }}
        columns={[
          {
            key: "first_name", label: "Name", sortable: true, width: 220,
            render: (row) => {
              const r = row as unknown as Admin;
              const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
              return (
                <div className="flex items-center gap-3">
                  {r.avatar ? (
                    <img src={r.avatar} alt={name} className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {`${r.first_name?.[0] ?? ""}${r.last_name?.[0] ?? ""}`.toUpperCase() || "A"}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-foreground">{name}</p>
                    <p className="text-xs text-muted-foreground">{r.email}</p>
                  </div>
                </div>
              );
            },
          },
          {
            key: "city", label: "Location",
            render: (row) => { const r = row as unknown as Admin; return [r.city, r.country].filter(Boolean).join(", ") || "—"; },
          },
          {
            key: "registered_at", label: "Registered", sortable: true,
            render: (row) => { const r = row as unknown as Admin; return fmtDate(r.registered_at); },
          },
          {
            key: "status", label: "Status", sortable: true,
            render: (row) => { const r = row as unknown as Admin; return r.status ? <StatusBadge status={r.status} /> : <span className="text-muted-foreground">—</span>; },
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
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Status">
              {ro ? <Input disabled value={editing.status ?? ""} /> : (
                <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="blocked">Blocked</option>
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="Phone"><Input disabled={ro} value={editing.phone_number ?? ""} onChange={(e) => set("phone_number", e.target.value)} /></FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="City"><Input disabled={ro} value={editing.city ?? ""} onChange={(e) => set("city", e.target.value)} /></FormField>
            <FormField label="Country"><Input disabled={ro} value={editing.country ?? ""} onChange={(e) => set("country", e.target.value)} /></FormField>
          </div>
          <FormField label="Avatar">
            {ro ? (
              editing.avatar
                ? <img src={editing.avatar} alt="" className="h-12 w-12 rounded-full border border-border object-cover" />
                : <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <ImageUpload
                value={editing.avatar}
                onChange={(url) => set("avatar", url)}
                bucket="profile_pictures"
                path={`admins/${editing.id ?? `new-${Date.now()}`}`}
                previewShape="round"
              />
            )}
          </FormField>
          {ro && editing.registered_at && (
            <FormField label="Registered"><Input disabled value={fmtDate(editing.registered_at)} /></FormField>
          )}
          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">Close</button>
              <button type="button" onClick={() => setMode("edit")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar onCancel={() => setDrawerOpen(false)} loading={saving} label={mode === "add" ? "Create Admin" : "Save Changes"} />
          )}
        </form>
      </AdminDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Admin"
        description={`Delete admin "${displayName(deleteTarget ?? {})}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  );
};

export default AdminAdmins;
