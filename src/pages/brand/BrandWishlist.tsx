// BrandWishlist — aggregated view of what the brand's customers have
// favourited on /discover. RLS already lets brand-role users read
// wishlist_items for catalogue items they own, so a single grouped query
// returns "demand per SKU". Clickable into a per-item drawer showing who
// wishlisted (with mailto link straight to outreach).

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Heart, Search, Package, Users, Mail, X, Wand2, Loader2, Sparkles, Save, Copy } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const flattenFaq = (source: unknown): string => {
  if (!Array.isArray(source)) return "";
  return (source as any[])
    .map((item) => {
      const q = (item?.title ?? item?.question ?? "").toString().trim();
      const a = item?.content?.blocks
        ? (item.content.blocks as any[]).filter((b: any) => b?.text).map((b: any) => String(b.text)).join(" ").trim()
        : (item?.answer ?? "").toString().trim();
      if (!q && !a) return "";
      return `Q: ${q}\nA: ${a}`;
    })
    .filter(Boolean)
    .join("\n\n");
};

type Draft = { subject: string; body: string; suggested_followup_days?: number };

type WishlistDemand = {
  catalogue_id: number;
  count: number;
  catalogues: {
    id: number;
    name: string | null;
    picture: string | null;
    category: string | null;
    collection: string | null;
    sku: string | null;
  } | null;
};

type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  created_at: string;
};

const BrandWishlist = () => {
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Draft state for the "Notify wishlisters" flow.
  const [notifyDraft, setNotifyDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Reset notify state whenever the drawer changes.
  const closeDrawer = () => {
    setSelectedId(null);
    setNotifyDraft(null);
    setDraftError(null);
  };

  // Aggregate wishlist demand for the brand's catalogue. We rely on the
  // brand-select RLS policy on wishlist_items to scope rows to the caller's
  // brand_id automatically. PostgREST doesn't aggregate directly, so we pull
  // rows and group client-side. Catalogue counts are small enough (typically
  // <1k) that this is fine.
  const { data: demand, isLoading } = useQuery({
    queryKey: ["brand-wishlist-demand", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wishlist_items")
        .select(`
          catalogue_id,
          catalogues!inner ( id, name, picture, category, collection, sku, brand_id )
        `)
        .eq("catalogues.brand_id", profile!.brand_id);
      if (error) throw error;
      const m = new Map<number, WishlistDemand>();
      for (const row of (data ?? []) as any[]) {
        const id = row.catalogue_id as number;
        const cur = m.get(id);
        if (cur) {
          cur.count += 1;
        } else {
          m.set(id, { catalogue_id: id, count: 1, catalogues: row.catalogues });
        }
      }
      return Array.from(m.values()).sort((a, b) => b.count - a.count);
    },
    enabled: !!profile?.brand_id,
    staleTime: 60 * 1000,
  });

  // When a row is selected, fetch the customers who wishlisted it.
  const { data: customers } = useQuery({
    queryKey: ["brand-wishlist-customers", profile?.brand_id, selectedId],
    queryFn: async () => {
      if (selectedId == null) return [] as CustomerRow[];
      const { data, error } = await supabase
        .from("wishlist_items")
        .select(`
          created_at,
          profiles!wishlist_items_customer_id_fkey ( id, first_name, last_name, email )
        `)
        .eq("catalogue_id", selectedId);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.profiles?.id,
        first_name: r.profiles?.first_name,
        last_name: r.profiles?.last_name,
        email: r.profiles?.email,
        created_at: r.created_at,
      })) as CustomerRow[];
    },
    enabled: selectedId != null,
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!demand) return [];
    if (!search.trim()) return demand;
    const q = search.trim().toLowerCase();
    return demand.filter((d) =>
      (d.catalogues?.name ?? "").toLowerCase().includes(q) ||
      (d.catalogues?.sku ?? "").toLowerCase().includes(q) ||
      (d.catalogues?.category ?? "").toLowerCase().includes(q),
    );
  }, [demand, search]);

  const selected = useMemo(
    () => (demand ?? []).find((d) => d.catalogue_id === selectedId) ?? null,
    [demand, selectedId],
  );

  const totalWishes = (demand ?? []).reduce((s, d) => s + d.count, 0);

  const generateNotifyDraft = async () => {
    if (!selected) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const brandFaq = flattenFaq(locale === "it" ? tenant.faqIt : tenant.faqEn);
      const piece = selected.catalogues?.name ?? `#${selected.catalogue_id}`;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/customer-outreach-draft`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bulk: true,
          intent: "wishlist_match",
          locale,
          brand_faq: brandFaq,
          segment_label: t("brandWishlist.wishlistedSegment"),
          recipient_count: selected.count,
          wishlist_piece: piece,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setNotifyDraft(body as Draft);
    } catch (e: any) {
      setDraftError(e?.message ?? t("brandWishlist.notifyFailed"));
    } finally {
      setDrafting(false);
    }
  };

  const saveAsCampaign = async () => {
    if (!notifyDraft || !selected || !profile?.brand_id) return;
    setSaving(true);
    const recipientIds = (customers ?? []).map((c) => c.id).filter(Boolean) as string[];
    const { error } = await supabase
      .from("brand_campaigns")
      .insert({
        brand_id: profile.brand_id,
        segment_key: `wishlist:${selected.catalogue_id}`,
        intent: "wishlist_match",
        subject: notifyDraft.subject,
        body: notifyDraft.body,
        recipient_count: recipientIds.length,
        recipient_ids: recipientIds as any,
        created_by: profile.id,
      });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("brandWishlist.notifySaved"));
    void queryClient.invalidateQueries({ queryKey: ["brand-campaigns-history", profile.brand_id] });
  };

  const copyBcc = async () => {
    const emails = (customers ?? []).map((c) => c.email).filter(Boolean).join(", ");
    if (!emails) {
      toast.error(t("brandWishlist.noEmails"));
      return;
    }
    try {
      await navigator.clipboard.writeText(emails);
      toast.success(t("brandWishlist.bccCopied"));
    } catch {
      toast.error(t("brandWishlist.copyFailed"));
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
          <Heart className="h-6 w-6 text-rose-500" /> {t("brandWishlist.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("brandWishlist.subtitle")}</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("brandWishlist.totalWishes")}</p>
          <p className="text-lg font-semibold text-foreground tabular-nums mt-1">{totalWishes.toLocaleString()}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("brandWishlist.itemsWished")}</p>
          <p className="text-lg font-semibold text-foreground tabular-nums mt-1">{demand?.length ?? 0}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("brandWishlist.topItem")}</p>
          <p className="text-sm font-medium text-foreground line-clamp-1 mt-1">
            {demand?.[0]?.catalogues?.name ?? "—"}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("brandWishlist.searchPlaceholder")}
          className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Heatmap list */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card p-4 h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Heart className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("brandWishlist.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((d, idx) => {
            const c = d.catalogues;
            const maxCount = filtered[0]?.count || 1;
            const intensity = Math.max(0.1, d.count / maxCount);
            return (
              <motion.li
                key={d.catalogue_id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.01, 0.3) }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(d.catalogue_id)}
                  className="group w-full glass-card p-3 flex items-center gap-3 text-left transition-colors hover:border-primary/40"
                >
                  <div className="h-12 w-12 shrink-0 rounded-lg bg-white p-1 border border-border/40">
                    {c?.picture ? (
                      <img
                        src={c.picture}
                        alt={c.name ?? ""}
                        className="h-full w-full object-contain mix-blend-multiply"
                      />
                    ) : (
                      <Package className="h-full w-full text-muted-foreground/40 p-2" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {c?.name ?? `#${d.catalogue_id}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {[c?.category, c?.collection, c?.sku].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {/* Intensity bar */}
                  <div className="hidden sm:block h-2 w-32 rounded-full bg-muted overflow-hidden shrink-0">
                    <div
                      className="h-full bg-gradient-to-r from-rose-400 to-rose-600"
                      style={{ width: `${Math.max(8, intensity * 100)}%` }}
                    />
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-semibold text-foreground tabular-nums">{d.count}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("brandWishlist.wished")}
                    </p>
                  </div>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}

      {/* Drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={closeDrawer}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card w-full sm:max-w-md max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white p-1 border border-border/40">
                  {selected.catalogues?.picture ? (
                    <img src={selected.catalogues.picture} alt="" className="h-full w-full object-contain mix-blend-multiply" />
                  ) : (
                    <Package className="h-full w-full text-muted-foreground/40 p-2" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {selected.catalogues?.name ?? `#${selected.catalogue_id}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {selected.count} {t("brandWishlist.wished")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Notify CTA */}
              <button
                type="button"
                onClick={() => void generateNotifyDraft()}
                disabled={drafting || !customers || customers.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {drafting
                  ? t("brandWishlist.drafting")
                  : notifyDraft
                    ? t("brandWishlist.regenerate")
                    : t("brandWishlist.notifyButton")}
              </button>
              {draftError && <p className="text-xs text-destructive">{draftError}</p>}

              {notifyDraft && (
                <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" /> {t("brandWishlist.draftReady")}
                  </p>
                  <input
                    type="text"
                    value={notifyDraft.subject}
                    onChange={(e) => setNotifyDraft({ ...notifyDraft, subject: e.target.value })}
                    placeholder={t("brandCustomer.subject")}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <textarea
                    value={notifyDraft.body}
                    onChange={(e) => setNotifyDraft({ ...notifyDraft, body: e.target.value })}
                    rows={8}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  />
                  <p className="text-[10px] text-muted-foreground/70">{t("brandWishlist.placeholderHint")}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
                    <button
                      type="button"
                      onClick={() => void copyBcc()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                    >
                      <Copy className="h-3 w-3" /> {t("brandWishlist.copyBcc")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveAsCampaign()}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      {t("brandWishlist.saveAsCampaign")}
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3 w-3" /> {t("brandWishlist.whoWished")}
              </p>
              {!customers || customers.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">{t("brandWishlist.loading")}</p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {customers.map((c) => {
                    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "—";
                    return (
                      <li key={`${c.id}-${c.created_at}`} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {c.email ?? "—"} · {new Date(c.created_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
                              day: "2-digit", month: "short", year: "numeric",
                            })}
                          </p>
                        </div>
                        {c.email && (
                          <a
                            href={`mailto:${encodeURIComponent(c.email)}`}
                            className="shrink-0 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
                            title={t("brandWishlist.emailCustomer")}
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BrandWishlist;
