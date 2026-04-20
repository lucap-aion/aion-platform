import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, Shield, FileText, TrendingUp } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const toLabel = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

const StatCardSkeleton = () => (
  <div className="glass-card p-6 animate-pulse">
    <div className="flex items-center justify-between mb-3">
      <div className="h-10 w-10 rounded-lg bg-muted" />
    </div>
    <div className="h-7 w-24 rounded bg-muted mb-2" />
    <div className="h-3 w-28 rounded bg-muted" />
  </div>
);

const BrandDashboard = () => {
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();
  const navigate = useNavigate();

  const { data: metrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: ["brand-metrics", profile?.brand_id],
    queryFn: async () => {
      const brandId = profile?.brand_id || -1;
      const [customers, covers, claims, policies] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("brand_id", brandId).or("role.eq.customer,role.is.null"),
        supabase.from("policies").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
        supabase.from("claims").select("id, policies!claims_policy_id_fkey!inner(brand_id)", { count: "exact", head: true }).eq("status", "open").eq("policies.brand_id", brandId),
        supabase.from("policies").select("selling_price").eq("brand_id", brandId),
      ]);

      if (customers.error) throw customers.error;
      if (covers.error) throw covers.error;
      if (claims.error) throw claims.error;
      if (policies.error) throw policies.error;

      const protectedValue = (policies.data || []).reduce(
        (sum: number, p: { selling_price: number | null }) => sum + Number(p.selling_price || 0),
        0
      );

      return {
        customers: customers.count || 0,
        covers: covers.count || 0,
        openClaims: claims.count || 0,
        protectedValue,
      };
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  // Lightweight claims query for dashboard — no count:exact, minimal fields
  const { data: recentClaims = [], isLoading: isLoadingClaims } = useQuery({
    queryKey: ["brand-dashboard-claims", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claims")
        .select(`
          id,
          type,
          status,
          created_at,
          policies!claims_policy_id_fkey!inner (
            brand_id,
            catalogues!insured_items_item_id_fkey ( name ),
            profiles!insured_items_customer_id_fkey ( first_name, last_name )
          )
        `)
        .eq("policies.brand_id", profile?.brand_id || -1)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  const totalValue = useMemo(() => Number(metrics?.protectedValue || 0), [metrics]);

  const stats = [
    { label: "Total Customers", value: String(metrics?.customers ?? 0), icon: Users, to: `${slugPrefix}/customers` },
    { label: "Active Covers", value: String(metrics?.covers ?? 0), icon: Shield, to: `${slugPrefix}/covers` },
    { label: "Open Claims", value: String(metrics?.openClaims ?? 0), icon: FileText, to: `${slugPrefix}/claims` },
    { label: "Protected Value", value: `€${new Intl.NumberFormat("it-IT").format(totalValue)}`, icon: TrendingUp, to: null },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Overview of your brand's protection program.</p>
      </div>

      {/* Stat Cards — shown as soon as metrics load */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 mb-8">
        {isLoadingMetrics
          ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          : stats.map((stat, i) => {
              const Icon = stat.icon;
              const card = (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={`glass-card p-6 ${stat.to ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                  <p className="font-serif text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </motion.div>
              );
              return stat.to ? (
                <Link key={i} to={stat.to} className="contents">
                  {card}
                </Link>
              ) : (
                <div key={i}>{card}</div>
              );
            })}
      </div>

      {/* Recent Claims — independent loading */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card"
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="font-serif text-lg font-semibold text-foreground">Recent Claims</h2>
          <Link to={`${slugPrefix}/claims`} className="text-xs font-medium text-primary hover:underline">View All</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-t border-border">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoadingClaims ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-3 rounded bg-muted w-full max-w-[80px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !recentClaims.length ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No claims found.</td>
                </tr>
              ) : (
                recentClaims.map((claim: any) => {
                  const isOpen = claim.status !== "closed";
                  const statusClass = isOpen ? "bg-blue-100 text-blue-700" : "bg-muted text-gray-600";
                  return (
                    <tr
                      key={claim.id}
                      className="transition-colors hover:bg-muted cursor-pointer"
                      onClick={() => navigate(`${slugPrefix}/claims/${claim.id}`)}
                    >
                      <td className="px-6 py-4 text-sm font-medium text-foreground">{claim.id}</td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        {`${claim.policies?.profiles?.first_name || ""} ${claim.policies?.profiles?.last_name || ""}`.trim() || "Unknown"}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{claim.policies?.catalogues?.name || "—"}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{toLabel(claim.type)}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {claim.created_at ? new Date(claim.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}>
                          {isOpen ? "Open" : "Closed"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
};

export default BrandDashboard;
