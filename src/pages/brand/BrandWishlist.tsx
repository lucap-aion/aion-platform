// BrandWishlist — aggregated view of what the brand's customers have
// favourited on /discover. RLS already lets brand-role users read
// wishlist_items for catalogue items they own, so a single grouped query
// returns "demand per SKU". Clickable into a per-item drawer showing who
// wishlisted (with mailto link straight to outreach).

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Heart, Search, Package, Users, ArrowUpDown, Mail, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

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
  const { t, locale } = useLanguage();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
        .eq("catalogues.brand_id", profile!.brand_id)
        .is("impersonated_by", null);
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
        .eq("catalogue_id", selectedId)
        .is("impersonated_by", null);
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
          onClick={() => setSelectedId(null)}
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
                onClick={() => setSelectedId(null)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
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
