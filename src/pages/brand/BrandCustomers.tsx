import { motion } from "framer-motion";
import { Search, ChevronDown, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight, ArrowUpDown, Crown, Clock, AlertTriangle, Heart } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { toast } from "sonner";
import { parseError } from "@/utils/parseError";

type SortKey = "newest" | "oldest" | "name" | "ltv";
type SegmentKey = "all" | "vip" | "lapsed" | "incomplete" | "highNpsIdle";

type SegmentRow = {
  customer_id: string;
  ltv: number | string | null;
  protected_value: number | string | null;
  covers_live: number | null;
  last_purchase_at: string | null;
  latest_satisfaction: number | null;
  is_vip: boolean;
  is_lapsed: boolean;
  is_incomplete: boolean;
  is_high_nps_idle: boolean;
};

const SEGMENTS: { key: SegmentKey; labelKey: string; icon: any; flag?: keyof SegmentRow }[] = [
  { key: "all", labelKey: "brandCustomers.segment.all", icon: null as any },
  { key: "vip", labelKey: "brandCustomers.segment.vip", icon: Crown, flag: "is_vip" },
  { key: "lapsed", labelKey: "brandCustomers.segment.lapsed", icon: Clock, flag: "is_lapsed" },
  { key: "incomplete", labelKey: "brandCustomers.segment.incomplete", icon: AlertTriangle, flag: "is_incomplete" },
  { key: "highNpsIdle", labelKey: "brandCustomers.segment.highNpsIdle", icon: Heart, flag: "is_high_nps_idle" },
];

type CustomerForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postcode: string;
};

const EMPTY_FORM: CustomerForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  country: "",
  postcode: "",
};

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

const inputCls =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const PAGE_SIZE = 25;

const SegmentBadges = ({ seg }: { seg: SegmentRow | null }) => {
  const { t } = useLanguage();
  if (!seg) return null;
  const items: { key: string; label: string; cls: string; Icon: any }[] = [];
  if (seg.is_vip)
    items.push({ key: "vip", label: t("brandCustomers.badge.vip"), cls: "bg-amber-500/10 text-amber-700 border-amber-500/30", Icon: Crown });
  if (seg.is_lapsed)
    items.push({ key: "lapsed", label: t("brandCustomers.badge.lapsed"), cls: "bg-slate-500/10 text-slate-700 border-slate-500/30", Icon: Clock });
  if (seg.is_incomplete)
    items.push({ key: "incomplete", label: t("brandCustomers.badge.incomplete"), cls: "bg-rose-500/10 text-rose-700 border-rose-500/30", Icon: AlertTriangle });
  if (seg.is_high_nps_idle)
    items.push({ key: "nps", label: t("brandCustomers.badge.happyIdle"), cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30", Icon: Heart });
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(({ key, label, cls, Icon }) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
          title={label}
        >
          <Icon className="h-2.5 w-2.5" />
          {label}
        </span>
      ))}
    </div>
  );
};

const BrandCustomers = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const { profile, canWrite } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const slugPrefix = useAuthSlug();
  const navigate = useNavigate();

  // Debounce search → reset page and trigger server refetch
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when segment or sort changes
  useEffect(() => { setPage(0); }, [segment, sortBy]);

  // Segments are fetched once per brand and shared by both the listing query
  // and the segment-filter logic. Cached separately so the filter chips, LTV,
  // and badges all reuse the same payload without re-fetching.
  const { data: segmentsData } = useQuery({
    queryKey: ["brand-customer-segments", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("brand_customer_segments", { p_brand_id: profile!.brand_id });
      if (error) throw error;
      const map = new Map<string, SegmentRow>();
      for (const row of (data ?? []) as SegmentRow[]) {
        map.set(row.customer_id, row);
      }
      return { rows: (data ?? []) as SegmentRow[], byId: map };
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  const segmentCounts: Record<SegmentKey, number> = {
    all: segmentsData?.rows.length ?? 0,
    vip: segmentsData?.rows.filter((r) => r.is_vip).length ?? 0,
    lapsed: segmentsData?.rows.filter((r) => r.is_lapsed).length ?? 0,
    incomplete: segmentsData?.rows.filter((r) => r.is_incomplete).length ?? 0,
    highNpsIdle: segmentsData?.rows.filter((r) => r.is_high_nps_idle).length ?? 0,
  };

  const sortMap: Record<SortKey, { col: string; asc: boolean } | null> = {
    newest: { col: "created_at", asc: false },
    oldest: { col: "created_at", asc: true },
    name: { col: "first_name", asc: true },
    ltv: null, // sorted client-side via the segments map
  };

  const queryKey = [
    "brand-customers",
    profile?.brand_id,
    page,
    sortBy,
    debouncedSearch,
    segment,
    segmentsData?.rows.length ?? 0,
  ];

  const { data: queryData, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      // Compute the eligible-ID set when a segment filter is active or when
      // sorting by LTV (PostgREST can't order by a derived column). For "all"
      // + non-LTV sorts we keep the original lean pagination path.
      const segmentFlag = SEGMENTS.find((s) => s.key === segment)?.flag;
      const needsIdGate = !!segmentFlag || sortBy === "ltv";

      let eligibleIds: string[] | null = null;
      if (needsIdGate && segmentsData) {
        let rows = segmentsData.rows;
        if (segmentFlag) rows = rows.filter((r) => r[segmentFlag] === true);
        if (sortBy === "ltv") {
          rows = [...rows].sort((a, b) => Number(b.ltv ?? 0) - Number(a.ltv ?? 0));
        }
        eligibleIds = rows.map((r) => r.customer_id);
      }

      const sortCfg = sortMap[sortBy];

      let query = supabase
        .from("profiles")
        .select(
          "id, first_name, last_name, email, phone_number, address, city, country, postcode, created_at, avatar",
          { count: "exact" }
        )
        .eq("role", "customer")
        .eq("brand_id", profile!.brand_id);

      if (debouncedSearch.trim()) {
        const s = `%${debouncedSearch.trim()}%`;
        query = query.or(`first_name.ilike.${s},last_name.ilike.${s},email.ilike.${s}`);
      }

      if (eligibleIds !== null) {
        if (eligibleIds.length === 0) {
          return { customers: [], total: 0 };
        }
        // Slice to the current page BEFORE hitting the network — Supabase
        // .in() has practical limits and we only need this page's rows.
        const pageIds = eligibleIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        query = query.in("id", pageIds);
        if (sortCfg) {
          query = query.order(sortCfg.col, { ascending: sortCfg.asc });
        }
      } else if (sortCfg) {
        query = query
          .order(sortCfg.col, { ascending: sortCfg.asc })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      // The aggregates RPC still drives the Covers/Claims columns — the
      // segments RPC carries LTV but not claim counts.
      const customerIds = (data || []).map((c) => c.id);
      const aggMap = new Map<string, { covers: number; claims: number; value: number }>();

      if (customerIds.length) {
        const { data: aggData, error: aggErr } = await supabase
          .rpc("brand_customer_aggregates", { p_customer_ids: customerIds });
        if (aggErr) throw aggErr;
        for (const row of (aggData ?? []) as Array<{
          customer_id: string;
          covers: number | string | null;
          claims: number | string | null;
          total_value: number | string | null;
        }>) {
          aggMap.set(row.customer_id, {
            covers: Number(row.covers) || 0,
            claims: Number(row.claims) || 0,
            value: Number(row.total_value) || 0,
          });
        }
      }

      let enriched = (data || []).map((c) => {
        const a = aggMap.get(c.id) ?? { covers: 0, claims: 0, value: 0 };
        const seg = segmentsData?.byId.get(c.id);
        return {
          ...c,
          ...a,
          ltv: Number(seg?.ltv ?? 0),
          segments: seg ?? null,
        };
      });

      // Re-apply the segment-derived order when we paginated via .in() — the
      // returned rows arrive in PostgREST default order, not our LTV order.
      if (eligibleIds !== null) {
        const pageIdSet = eligibleIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const pos = new Map(pageIdSet.map((id, i) => [id, i]));
        enriched = enriched
          .filter((c) => pos.has(c.id))
          .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
      }

      const totalRows = eligibleIds !== null
        ? eligibleIds.length
        : count ?? 0;

      return { customers: enriched, total: totalRows };
    },
    enabled: !!profile?.brand_id && (segment === "all" && sortBy !== "ltv" ? true : !!segmentsData),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const customers = queryData?.customers ?? [];
  const total = queryData?.total ?? 0;
  const isLoading = isFetching && !queryData;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const set = (field: keyof CustomerForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (c: any) => {
    setEditingId(c.id);
    setForm({
      firstName: c.first_name || "",
      lastName: c.last_name || "",
      email: c.email || "",
      phone: c.phone_number || "",
      address: c.address || "",
      city: c.city || "",
      country: c.country || "",
      postcode: c.postcode || "",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.brand_id) return;
    if (!editingId && !form.email) {
      toast.error("Please fill in: Email.");
      return;
    }
    setIsSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: form.firstName || null,
          last_name: form.lastName || null,
          phone_number: form.phone || null,
          address: form.address || null,
          city: form.city || null,
          country: form.country || null,
          postcode: form.postcode || null,
        })
        .eq("id", editingId);
      if (error) {
        toast.error(parseError(error));
        setIsSaving(false);
        return;
      }
      toast.success("Customer updated.");
    } else {
      const { error } = await supabase.from("profiles").insert({
        brand_id: profile.brand_id,
        first_name: form.firstName || null,
        last_name: form.lastName || null,
        email: form.email.trim().toLowerCase(),
        phone_number: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        country: form.country || null,
        postcode: form.postcode || null,
        role: "customer",
        status: "pending",
      });
      if (error) {
        toast.error(parseError(error));
        setIsSaving(false);
        return;
      }
      toast.success("Customer added. They can now register with this email.");
    }

    setIsSaving(false);
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["brand-customers", profile?.brand_id] });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) {
      toast.error(parseError(error));
      return;
    }
    setConfirmDeleteId(null);
    toast.success("Customer removed.");
    queryClient.invalidateQueries({ queryKey: ["brand-customers", profile?.brand_id] });
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
            <div className="h-4 w-56 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border">
                  {["Customer", "Covers", "Claims", "Protected Value", "Joined"].map((h) => (
                    <th key={h} className="px-6 py-4 text-left">
                      <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted animate-pulse shrink-0" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                          <div className="h-3 w-44 rounded bg-muted animate-pulse" />
                        </div>
                      </div>
                    </td>
                    {[1, 2, 3, 4].map((j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-3.5 w-12 rounded bg-muted animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
              Customers
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your brand's customer base.
            </p>
          </div>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 shrink-0"
            >
              <Plus className="h-4 w-4" /> Add Customer
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as SortKey); setPage(0); }}
              className="appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="newest">{t("brandCustomers.sort.newest")}</option>
              <option value="oldest">{t("brandCustomers.sort.oldest")}</option>
              <option value="name">{t("brandCustomers.sort.name")}</option>
              <option value="ltv">{t("brandCustomers.sort.ltv")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {/* Segment chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {SEGMENTS.map((s) => {
            const active = segment === s.key;
            const Icon = s.icon;
            const count = segmentCounts[s.key];
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {t(s.labelKey)}
                <span className="tabular-nums text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Customer
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Covers
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Claims
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("brandCustomers.column.ltv")}
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <div className="flex items-center gap-1">
                    Joined
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!customers.length ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-muted-foreground"
                  >
                    No customers found.
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr
                    key={c.id}
                    className="transition-colors hover:bg-muted cursor-pointer"
                    onClick={() => navigate(`${slugPrefix}/customers/${c.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0 overflow-hidden">
                          {c.avatar
                            ? <img src={c.avatar} alt="" className="h-full w-full object-cover" />
                            : <>{c.first_name?.[0] || ""}{c.last_name?.[0] || ""}</>}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-foreground">
                              {c.first_name} {c.last_name}
                            </p>
                            <SegmentBadges seg={c.segments} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {c.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {c.covers}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {c.claims}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground">
                      €{c.ltv.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">
                      {c.created_at
                        ? new Date(c.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {canWrite && (
                          <button
                            onClick={() => openEdit(c)}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canWrite && (
                          <button
                            onClick={() => setConfirmDeleteId(c.id)}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
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
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-sm text-foreground">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border/50">
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {editingId ? "Edit Customer" : "Add Customer"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingId
                    ? "Update contact details and address."
                    : "New customers can register using the email you provide."}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Personal Information */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Personal Information
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First Name">
                      <input
                        type="text"
                        value={form.firstName}
                        onChange={set("firstName")}
                        placeholder="First name"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Last Name">
                      <input
                        type="text"
                        value={form.lastName}
                        onChange={set("lastName")}
                        placeholder="Last name"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Field label="Email" required>
                    <input
                      type="email"
                      value={form.email}
                      onChange={set("email")}
                      placeholder="customer@email.com"
                      disabled={!!editingId}
                      className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={set("phone")}
                      placeholder="+1 555 000 0000"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>

              {/* Address */}
              <div className="border-t border-border/50 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Address
                </p>
                <div className="space-y-3">
                  <Field label="Street Address">
                    <input
                      type="text"
                      value={form.address}
                      onChange={set("address")}
                      placeholder="123 Main St"
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="City">
                      <input
                        type="text"
                        value={form.city}
                        onChange={set("city")}
                        placeholder="Milan"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Postal Code">
                      <input
                        type="text"
                        value={form.postcode}
                        onChange={set("postcode")}
                        placeholder="20100"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Field label="Country">
                    <input
                      type="text"
                      value={form.country}
                      onChange={set("country")}
                      placeholder="Italy"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border/50">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
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
                  : "Add Customer"}
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
                Remove customer?
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                This will permanently remove the customer and all their data
                from your brand.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="rounded-lg bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                Remove
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BrandCustomers;
