import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Store, Shield, Users, AlertCircle, Heart, MapPin,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const monthLabel = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", {
    month: "short",
    year: "2-digit",
  });
};

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

const BrandShopDetail = () => {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();
  const shopIdNum = shopId ? parseInt(shopId, 10) : NaN;

  // Reuse the brand-wide aggregates query so this view shares cache with the
  // shops list page. React Query will return the cached array if it's fresh.
  const { data: aggs, isLoading: aggLoading } = useQuery({
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

  const shop = useMemo(
    () => (aggs ?? []).find((s) => s.shop_id === shopIdNum) ?? null,
    [aggs, shopIdNum],
  );

  const { data: monthly } = useQuery({
    queryKey: ["brand-shop-monthly", profile?.brand_id, shopIdNum],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select("start_date, selling_price, status")
        .eq("brand_id", profile!.brand_id)
        .eq("shop_id", shopIdNum)
        .gte("start_date", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      if (error) throw error;
      const m = new Map<string, { covers: number; value: number }>();
      (data ?? []).forEach((p) => {
        if (!p.start_date) return;
        const key = String(p.start_date).slice(0, 7);
        const e = m.get(key) ?? { covers: 0, value: 0 };
        if (p.status === "live") {
          e.covers += 1;
          e.value += Number(p.selling_price) || 0;
        }
        m.set(key, e);
      });
      return Array.from(m, ([month, v]) => ({
        month,
        label: monthLabel(month),
        covers: v.covers,
        value: Math.round(v.value),
      })).sort((a, b) => a.month.localeCompare(b.month));
    },
    enabled: !!profile?.brand_id && Number.isFinite(shopIdNum),
    staleTime: 5 * 60 * 1000,
  });

  if (aggLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 h-8 w-32 rounded-lg bg-muted animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="glass-card p-4 h-20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">Shop not found.</p>
          <button
            type="button"
            onClick={() => navigate(`${slugPrefix}/shops`)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to Shops
          </button>
        </div>
      </div>
    );
  }

  const sat = shop.avg_satisfaction != null ? Number(shop.avg_satisfaction).toFixed(1) : "—";
  const rec = shop.avg_recommendation != null ? Number(shop.avg_recommendation).toFixed(1) : "—";
  const pom = shop.avg_peace_of_mind != null ? Number(shop.avg_peace_of_mind).toFixed(1) : "—";
  const profilePct = shop.registered_profiles > 0
    ? Math.round((shop.fully_profiled / shop.registered_profiles) * 100)
    : 0;
  const claimRate = shop.covers_live > 0
    ? Math.round((shop.open_claims / shop.covers_live) * 1000) / 10
    : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link
          to={`${slugPrefix}/shops`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Shops
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary shrink-0">
            <Store className="h-7 w-7" />
          </div>
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
              {shop.shop_name || `Shop #${shop.shop_id}`}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {[shop.shop_city, shop.shop_country].filter(Boolean).join(", ") || "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Live covers" value={shop.covers_live.toLocaleString()} icon={Shield} />
        <Kpi label="Active customers" value={shop.customers_live.toLocaleString()} icon={Users} />
        <Kpi label="Protected value" value={fmtEur(Number(shop.protected_value) || 0)} />
        <Kpi label="Open claims" value={shop.open_claims.toLocaleString()} icon={AlertCircle} tone={shop.open_claims > 0 ? "warn" : undefined} />
        <Kpi label="Registered customers" value={shop.registered_profiles.toLocaleString()} />
        <Kpi label="Fully profiled" value={`${profilePct}%`} sub={`${shop.fully_profiled}/${shop.registered_profiles}`} />
        <Kpi label="Open claim rate" value={`${claimRate}%`} sub="of live covers" />
        <Kpi label="Feedback responses" value={shop.feedback_count.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 glass-card p-5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            New live covers — last 12 months
          </p>
          {!monthly || monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No covers yet for this shop.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: any) => v.toLocaleString()} />
                <Bar dataKey="covers" name="Covers" fill="#B8860B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
            <Heart className="h-3 w-3" /> Customer feedback
          </p>
          <FeedbackRow label="Satisfaction" value={sat} />
          <FeedbackRow label="Recommendation" value={rec} />
          <FeedbackRow label="Peace of mind" value={pom} />
          <p className="mt-4 text-xs text-muted-foreground/70">
            Across {shop.feedback_count} response{shop.feedback_count === 1 ? "" : "s"} (1–5 scale).
          </p>
        </motion.div>
      </div>
    </div>
  );
};

const Kpi = ({
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
  <div className="glass-card p-4">
    <p className={`text-[10px] uppercase tracking-wider flex items-center gap-1 ${tone === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </p>
    <p className="text-lg font-semibold text-foreground tabular-nums mt-1">{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
  </div>
);

const FeedbackRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-base font-semibold text-foreground tabular-nums">{value}</span>
  </div>
);

export default BrandShopDetail;
