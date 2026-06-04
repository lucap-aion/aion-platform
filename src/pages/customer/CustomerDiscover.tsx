// Customer Discover — browse the brand's catalogue, favourite pieces into a
// personal wishlist. The brand sees aggregated demand (planned), the
// customer gets a place to mark "I want this" without having to file a
// request via the boutique. Filters: All vs My wishlist + category chips
// + free-text search.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Heart, Search, Sparkles, Package, Filter, Check, X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { stampImpersonation } from "@/integrations/supabase/impersonation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";

type Catalogue = {
  id: number;
  name: string | null;
  picture: string | null;
  category: string | null;
  collection: string | null;
  sku: string | null;
};

type WishlistRow = { id: number; catalogue_id: number };

const PAGE_SIZE = 24;

const CustomerDiscover = () => {
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<"all" | "wishlist">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // The brand's full catalogue (RLS already scopes to caller's brand_id).
  const { data: items, isLoading } = useQuery({
    queryKey: ["customer-discover-catalogue", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogues")
        .select("id, name, picture, category, collection, sku")
        .eq("brand_id", profile!.brand_id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Catalogue[];
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  // Wishlist rows for the current customer.
  const { data: wishlist } = useQuery({
    queryKey: ["customer-wishlist", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wishlist_items")
        .select("id, catalogue_id")
        .eq("customer_id", profile!.id);
      if (error) throw error;
      return (data ?? []) as WishlistRow[];
    },
    enabled: !!profile?.id,
    staleTime: 60 * 1000,
  });

  const wishlistSet = useMemo(
    () => new Set((wishlist ?? []).map((r) => r.catalogue_id)),
    [wishlist],
  );

  const addToWishlist = useMutation({
    mutationFn: async (catalogueId: number) => {
      const { error } = await supabase
        .from("wishlist_items")
        .insert(stampImpersonation({ customer_id: profile!.id, catalogue_id: catalogueId }));
      if (error) throw error;
    },
    onMutate: async (catalogueId) => {
      await queryClient.cancelQueries({ queryKey: ["customer-wishlist", profile?.id] });
      const prev = queryClient.getQueryData<WishlistRow[]>(["customer-wishlist", profile?.id]) ?? [];
      queryClient.setQueryData<WishlistRow[]>(["customer-wishlist", profile?.id], [
        ...prev,
        { id: -1, catalogue_id: catalogueId },
      ]);
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["customer-wishlist", profile?.id], ctx.prev);
      toast.error(t("discover.addFailed"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-wishlist", profile?.id] });
    },
  });

  const removeFromWishlist = useMutation({
    mutationFn: async (catalogueId: number) => {
      const { error } = await supabase
        .from("wishlist_items")
        .delete()
        .eq("customer_id", profile!.id)
        .eq("catalogue_id", catalogueId);
      if (error) throw error;
    },
    onMutate: async (catalogueId) => {
      await queryClient.cancelQueries({ queryKey: ["customer-wishlist", profile?.id] });
      const prev = queryClient.getQueryData<WishlistRow[]>(["customer-wishlist", profile?.id]) ?? [];
      queryClient.setQueryData<WishlistRow[]>(
        ["customer-wishlist", profile?.id],
        prev.filter((r) => r.catalogue_id !== catalogueId),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["customer-wishlist", profile?.id], ctx.prev);
      toast.error(t("discover.removeFailed"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-wishlist", profile?.id] });
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    (items ?? []).forEach((i) => {
      const c = (i.category || i.collection || "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (filter === "wishlist") list = list.filter((i) => wishlistSet.has(i.id));
    if (categoryFilter) {
      list = list.filter(
        (i) => (i.category || i.collection || "").trim().toLowerCase() === categoryFilter.toLowerCase(),
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) =>
        (i.name ?? "").toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, filter, categoryFilter, search, wishlistSet]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> {t("discover.title").replace("{brand}", tenant.name)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("discover.subtitle")}</p>
      </div>

      {/* Filters row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("discover.searchPlaceholder")}
            className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="inline-flex rounded-lg border border-input bg-background p-0.5">
          <button
            type="button"
            onClick={() => { setFilter("all"); setPage(0); }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {t("discover.all")} <span className="opacity-60 ml-1">({items?.length ?? 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setFilter("wishlist"); setPage(0); }}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "wishlist" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Heart className="h-3 w-3" /> {t("discover.wishlist")} <span className="opacity-60">({wishlistSet.size})</span>
          </button>
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 1 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mr-1">
            <Filter className="h-3 w-3" /> {t("discover.category")}
          </span>
          <button
            type="button"
            onClick={() => { setCategoryFilter(null); setPage(0); }}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              categoryFilter === null ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {t("discover.allCategories")}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setCategoryFilter(c); setPage(0); }}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                categoryFilter === c ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {prettyCategory(c)}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : pageItems.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Package className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filter === "wishlist" ? t("discover.wishlistEmpty") : t("discover.empty")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {pageItems.map((item) => {
            const liked = wishlistSet.has(item.id);
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="group relative overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="relative aspect-square bg-white">
                  {item.picture ? (
                    <img
                      src={item.picture}
                      alt={item.name ?? ""}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-contain p-3 mix-blend-multiply transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Package className="h-10 w-10 text-muted-foreground/30" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      liked
                        ? removeFromWishlist.mutate(item.id)
                        : addToWishlist.mutate(item.id)
                    }
                    className={`absolute top-2 right-2 rounded-full p-2 backdrop-blur transition-colors ${
                      liked
                        ? "bg-rose-500 text-white"
                        : "bg-white/80 text-muted-foreground hover:text-rose-600"
                    }`}
                    aria-label={liked ? t("discover.removeAria") : t("discover.addAria")}
                    title={liked ? t("discover.remove") : t("discover.add")}
                  >
                    <Heart className={`h-4 w-4 ${liked ? "fill-white" : ""}`} />
                  </button>
                </div>
                <div className="p-3 space-y-1">
                  <p className="text-sm font-medium text-foreground line-clamp-1">{item.name ?? "—"}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    {prettyCategory(item.category || item.collection || "")}{item.sku ? ` · ${item.sku}` : ""}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-30"
          >
            ←
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-30"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
};

const prettyCategory = (raw: string) => {
  if (!raw) return "";
  const v = raw.trim().toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
};

export default CustomerDiscover;
