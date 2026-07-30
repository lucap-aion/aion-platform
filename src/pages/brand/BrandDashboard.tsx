import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, Shield, FileText, TrendingUp, ArrowRight, Clock, UserPlus, AlertCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSlug } from "@/hooks/useAuthSlug";

// The brand's home page: what happened, what needs attention, and who just
// arrived — the things you want on opening the platform. The four headline
// figures stay (they come from the canonical RPC and match Insights), but the
// page is now built around ACTIVITY rather than being a second reporting screen.

const eur = (n: number) => `€${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n)}`;
const toLabel = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
const fullName = (p?: { first_name?: string | null; last_name?: string | null } | null) =>
  `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Unknown";
const daysUntil = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);

const CardSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="glass-card animate-pulse p-6">
    <div className="mb-4 h-4 w-32 rounded bg-muted" />
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="mb-3 h-3 w-full rounded bg-muted" />
    ))}
  </div>
);

const BrandDashboard = () => {
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();
  const navigate = useNavigate();
  const brandId = profile?.brand_id ?? -1;
  const enabled = !!profile?.brand_id;

  const { data: metrics, isLoading: loadingMetrics } = useQuery({
    queryKey: ["brand-metrics", brandId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("brand_dashboard_metrics", { p_brand_id: brandId }).single();
      if (error) throw error;
      const row = data as Record<string, number | string | null> | null;
      return {
        customers: Number(row?.customers ?? 0),
        covers: Number(row?.covers ?? 0),
        openClaims: Number(row?.open_claims ?? 0),
        protectedValue: Number(row?.protected_value ?? 0),
      };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Activity: this month against last, so the headline numbers have a direction.
  const { data: activity, isLoading: loadingActivity } = useQuery({
    queryKey: ["brand-home-activity", brandId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(1);
      since.setMonth(since.getMonth() - 1);
      const { data, error } = await supabase
        .from("policies")
        .select("start_date, selling_price, customer_id")
        .eq("brand_id", brandId)
        .gte("start_date", since.toISOString());
      if (error) throw error;

      const startOfThis = new Date();
      startOfThis.setDate(1);
      startOfThis.setHours(0, 0, 0, 0);

      let thisCount = 0, thisValue = 0, lastCount = 0;
      const clients = new Set<string>();
      for (const r of (data ?? []) as { start_date: string; selling_price: number | null; customer_id: string | null }[]) {
        if (new Date(r.start_date) >= startOfThis) {
          thisCount++; thisValue += Number(r.selling_price ?? 0);
          if (r.customer_id) clients.add(r.customer_id);
        } else lastCount++;
      }
      return { thisCount, thisValue, lastCount, clients: clients.size };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Renewals: the one thing on this page that is genuinely time-sensitive.
  const { data: renewals = [], isLoading: loadingRenewals } = useQuery({
    queryKey: ["brand-home-renewals", brandId],
    queryFn: async () => {
      const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("policies")
        .select("id, expiration_date, selling_price, catalogues!insured_items_item_id_fkey(name), profiles!insured_items_customer_id_fkey(first_name, last_name)")
        .eq("brand_id", brandId)
        .eq("status", "live")
        .lte("expiration_date", in60)
        .gte("expiration_date", new Date().toISOString())
        .order("expiration_date", { ascending: true })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: newCustomers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["brand-home-customers", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, city, country, registered_at")
        .eq("brand_id", brandId)
        .or("role.is.null,role.eq.customer")
        .not("registered_at", "is", null)
        .order("registered_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: recentClaims = [], isLoading: loadingClaims } = useQuery({
    queryKey: ["brand-home-claims", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claims")
        .select(`id, type, status, created_at,
          policies!claims_policy_id_fkey!inner (brand_id,
            catalogues!insured_items_item_id_fkey ( name ),
            profiles!insured_items_customer_id_fkey ( first_name, last_name ))`)
        .eq("policies.brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const totalValue = useMemo(() => Number(metrics?.protectedValue ?? 0), [metrics]);
  const delta = useMemo(() => {
    if (!activity || activity.lastCount === 0) return null;
    return Math.round(((activity.thisCount - activity.lastCount) / activity.lastCount) * 100);
  }, [activity]);

  const greeting = (() => {
    const h = new Date().getHours();
    const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return profile?.first_name ? `${part}, ${profile.first_name}` : part;
  })();

  const stats = [
    { label: "Customers", value: String(metrics?.customers ?? 0), icon: Users, to: `${slugPrefix}/customers` },
    { label: "Active covers", value: String(metrics?.covers ?? 0), icon: Shield, to: `${slugPrefix}/covers` },
    { label: "Open claims", value: String(metrics?.openClaims ?? 0), icon: FileText, to: `${slugPrefix}/claims` },
    { label: "Protected value", value: eur(totalValue), icon: TrendingUp, to: null },
  ];

  return (
    <div className="mx-auto max-w-6xl animate-fade-in px-4 py-6 md:px-6 md:py-8">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-foreground">{greeting}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loadingActivity || !activity
            ? "Here's where your protection programme stands."
            : activity.thisCount > 0
              ? `${activity.thisCount} cover${activity.thisCount === 1 ? "" : "s"} activated this month across ${activity.clients} client${activity.clients === 1 ? "" : "s"}${delta !== null ? ` — ${delta >= 0 ? "+" : ""}${delta}% vs last month` : ""}.`
              : "No covers activated yet this month."}
        </p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4">
        {loadingMetrics
          ? Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} rows={1} />)
          : stats.map((stat, i) => {
              const Icon = stat.icon;
              const card = (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={`glass-card p-6 ${stat.to ? "cursor-pointer transition-colors hover:border-primary/40" : ""}`}
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-serif text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
                </motion.div>
              );
              return stat.to
                ? <Link key={i} to={stat.to} className="contents">{card}</Link>
                : <div key={i}>{card}</div>;
            })}
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        {/* Renewals — the only genuinely time-sensitive thing here, so it leads. */}
        {loadingRenewals ? <CardSkeleton /> : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" /> Expiring soon
              </h2>
              <Link to={`${slugPrefix}/renewals`} className="text-xs font-medium text-primary hover:underline">All renewals</Link>
            </div>
            {!renewals.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing expiring in the next 60 days.</p>
            ) : (
              <ul className="divide-y divide-border">
                {renewals.map((r: any) => {
                  const days = daysUntil(r.expiration_date);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{fullName(r.profiles)}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.catalogues?.name ?? "—"}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${days <= 14 ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
                        {days <= 0 ? "today" : `${days}d`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}

        {/* Who just arrived — the clienteling prompt. */}
        {loadingCustomers ? <CardSkeleton /> : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="glass-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
                <UserPlus className="h-4 w-4 text-primary" /> Newest clients
              </h2>
              <Link to={`${slugPrefix}/customers`} className="text-xs font-medium text-primary hover:underline">All clients</Link>
            </div>
            {!newCustomers.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No clients registered yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {newCustomers.map((c: any) => (
                  <li
                    key={c.id}
                    onClick={() => navigate(`${slugPrefix}/customers/${c.id}`)}
                    className="flex cursor-pointer items-center justify-between gap-3 py-2.5 transition-colors hover:opacity-70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{fullName(c)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.registered_at ? new Date(c.registered_at).toLocaleDateString() : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </div>

      {/* Claims last: important when there are any, noise when there aren't. */}
      {loadingClaims ? <CardSkeleton /> : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
              <AlertCircle className="h-4 w-4 text-primary" /> Recent claims
            </h2>
            <Link to={`${slugPrefix}/claims`} className="text-xs font-medium text-primary hover:underline">View all</Link>
          </div>
          {!recentClaims.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No claims — nothing needs your attention.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentClaims.map((claim: any) => {
                const isOpen = claim.status !== "closed";
                return (
                  <li
                    key={claim.id}
                    onClick={() => navigate(`${slugPrefix}/claims/${claim.id}`)}
                    className="flex cursor-pointer items-center justify-between gap-3 py-3 transition-colors hover:opacity-70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {fullName(claim.policies?.profiles)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{toLabel(claim.type)}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{claim.policies?.catalogues?.name ?? "—"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {claim.created_at ? new Date(claim.created_at).toLocaleDateString() : "—"}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isOpen ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                        {isOpen ? "Open" : "Closed"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to={`${slugPrefix}/assistant`} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Ask the assistant <ArrowRight className="h-4 w-4" />
        </Link>
        <Link to={`${slugPrefix}/insights`} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm">
          See insights
        </Link>
      </div>
    </div>
  );
};

export default BrandDashboard;
