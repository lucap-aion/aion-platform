import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowUpRight, Store, Shield, Users, AlertCircle, Heart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

type ShopAgg = {
  shop_id: number;
  shop_name: string | null;
  shop_city: string | null;
  shop_country: string | null;
  covers_live: number;
  customers_live: number;
  protected_value: number | string;
  open_claims: number;
  total_profiles: number;
  registered_profiles: number;
  fully_profiled: number;
  feedback_count: number;
  avg_satisfaction: number | string | null;
  avg_recommendation: number | string | null;
  avg_peace_of_mind: number | string | null;
};

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const pct = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 100) : 0;

const BrandShops = () => {
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();

  const { data, isLoading } = useQuery({
    queryKey: ["brand-shop-aggregates", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("brand_shop_aggregates", { p_brand_id: profile!.brand_id });
      if (error) throw error;
      return (data ?? []) as ShopAgg[];
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  const shops = (data ?? []).slice().sort((a, b) =>
    Number(b.protected_value) - Number(a.protected_value),
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Shops</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Performance scorecards for each boutique — covers, customers, conversion, CSAT, claims.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-6 h-44 animate-pulse" />
          ))}
        </div>
      ) : shops.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          No shops yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {shops.map((s) => {
            const sat = s.avg_satisfaction != null ? Number(s.avg_satisfaction).toFixed(1) : "—";
            const profilePct = pct(s.fully_profiled, s.registered_profiles);
            return (
              <motion.div
                key={s.shop_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Link
                  to={`${slugPrefix}/shops/${s.shop_id}`}
                  className="glass-card group block p-5 transition-colors hover:border-primary/40"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Store className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-foreground truncate">
                          {s.shop_name || `#${s.shop_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[s.shop_city, s.shop_country].filter(Boolean).join(", ") || "—"}
                        </p>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Metric icon={Shield} label="Live covers" value={s.covers_live.toLocaleString()} />
                    <Metric icon={Users} label="Customers" value={s.customers_live.toLocaleString()} />
                    <Metric label="Protected" value={fmtEur(Number(s.protected_value) || 0)} />
                    <Metric icon={AlertCircle} label="Open claims" value={s.open_claims.toLocaleString()} tone={s.open_claims > 0 ? "warn" : undefined} />
                    <Metric label="Profiled" value={`${profilePct}%`} sub={`${s.fully_profiled}/${s.registered_profiles}`} />
                    <Metric icon={Heart} label="Satisfaction" value={sat} sub={`${s.feedback_count} reviews`} />
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Metric = ({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: any;
  tone?: "warn";
}) => (
  <div>
    <p className={`text-[11px] uppercase tracking-wider ${tone === "warn" ? "text-amber-600" : "text-muted-foreground"} flex items-center gap-1`}>
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </p>
    <p className="text-base font-semibold text-foreground tabular-nums mt-0.5">{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
  </div>
);

export default BrandShops;
