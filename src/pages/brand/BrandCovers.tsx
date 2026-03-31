import { motion } from "framer-motion";
import { Search, ChevronDown, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import SearchableSelect from "@/components/SearchableSelect";
import { parseError } from "@/utils/parseError";

const PAGE_SIZE = 25;
type SortOption = "newest" | "oldest" | "expiry_asc" | "expiry_desc";

const sortMap: Record<SortOption, { col: string; asc: boolean }> = {
  newest:     { col: "created_at",      asc: false },
  oldest:     { col: "created_at",      asc: true  },
  expiry_asc: { col: "expiration_date", asc: true  },
  expiry_desc:{ col: "expiration_date", asc: false },
};

type CoverForm = {
  customerId: string;
  itemId: string;
  brandRowId: string;
  brandSaleId: string;
  brandSubOrderRowCode: string;
  startDate: string;
  expirationDate: string;
  sellingPrice: string;
  rrp: string;
  quantity: string;
  purchaseReceipt: string;
  notes: string;
  internalNotes: string;
  status: string;
};

const EMPTY_FORM: CoverForm = {
  customerId: "",
  itemId: "",
  brandRowId: "",
  brandSaleId: "",
  brandSubOrderRowCode: "",
  startDate: "",
  expirationDate: "",
  sellingPrice: "",
  rrp: "",
  quantity: "1",
  purchaseReceipt: "",
  notes: "",
  internalNotes: "",
  status: "live",
};

const inputCls =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div>
    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 block">
      {label}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const BrandCovers = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" | "live" | "expired"
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CoverForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { profile, canWrite } = useAuth();
  const queryClient = useQueryClient();
  const slugPrefix = useAuthSlug();
  const navigate = useNavigate();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Server-side paginated covers query
  const { data: coversData, isLoading, isFetching } = useQuery({
    queryKey: ["brand-covers", profile?.brand_id, page, sortBy, debouncedSearch, statusFilter],
    queryFn: async () => {
      const { col, asc } = sortMap[sortBy];
      let query = supabase
        .from("policies")
        .select(`
          id, start_date, expiration_date, status, selling_price, customer_id, recommended_retail_price, brand_row_id, brand_sale_id, brand_sub_order_row_code, quantity, purchase_receipt, notes, internal_notes,
          catalogues!insured_items_item_id_fkey ( id, name, picture ),
          profiles!insured_items_customer_id_fkey ( first_name, last_name, email ),
          shops!insured_items_shop_id_fkey ( name )
        `, { count: "exact" })
        .eq("brand_id", profile?.brand_id || -1)
        .order(col, { ascending: asc })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim();
        const [{ data: catMatches }, { data: profileMatches }] = await Promise.all([
          supabase.from("catalogues").select("id").eq("brand_id", profile?.brand_id || -1).ilike("name", `%${s}%`),
          supabase.from("profiles").select("id").eq("brand_id", profile?.brand_id || -1).or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`),
        ]);
        const catIds = (catMatches || []).map((c) => c.id);
        const profileIds = (profileMatches || []).map((p) => p.id);
        const filters: string[] = [];
        if (catIds.length) filters.push(`item_id.in.(${catIds.join(",")})`);
        if (profileIds.length) filters.push(`customer_id.in.(${profileIds.join(",")})`);
        if (filters.length === 0) return { data: [], count: 0 };
        query = query.or(filters.join(","));
      }
      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  });

  const policies = coversData?.data || [];
  const total = coversData?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

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
      brandRowId: cover.brand_row_id || "",
      brandSaleId: cover.brand_sale_id || "",
      brandSubOrderRowCode: cover.brand_sub_order_row_code || "",
      startDate: cover.start_date ? cover.start_date.slice(0, 10) : "",
      expirationDate: cover.expiration_date ? cover.expiration_date.slice(0, 10) : "",
      sellingPrice: cover.selling_price ? String(cover.selling_price) : "",
      rrp: cover.recommended_retail_price ? String(cover.recommended_retail_price) : "",
      quantity: cover.quantity ? String(cover.quantity) : "",
      purchaseReceipt: cover.purchase_receipt || "",
      notes: cover.notes || "",
      internalNotes: cover.internal_notes || "",
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
    const missing: string[] = [];
    if (!editingId && !form.customerId) missing.push("Customer");
    if (!editingId && !form.itemId) missing.push("Product");
    if (!form.brandSaleId) missing.push("Brand Sale ID");
    if (!form.brandRowId) missing.push("Row ID");
    if (!form.startDate) missing.push("Start Date");
    if (!form.expirationDate) missing.push("Expiration Date");
    if (!form.sellingPrice) missing.push("Selling Price");
    if (!form.rrp) missing.push("RRP");
    if (!form.quantity) missing.push("Quantity");
    if (missing.length) {
      toast.error(`Please fill in: ${missing.join(", ")}.`);
      return;
    }
    setIsSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("policies")
        .update({
          brand_row_id: form.brandRowId || null,
          brand_sale_id: form.brandSaleId || null,
          brand_sub_order_row_code: form.brandSubOrderRowCode || null,
          start_date: form.startDate || null,
          expiration_date: form.expirationDate || null,
          selling_price: form.sellingPrice ? Number(form.sellingPrice) : null,
          recommended_retail_price: form.rrp ? Number(form.rrp) : null,
          quantity: form.quantity ? Number(form.quantity) : null,
          cogs: computedCogs,
          purchase_receipt: form.purchaseReceipt || null,
          notes: form.notes || null,
          internal_notes: form.internalNotes || null,
          status: form.status || null,
        })
        .eq("id", editingId);
      if (error) {
        toast.error(parseError(error));
        setIsSaving(false);
        return;
      }
      toast.success("Cover updated.");
    } else {
      const { error } = await supabase.from("policies").insert({
        brand_id: profile.brand_id,
        customer_id: form.customerId,
        item_id: Number(form.itemId),
        brand_row_id: form.brandRowId || null,
        brand_sale_id: form.brandSaleId || null,
        brand_sub_order_row_code: form.brandSubOrderRowCode || null,
        start_date: form.startDate || null,
        expiration_date: form.expirationDate || null,
        selling_price: form.sellingPrice ? Number(form.sellingPrice) : null,
        recommended_retail_price: form.rrp ? Number(form.rrp) : null,
        quantity: form.quantity ? Number(form.quantity) : null,
        cogs: computedCogs,
        purchase_receipt: form.purchaseReceipt || null,
        notes: form.notes || null,
        internal_notes: form.internalNotes || null,
        status: form.status || "live",
      });
      if (error) {
        toast.error(parseError(error));
        setIsSaving(false);
        return;
      }
      toast.success("Cover created.");
    }

    setIsSaving(false);
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["brand-covers"] });
  };

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("policies").delete().eq("id", id);
    if (error) {
      toast.error(parseError(error));
      return;
    }
    setConfirmDeleteId(null);
    toast.success("Cover deleted.");
    queryClient.invalidateQueries({ queryKey: ["brand-covers"] });
  };

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
              placeholder="Search by product or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Status</option>
              <option value="live">Live</option>
              <option value="pending">Pending</option>
              <option value="blocked">Blocked</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as SortOption); setPage(0); }}
              className="appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="expiry_asc">Expiry: Soonest</option>
              <option value="expiry_desc">Expiry: Latest</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      {isFetching && !coversData ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card flex items-center gap-4 p-4">
              <div className="h-14 w-14 shrink-0 rounded-xl bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 rounded bg-muted animate-pulse" />
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              </div>
              <div className="hidden md:flex flex-col items-center gap-1 shrink-0">
                <div className="h-3.5 w-20 rounded bg-muted animate-pulse" />
                <div className="h-3 w-10 rounded bg-muted animate-pulse" />
              </div>
              <div className="hidden md:flex flex-col items-center gap-1 shrink-0">
                <div className="h-3.5 w-20 rounded bg-muted animate-pulse" />
                <div className="h-3 w-14 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-6 w-16 rounded-full bg-muted animate-pulse shrink-0" />
              <div className="flex gap-1 shrink-0">
                <div className="h-7 w-7 rounded-md bg-muted animate-pulse" />
                <div className="h-7 w-7 rounded-md bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : !policies.length ? (
        <div className="glass-card flex items-center justify-center py-20">
          <p className="text-muted-foreground">No covers found.</p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {policies.map((cover, i) => {
            const status = getStatus(cover);
            return (
              <motion.div
                key={cover.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card flex items-center gap-4 p-4 transition-shadow hover:shadow-md cursor-pointer"
                onClick={() => navigate(`${slugPrefix}/covers/${cover.id}`)}
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
                  {(cover as any).shops?.name && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Store: {(cover as any).shops.name}
                    </p>
                  )}
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
                    <span className="text-xs text-muted-foreground">
                      RRP:{" "}
                      <span className="text-foreground font-medium">
                        €{(cover.recommended_retail_price || 0).toLocaleString()}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="hidden md:block text-center shrink-0 w-[100px]">
                  <p className="text-sm text-foreground whitespace-nowrap">
                    {formatDate(cover.start_date)}
                  </p>
                  <p className="text-xs text-muted-foreground">Start</p>
                </div>
                <div className="hidden md:block text-center shrink-0 w-[100px]">
                  <p className="text-sm text-foreground whitespace-nowrap">
                    {formatDate(cover.expiration_date)}
                  </p>
                  <p className="text-xs text-muted-foreground">Expiration</p>
                </div>
                <div className="hidden md:block text-center shrink-0 w-[80px]">
                  <p className="text-sm text-foreground whitespace-nowrap">
                    €{(cover.recommended_retail_price || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">RRP</p>
                </div>
                <span
                  className={`shrink-0 w-[80px] text-center rounded-full px-3 py-1 text-xs font-medium ${
                    status === "Active" || status === "Live"
                      ? "bg-success/10 text-success"
                      : status === "Expiring"
                      ? "bg-warning/10 text-warning"
                      : status === "Cancelled"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {status}
                </span>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {canWrite && (
                    <button
                      onClick={() => openEdit(cover)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canWrite && (
                    <button
                      onClick={() => setConfirmDeleteId(cover.id)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <p className="text-xs text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-sm text-foreground">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        </>
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
                    <Field label="Customer" required>
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
                    <Field label="Product" required>
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

              {/* Sale Reference */}
              <div className={editingId ? "" : "border-t border-border/50 pt-5"}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Sale Reference
                </p>
                <div className="space-y-3">
                  <Field label="Brand Sale ID" required>
                    <input
                      type="text"
                      value={form.brandSaleId}
                      onChange={(e) => setForm((p) => ({ ...p, brandSaleId: e.target.value }))}
                      placeholder="e.g. ORD-2024-001"
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Row ID" required>
                      <input
                        type="text"
                        value={form.brandRowId}
                        onChange={(e) => setForm((p) => ({ ...p, brandRowId: e.target.value }))}
                        placeholder="e.g. ROW-001"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Sub-Order Code">
                      <input
                        type="text"
                        value={form.brandSubOrderRowCode}
                        onChange={(e) => setForm((p) => ({ ...p, brandSubOrderRowCode: e.target.value }))}
                        placeholder="e.g. SUB-001"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Coverage Period */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Coverage Period
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start Date" required>
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
                  <Field label="Expiration Date" required>
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
                  Pricing & Quantity
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Selling Price (€)" required>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.sellingPrice}
                      onChange={(e) => setForm((p) => ({ ...p, sellingPrice: e.target.value }))}
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="RRP (€)" required>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.rrp}
                      onChange={(e) => setForm((p) => ({ ...p, rrp: e.target.value }))}
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="COGS (auto)">
                    <div className="w-full rounded-lg border border-input bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
                      {computedCogs !== null ? `€${computedCogs.toFixed(2)}` : "—"}
                    </div>
                  </Field>
                  <Field label="Quantity" required>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={form.quantity}
                      onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
                      placeholder="1"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>

              {/* Notes & Receipt */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Notes & Receipt
                </p>
                <div className="space-y-3">
                  <Field label="Purchase Receipt URL">
                    <input
                      type="text"
                      value={form.purchaseReceipt}
                      onChange={(e) => setForm((p) => ({ ...p, purchaseReceipt: e.target.value }))}
                      placeholder="https://..."
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Notes (visible to customer)">
                    <textarea
                      rows={2}
                      value={form.notes}
                      onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Any notes for the customer..."
                      className={inputCls + " resize-none"}
                    />
                  </Field>
                  <Field label="Internal Notes">
                    <textarea
                      rows={2}
                      value={form.internalNotes}
                      onChange={(e) => setForm((p) => ({ ...p, internalNotes: e.target.value }))}
                      placeholder="Internal team notes..."
                      className={inputCls + " resize-none"}
                    />
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
                    <option value="live">Live</option>
                    <option value="pending">Pending</option>
                    <option value="blocked">Blocked</option>
                    <option value="cancelled">Cancelled</option>
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
