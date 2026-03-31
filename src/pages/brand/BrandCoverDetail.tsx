import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Shield, User, Package, Store, Calendar, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const statusColors: Record<string, string> = {
  live: "bg-emerald-50 text-emerald-700 border-emerald-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-600 border-gray-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
};

const fmt = (d: string | null) =>
  d ? format(new Date(d), "MMM dd, yyyy") : "—";

const BrandCoverDetail = () => {
  const { coverId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();

  const { data: cover, isLoading } = useQuery({
    queryKey: ["brand-cover-detail", coverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, start_date, expiration_date, status, selling_price, recommended_retail_price, cogs, quantity,
          brand_sale_id, brand_row_id, brand_sub_order_row_code, purchase_receipt, notes, internal_notes, created_at,
          catalogues!insured_items_item_id_fkey ( id, name, picture, category, collection, sku ),
          profiles!insured_items_customer_id_fkey ( id, first_name, last_name, email, phone_number, avatar ),
          shops!insured_items_shop_id_fkey ( id, name, city, country )
        `)
        .eq("id", Number(coverId))
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!coverId,
  });

  const { data: claims } = useQuery({
    queryKey: ["brand-cover-claims", coverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claims")
        .select("id, type, status, created_at")
        .eq("policy_id", Number(coverId))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!coverId,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 h-8 w-32 rounded-lg bg-secondary/60 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-40 rounded bg-secondary/60 animate-pulse" />
                <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
                <div className="h-4 w-3/4 rounded bg-secondary/40 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-28 rounded bg-secondary/60 animate-pulse" />
                <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
              </div>
            ))}
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
          <button
            type="button"
            onClick={() => navigate(`${slugPrefix}/covers`)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to covers
          </button>
        </div>
      </div>
    );
  }

  const customer = (cover as any).profiles;
  const catalogue = (cover as any).catalogues;
  const shop = (cover as any).shops;
  const status = cover.status || "live";
  const statusCls = statusColors[status] || "bg-gray-100 text-gray-600 border-gray-200";
  const customerName = customer ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email : "Unknown";
  const initials = customer
    ? `${(customer.first_name?.[0] || customer.email?.[0] || "?").toUpperCase()}${(customer.last_name?.[0] || "").toUpperCase()}`
    : "?";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/covers`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Covers
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {catalogue?.picture && (
              <div className="h-16 w-16 shrink-0 rounded-xl bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-2">
                <img src={catalogue.picture} alt={catalogue.name || ""} className="h-full w-full object-contain mix-blend-multiply" />
              </div>
            )}
            <div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
                {catalogue?.name || "Unknown Product"}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{customerName}</p>
            </div>
          </div>
          <span className={`self-start shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${statusCls}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
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
                  <p className="text-xs text-muted-foreground">RRP</p>
                  <p className="font-medium text-foreground">€{(cover.recommended_retail_price || 0).toLocaleString()}</p>
                </div>
                {cover.quantity != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Quantity</p>
                    <p className="font-medium text-foreground">{cover.quantity}</p>
                  </div>
                )}
                {cover.cogs != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">COGS</p>
                    <p className="font-medium text-foreground">€{cover.cogs.toLocaleString()}</p>
                  </div>
                )}
              </div>
              {cover.brand_sale_id && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Brand References</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Sale ID</p>
                      <p className="font-medium text-foreground font-mono text-xs">{cover.brand_sale_id}</p>
                    </div>
                    {cover.brand_row_id && (
                      <div>
                        <p className="text-xs text-muted-foreground">Row ID</p>
                        <p className="font-medium text-foreground font-mono text-xs">{cover.brand_row_id}</p>
                      </div>
                    )}
                    {cover.brand_sub_order_row_code && (
                      <div>
                        <p className="text-xs text-muted-foreground">Sub Order Row Code</p>
                        <p className="font-medium text-foreground font-mono text-xs">{cover.brand_sub_order_row_code}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(cover.notes || cover.internal_notes) && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                  {cover.notes && (
                    <div>
                      <p className="text-xs text-muted-foreground">Notes</p>
                      <p className="text-sm text-foreground">{cover.notes}</p>
                    </div>
                  )}
                  {cover.internal_notes && (
                    <div>
                      <p className="text-xs text-muted-foreground">Internal Notes</p>
                      <p className="text-sm text-foreground">{cover.internal_notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>

          {/* Claims */}
          {claims && claims.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div className="glass-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50">
                  <h2 className="text-base font-semibold text-foreground">Related Claims ({claims.length})</h2>
                </div>
                <div className="divide-y divide-border">
                  {claims.map((claim: any) => {
                    const st = claim.status === "closed" ? "closed" : "open";
                    return (
                      <Link
                        key={claim.id}
                        to={`${slugPrefix}/claims/${claim.id}`}
                        className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-secondary/30"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Claim #{claim.id} — {claim.type || "General"}
                          </p>
                          <p className="text-xs text-muted-foreground">{fmt(claim.created_at)}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st === "open" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
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
          {/* Customer card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="glass-card p-6">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                <User className="h-4 w-4" /> Customer
              </h3>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary shrink-0 overflow-hidden">
                  {customer?.avatar
                    ? <img src={customer.avatar} alt="" className="h-full w-full object-cover" />
                    : initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{customerName}</p>
                  <p className="text-xs text-muted-foreground break-all">{customer?.email || "—"}</p>
                </div>
              </div>
              {customer?.phone_number && (
                <p className="text-xs text-muted-foreground">Phone: <span className="text-foreground">{customer.phone_number}</span></p>
              )}
            </div>
          </motion.div>

          {/* Product card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="glass-card p-6">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                <Package className="h-4 w-4" /> Product
              </h3>
              <div className="space-y-2.5 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-medium text-foreground">{catalogue?.name || "—"}</p>
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

          {/* Store card */}
          {shop && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="glass-card p-6">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                  <Store className="h-4 w-4" /> Store
                </h3>
                <div className="space-y-2.5 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="font-medium text-foreground">{shop.name || "—"}</p>
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
        </div>
      </div>
    </div>
  );
};

export default BrandCoverDetail;
