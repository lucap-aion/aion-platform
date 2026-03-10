import { motion } from "framer-motion";
import { Search, ChevronDown, Plus, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBrandPolicies } from "@/hooks/use-policies";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import SearchableSelect from "@/components/SearchableSelect";

type CoverForm = {
  customerId: string;
  itemId: string;
  startDate: string;
  expirationDate: string;
  sellingPrice: string;
  rrp: string;
  status: string;
};

const EMPTY_FORM: CoverForm = {
  customerId: "",
  itemId: "",
  startDate: "",
  expirationDate: "",
  sellingPrice: "",
  rrp: "",
  status: "live",
};

const inputCls =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 block">
      {label}
    </label>
    {children}
  </div>
);

const BrandCovers = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CoverForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { profile, canWrite } = useAuth();
  const queryClient = useQueryClient();
  const { data: policies, isLoading } = useBrandPolicies();

  // Lazy-load customers and catalogues only when modal is open
  const { data: customers } = useQuery({
    queryKey: ["brand-customers-for-select", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .eq("brand_id", profile?.brand_id || -1)
        .eq("role", "customer")
        .order("first_name");
      if (error) throw error;
      return data || [];
    },
    enabled: modalOpen && !!profile?.brand_id,
  });

  const { data: catalogues } = useQuery({
    queryKey: ["brand-catalogues-for-select", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogues")
        .select("id, name, category")
        .eq("brand_id", profile?.brand_id || -1)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: modalOpen && !!profile?.brand_id,
  });

  const { data: mfgCosts } = useQuery({
    queryKey: ["brand-mfg-costs", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manufacturing_costs")
        .select("category, cost_pct")
        .eq("brand_id", profile?.brand_id || -1);
      if (error) throw error;
      return data || [];
    },
    enabled: modalOpen && !!profile?.brand_id,
  });

  const formatDate = (d: string | null) =>
    d ? format(new Date(d), "MMM dd, yyyy") : "—";

  const getStatus = (p: any) => {
    if (!p.status) return "Active";
    if (p.status === "expired") return "Expired";
    if (p.expiration_date) {
      const diff = new Date(p.expiration_date).getTime() - Date.now();
      if (diff < 30 * 24 * 60 * 60 * 1000 && diff > 0) return "Expiring";
    }
    return p.status.charAt(0).toUpperCase() + p.status.slice(1);
  };

  const filtered = policies?.filter((p) => {
    const name = p.catalogues?.name || "";
    const customer = `${(p as any).profiles?.first_name || ""} ${(p as any).profiles?.last_name || ""}`;
    const matchesSearch =
      name.toLowerCase().includes(search.toLowerCase()) ||
      customer.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || getStatus(p) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (cover: any) => {
    setEditingId(cover.id);
    setForm({
      customerId: cover.customer_id || "",
      itemId: cover.catalogues?.id ? String(cover.catalogues.id) : "",
      startDate: cover.start_date ? cover.start_date.slice(0, 10) : "",
      expirationDate: cover.expiration_date
        ? cover.expiration_date.slice(0, 10)
        : "",
      sellingPrice: cover.selling_price ? String(cover.selling_price) : "",
      rrp: cover.recommended_retail_price
        ? String(cover.recommended_retail_price)
        : "",
      status: cover.status || "live",
    });
    setModalOpen(true);
  };

  const selectedCatalogue = (catalogues || []).find((c) => String(c.id) === form.itemId);
  const mfgRate = selectedCatalogue?.category
    ? (mfgCosts || []).find((m) => m.category === selectedCatalogue.category)?.cost_pct
    : undefined;
  const computedCogs =
    mfgRate != null && form.rrp
      ? Math.round(Number(form.rrp) * mfgRate * 100) / 100
      : null;

  const handleSave = async () => {
    if (!profile?.brand_id) return;
    if (!editingId && (!form.customerId || !form.itemId)) {
      toast.error("Customer and product are required.");
      return;
    }
    setIsSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("policies")
        .update({
          start_date: form.startDate || null,
          expiration_date: form.expirationDate || null,
          selling_price: form.sellingPrice ? Number(form.sellingPrice) : null,
          recommended_retail_price: form.rrp ? Number(form.rrp) : null,
          cogs: computedCogs,
          status: form.status || null,
        })
        .eq("id", editingId);
      if (error) {
        toast.error(error.message);
        setIsSaving(false);
        return;
      }
      toast.success("Cover updated.");
    } else {
      const { error } = await supabase.from("policies").insert({
        brand_id: profile.brand_id,
        customer_id: form.customerId,
        item_id: Number(form.itemId),
        start_date: form.startDate || null,
        expiration_date: form.expirationDate || null,
        selling_price: form.sellingPrice ? Number(form.sellingPrice) : null,
        recommended_retail_price: form.rrp ? Number(form.rrp) : null,
        cogs: computedCogs,
        status: form.status || "live",
      });
      if (error) {
        toast.error(error.message);
        setIsSaving(false);
        return;
      }
      toast.success("Cover created.");
    }

    setIsSaving(false);
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["brand-policies"] });
  };

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("policies").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConfirmDeleteId(null);
    toast.success("Cover deleted.");
    queryClient.invalidateQueries({ queryKey: ["brand-policies"] });
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
              Covers
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              All product covers across your customer base.
            </p>
          </div>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 shrink-0"
            >
              <Plus className="h-4 w-4" /> Add Cover
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search covers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Status</option>
              <option value="Active">Active</option>
              <option value="Expiring">Expiring</option>
              <option value="Expired">Expired</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      {!filtered?.length ? (
        <div className="glass-card flex items-center justify-center py-20">
          <p className="text-muted-foreground">No covers found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((cover, i) => {
            const status = getStatus(cover);
            return (
              <motion.div
                key={cover.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card flex items-center gap-4 p-4 transition-shadow hover:shadow-md"
              >
                <div className="h-14 w-14 shrink-0 rounded-xl bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-1.5">
                  <img
                    src={cover.catalogues?.picture || "/placeholder.svg"}
                    alt={cover.catalogues?.name || ""}
                    className="h-full w-full object-contain mix-blend-multiply"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {cover.catalogues?.name || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(cover as any).profiles?.first_name}{" "}
                    {(cover as any).profiles?.last_name}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 md:hidden">
                    <span className="text-xs text-muted-foreground">
                      Start:{" "}
                      <span className="text-foreground font-medium">
                        {formatDate(cover.start_date)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Exp:{" "}
                      <span className="text-foreground font-medium">
                        {formatDate(cover.expiration_date)}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="hidden md:block text-center shrink-0">
                  <p className="text-sm text-foreground">
                    {formatDate(cover.start_date)}
                  </p>
                  <p className="text-xs text-muted-foreground">Start</p>
                </div>
                <div className="hidden md:block text-center shrink-0">
                  <p className="text-sm text-foreground">
                    {formatDate(cover.expiration_date)}
                  </p>
                  <p className="text-xs text-muted-foreground">Expiration</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                    status === "Active"
                      ? "bg-success/10 text-success"
                      : status === "Expiring"
                      ? "bg-warning/10 text-warning"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {status}
                </span>
                {canWrite && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(cover)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(cover.id)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border/50">
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {editingId ? "Edit Cover" : "Add Cover"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingId
                    ? "Update coverage dates, pricing and status."
                    : "Create a new cover for a customer's product."}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Cover Details (add only) */}
              {!editingId && (
                <div className="mb-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Cover Details
                  </p>
                  <div className="space-y-3">
                    <Field label="Customer">
                      <SearchableSelect
                        value={form.customerId}
                        onChange={(v) => setForm((p) => ({ ...p, customerId: v }))}
                        placeholder="Select customer..."
                        searchPlaceholder="Search customers..."
                        options={(customers || []).map((c) => ({
                          value: c.id,
                          label: `${c.first_name || ""} ${c.last_name || ""}`.trim()
                            ? `${c.first_name || ""} ${c.last_name || ""}`.trim() + ` (${c.email})`
                            : c.email,
                        }))}
                      />
                    </Field>
                    <Field label="Product">
                      <SearchableSelect
                        value={form.itemId}
                        onChange={(v) => setForm((p) => ({ ...p, itemId: v }))}
                        placeholder="Select product..."
                        searchPlaceholder="Search products..."
                        options={(catalogues || []).map((c) => ({
                          value: String(c.id),
                          label: c.name,
                        }))}
                      />
                    </Field>
                  </div>
                </div>
              )}

              {/* Coverage Period */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Coverage Period
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start Date">
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => {
                        const start = e.target.value;
                        setForm((p) => {
                          const expiration = start && !p.expirationDate
                            ? (() => { const d = new Date(start); d.setFullYear(d.getFullYear() + 2); return d.toISOString().slice(0, 10); })()
                            : p.expirationDate;
                          return { ...p, startDate: start, expirationDate: expiration };
                        });
                      }}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Expiration Date">
                    <input
                      type="date"
                      value={form.expirationDate}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          expirationDate: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>

              {/* Pricing */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Pricing
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Selling Price (€)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.sellingPrice}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, sellingPrice: e.target.value }))
                      }
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="RRP (€)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.rrp}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, rrp: e.target.value }))
                      }
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="COGS (auto)">
                    <div className="w-full rounded-lg border border-input bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
                      {computedCogs !== null ? `€${computedCogs.toFixed(2)}` : "—"}
                    </div>
                  </Field>
                </div>
              </div>

              {/* Status */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Status
                </p>
                <Field label="Cover Status">
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, status: e.target.value }))
                    }
                    className={inputCls}
                  >
                    <option value="live">Active</option>
                    <option value="expired">Expired</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border/50">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving
                  ? "Saving..."
                  : editingId
                  ? "Save Changes"
                  : "Add Cover"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDeleteId(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-border/50">
              <h2 className="font-serif text-lg font-semibold text-foreground">
                Delete cover?
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Cover #{confirmDeleteId} will be permanently deleted along with
                any associated data.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="rounded-lg bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BrandCovers;
