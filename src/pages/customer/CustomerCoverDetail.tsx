import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Shield, Package, Calendar, AlertTriangle, Clock, CheckCircle2, Store } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { Badge } from "@/components/ui/badge";

const statusColors: Record<string, string> = {
  live: "bg-emerald-50 text-emerald-700 border-emerald-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-600 border-gray-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

const claimStatusConfig = {
  open: { icon: Clock, className: "bg-amber-50 text-amber-700" },
  closed: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700" },
} as const;

const fmt = (d: string | null) =>
  d ? format(new Date(d), "MMM dd, yyyy") : "—";

const CustomerCoverDetail = () => {
  const { coverId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();

  const { data: cover, isLoading } = useQuery({
    queryKey: ["customer-cover-detail", coverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, start_date, expiration_date, status, selling_price, recommended_retail_price, created_at,
          catalogues!insured_items_item_id_fkey ( id, name, picture, category, collection, sku ),
          brands!policies_brand_id_fkey ( name, logo_small ),
          shops!insured_items_shop_id_fkey ( name, city, country ),
          claims ( id, type, status, created_at )
        `)
        .eq("id", Number(coverId))
        .eq("customer_id", profile!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!coverId && !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 h-8 w-32 rounded-lg bg-secondary/60 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-card p-6 space-y-3">
            <div className="h-5 w-40 rounded bg-secondary/60 animate-pulse" />
            <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-secondary/40 animate-pulse" />
          </div>
          <div className="glass-card p-6 space-y-3">
            <div className="h-5 w-28 rounded bg-secondary/60 animate-pulse" />
            <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!cover) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">Cover not found.</p>
          <button type="button" onClick={() => navigate(`${slugPrefix}/covers`)} className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Back to covers
          </button>
        </div>
      </div>
    );
  }

  const catalogue = (cover as any).catalogues;
  const brand = (cover as any).brands;
  const shop = (cover as any).shops;
  const claims = (cover as any).claims || [];
  const status = (cover.status || "live").toLowerCase();
  const statusCls = statusColors[status] || "bg-gray-100 text-gray-600 border-gray-200";
  const productName = catalogue?.name || "Unknown Product";
  const brandName = brand?.name || "";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/covers`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to My Covers
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {catalogue?.picture && (
              <div className="h-20 w-20 shrink-0 rounded-xl bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-2">
                <img src={catalogue.picture} alt={productName} className="h-full w-full object-contain mix-blend-multiply" />
              </div>
            )}
            <div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{productName}</h1>
              {brandName && <p className="mt-0.5 text-sm text-muted-foreground">{brandName}</p>}
            </div>
          </div>
          <Badge className={`self-start border ${statusCls}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Cover details */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="glass-card p-6">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                <Shield className="h-4 w-4 text-primary" /> Cover Details
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Start Date</p>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {fmt(cover.start_date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expiration Date</p>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {fmt(cover.expiration_date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Selling Price</p>
                  <p className="font-medium text-foreground">€{(cover.selling_price || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cover ID</p>
                  <p className="font-medium text-foreground">#{cover.id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Store</p>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-muted-foreground" />
                    {shop?.name ? `${shop.name}${shop.city ? `, ${shop.city}` : ""}` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Claims */}
          {claims.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div className="glass-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h2 className="text-base font-semibold text-foreground">Claims ({claims.length})</h2>
                </div>
                <div className="divide-y divide-border">
                  {claims.map((claim: any) => {
                    const st = claim.status === "closed" ? "closed" : "open";
                    const cfg = claimStatusConfig[st];
                    return (
                      <Link
                        key={claim.id}
                        to={`${slugPrefix}/claims/${claim.id}/view`}
                        className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-secondary/30"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Claim #{claim.id} — {claim.type || "General"}
                          </p>
                          <p className="text-xs text-muted-foreground">{fmt(claim.created_at)}</p>
                        </div>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
                          <cfg.icon className="h-3 w-3" />
                          {st.charAt(0).toUpperCase() + st.slice(1)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="glass-card p-6">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                <Package className="h-4 w-4" /> Product Details
              </h3>
              <div className="space-y-2.5 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-medium text-foreground">{productName}</p>
                </div>
                {catalogue?.category && (
                  <div>
                    <p className="text-xs text-muted-foreground">Category</p>
                    <p className="font-medium text-foreground">{catalogue.category.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</p>
                  </div>
                )}
                {catalogue?.collection && (
                  <div>
                    <p className="text-xs text-muted-foreground">Collection</p>
                    <p className="font-medium text-foreground">{catalogue.collection}</p>
                  </div>
                )}
                {catalogue?.sku && (
                  <div>
                    <p className="text-xs text-muted-foreground">SKU</p>
                    <p className="font-medium text-foreground font-mono text-xs tracking-wide">{catalogue.sku}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {shop?.name && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <div className="glass-card p-6">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                  <Store className="h-4 w-4" /> Store
                </h3>
                <div className="space-y-2.5 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="font-medium text-foreground">{shop.name}</p>
                  </div>
                  {(shop.city || shop.country) && (
                    <div>
                      <p className="text-xs text-muted-foreground">Location</p>
                      <p className="font-medium text-foreground">{[shop.city, shop.country].filter(Boolean).join(", ")}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div className="glass-card p-6">
              <p className="text-xs text-muted-foreground">Registered on</p>
              <p className="text-sm font-medium text-foreground mt-1">
                {cover.created_at ? new Date(cover.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default CustomerCoverDetail;
