import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Search, Eye, XCircle, ChevronDown, Trash2, Plus, Pencil, X, ChevronLeft, ChevronRight, ArrowUpDown, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import SearchableSelect from "@/components/SearchableSelect";

const CLAIM_TYPES = ["Accidental Damage", "Robbery", "Theft"];
const COUNTRIES = [
  "Italy", "France", "United Kingdom", "Germany", "Switzerland",
  "United States", "Spain", "Portugal", "Other",
];

const statusMap = {
  open: { label: "Open", color: "bg-amber-50 text-amber-700" },
  closed: { label: "Closed", color: "bg-emerald-50 text-emerald-700" },
} as const;

const getStatus = (value?: string | null): keyof typeof statusMap =>
  value === "closed" ? "closed" : "open";

const toLabel = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

type ClaimForm = {
  policyId: string;
  type: string;
  incidentDate: string;
  incidentCity: string;
  incidentCountry: string;
  description: string;
  status: string;
};

const EMPTY_FORM: ClaimForm = {
  policyId: "",
  type: "",
  incidentDate: "",
  incidentCity: "",
  incidentCountry: "",
  description: "",
  status: "open",
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

type SortKey = "id" | "created_at" | "type" | "status";
const PAGE_SIZE = 25;

const BrandClaims = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "open" | "closed">("");
  const [typeFilter, setTypeFilter] = useState("");
  const [claims, setClaims] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const slugPrefix = useAuthSlug();
  const { profile, canWrite } = useAuth();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ClaimForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [editingMedia, setEditingMedia] = useState<string[]>([]);

  const fetchClaims = useCallback(async () => {
    if (!profile?.brand_id) return;
    setIsLoading(true);

    let query = supabase
      .from("claims")
      .select(
        `id, type, status, created_at, incident_date, incident_city, incident_country, description, policy_id, media,
        policies!claims_policy_id_fkey!inner(
          id, brand_id,
          catalogues!insured_items_item_id_fkey(name, picture),
          profiles!insured_items_customer_id_fkey(first_name, last_name, email, avatar)
        )`,
        { count: "exact" }
      )
      .eq("policies.brand_id", profile.brand_id)
      .order(sortKey, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFilter) query = query.eq("status", statusFilter);
    if (typeFilter) query = query.eq("type", typeFilter);

    const { data, count, error } = await query;
    if (error) {
      toast.error(error.message);
      setIsLoading(false);
      return;
    }
    setClaims(data || []);
    setTotal(count ?? 0);
    setIsLoading(false);
  }, [profile?.brand_id, page, sortKey, sortDir, statusFilter, typeFilter]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);

  // Lazy-load covers (policies) for the claim form
  const { data: policies } = useQuery({
    queryKey: ["brand-policies-for-claims", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(
          "id, customer_id, catalogues!insured_items_item_id_fkey(name), profiles!insured_items_customer_id_fkey(first_name, last_name)"
        )
        .eq("brand_id", profile?.brand_id || -1)
        .order("id", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: modalOpen && !!profile?.brand_id,
    staleTime: 60_000,
  });

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const handleClose = async (claimId: number) => {
    const { error } = await supabase
      .from("claims")
      .update({ status: "closed" })
      .eq("id", claimId);
    if (error) {
      toast.error(`Unable to close claim #${claimId}: ${error.message}`);
      return;
    }
    fetchClaims();
    toast.success(`Claim #${claimId} closed`);
  };

  const handleDelete = async (claimId: number) => {
    const { error } = await supabase.from("claims").delete().eq("id", claimId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConfirmDeleteId(null);
    fetchClaims();
    toast.success(`Claim #${claimId} deleted`);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (claim: any) => {
    setEditingId(claim.id);
    setEditingMedia(Array.isArray(claim.media) ? claim.media : []);
    setForm({
      policyId: claim.policies?.id ? String(claim.policies.id) : "",
      type: claim.type || "",
      incidentDate: claim.incident_date ? claim.incident_date.slice(0, 10) : "",
      incidentCity: claim.incident_city || "",
      incidentCountry: claim.incident_country || "",
      description: claim.description || "",
      status: getStatus(claim.status),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!editingId && !form.policyId) {
      toast.error("Please select a cover.");
      return;
    }
    if (!form.type || !form.incidentDate || !form.incidentCity || !form.incidentCountry || !form.description) {
      toast.error("Please complete all required fields.");
      return;
    }
    setIsSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("claims")
        .update({
          policy_id: form.policyId ? Number(form.policyId) : undefined,
          type: form.type,
          incident_date: form.incidentDate,
          incident_city: form.incidentCity,
          incident_country: form.incidentCountry,
          description: form.description,
          status: form.status,
        })
        .eq("id", editingId);
      if (error) {
        toast.error(error.message);
        setIsSaving(false);
        return;
      }
      toast.success("Claim updated.");
    } else {
      const { error } = await supabase.from("claims").insert({
        policy_id: Number(form.policyId),
        type: form.type,
        incident_date: form.incidentDate,
        incident_city: form.incidentCity,
        incident_country: form.incidentCountry,
        description: form.description,
        status: "open",
      });
      if (error) {
        toast.error(error.message);
        setIsSaving(false);
        return;
      }
      toast.success("Claim created.");
    }

    setIsSaving(false);
    setModalOpen(false);
    fetchClaims();
  };

  // Client-side text search within current page
  const filtered = claims.filter((claim: any) => {
    if (!search) return true;
    const product = claim.policies?.catalogues?.name || "";
    const customer = `${claim.policies?.profiles?.first_name || ""} ${claim.policies?.profiles?.last_name || ""} ${claim.policies?.profiles?.email || ""}`.toLowerCase();
    return `${claim.id} ${product} ${claim.type || ""} ${customer}`.toLowerCase().includes(search.toLowerCase());
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const SortableTh = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => handleSort(col)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === col ? "text-primary" : "opacity-40"}`} />
      </div>
    </th>
  );

  if (isLoading && claims.length === 0) {
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
              Claims
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review and manage customer claims.
            </p>
          </div>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 shrink-0"
            >
              <Plus className="h-4 w-4" /> New Claim
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search claims..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as "" | "open" | "closed"); setPage(0); }}
              className="appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Types</option>
              {CLAIM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-border">
                <SortableTh col="id" label="ID" />
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Customer
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Product
                </th>
                <SortableTh col="type" label="Type" />
                <SortableTh col="created_at" label="Date" />
                <SortableTh col="status" label="Status" />
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No claims found.
                  </td>
                </tr>
              ) : (
                filtered.map((claim: any) => {
                  const key = getStatus(claim.status);
                  const state = statusMap[key];
                  return (
                    <tr
                      key={claim.id}
                      className="transition-colors hover:bg-secondary/30"
                    >
                      <td className="px-6 py-4 text-sm font-medium text-foreground">
                        {claim.id}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const firstName = claim.policies?.profiles?.first_name || "";
                          const lastName = claim.policies?.profiles?.last_name || "";
                          const name = `${firstName} ${lastName}`.trim();
                          const initials = `${(firstName[0] || claim.policies?.profiles?.email?.[0] || "?").toUpperCase()}${(lastName[0] || "").toUpperCase()}`;
                          return (
                            <div className="flex items-center gap-2.5">
                              <div className="h-9 w-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary overflow-hidden">
                                {claim.policies?.profiles?.avatar
                                  ? <img src={claim.policies.profiles.avatar} alt="" className="h-full w-full object-cover" />
                                  : initials}
                              </div>
                              <div>
                                <p className="text-sm text-foreground">{name || claim.policies?.profiles?.email || "—"}</p>
                                {name && <p className="text-xs text-muted-foreground">{claim.policies?.profiles?.email}</p>}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          {claim.policies?.catalogues?.picture
                            ? <img src={claim.policies.catalogues.picture} alt={claim.policies?.catalogues?.name || ""} className="h-9 w-9 rounded-lg object-contain bg-secondary/50 shrink-0" />
                            : <div className="h-9 w-9 rounded-lg bg-secondary/50 shrink-0" />}
                          <span className="text-sm text-foreground whitespace-nowrap">{claim.policies?.catalogues?.name || "—"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">
                        {toLabel(claim.type)}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">
                        {claim.created_at ? format(new Date(claim.created_at), "MMM dd, yyyy") : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${state.color}`}>
                          {state.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`${slugPrefix}/claims/${claim.id}`}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          {canWrite && (
                            <button
                              onClick={() => openEdit(claim)}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                              title="Edit claim"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canWrite && key === "open" && (
                            <button
                              onClick={() => handleClose(claim.id)}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                              title="Close claim"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                          {canWrite && (
                            <button
                              onClick={() => setConfirmDeleteId(claim.id)}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title="Delete claim"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-6 py-3">
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
              <span className="px-3 text-sm text-foreground">
                {page + 1} / {totalPages}
              </span>
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
      </motion.div>

      {/* Add / Edit Claim Modal */}
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
                  {editingId ? "Edit Claim" : "New Claim"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingId
                    ? "Update claim details and status."
                    : "Create a new claim on behalf of a customer."}
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
              {/* Cover */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Cover
                </p>
                <Field label="Select Cover">
                  <SearchableSelect
                    value={form.policyId}
                    onChange={(v) => setForm((p) => ({ ...p, policyId: v }))}
                    placeholder="Select a cover..."
                    searchPlaceholder="Search covers..."
                    options={(policies || []).map((pol: any) => ({
                      value: String(pol.id),
                      label: `#${pol.id} — ${pol.catalogues?.name || "Unknown"} (${pol.profiles?.first_name || ""} ${pol.profiles?.last_name || ""})`.trim(),
                    }))}
                  />
                </Field>
              </div>

              {/* Claim Type */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Claim Information
                </p>
                <div className="space-y-3">
                  <Field label="Claim Type">
                    <SearchableSelect
                      value={form.type}
                      onChange={(v) => setForm((p) => ({ ...p, type: v }))}
                      placeholder="Select type..."
                      searchPlaceholder="Search types..."
                      options={CLAIM_TYPES.map((t) => ({ value: t, label: t }))}
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, description: e.target.value }))
                      }
                      placeholder="Describe what happened..."
                      maxLength={600}
                      rows={4}
                      className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </Field>
                </div>
              </div>

              {/* Incident Details */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Incident Details
                </p>
                <div className="space-y-3">
                  <Field label="Incident Date">
                    <input
                      type="date"
                      value={form.incidentDate}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, incidentDate: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="City">
                      <input
                        type="text"
                        value={form.incidentCity}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            incidentCity: e.target.value,
                          }))
                        }
                        placeholder="Milan"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Country">
                      <SearchableSelect
                        value={form.incidentCountry}
                        onChange={(v) =>
                          setForm((p) => ({ ...p, incidentCountry: v }))
                        }
                        placeholder="Select country..."
                        searchPlaceholder="Search countries..."
                        options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Attached Files (edit/view only) */}
              {editingId && editingMedia.length > 0 && (
                <div className="border-t border-border/50 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Attached Files
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {editingMedia.map((url, idx) => {
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
                            : <FileText className="h-6 w-6 text-muted-foreground" />}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status (edit only) */}
              {editingId && (
                <div className="border-t border-border/50 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Status
                  </p>
                  <Field label="Claim Status">
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, status: e.target.value }))
                      }
                      className={inputCls}
                    >
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                  </Field>
                </div>
              )}
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
                  : "Create Claim"}
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
                Delete claim?
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Claim #{confirmDeleteId} will be permanently deleted and cannot
                be recovered.
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

export default BrandClaims;
