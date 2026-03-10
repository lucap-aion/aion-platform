import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, Shield, FileText, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useBrandClaims } from "@/hooks/use-claims";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const toLabel = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

const BrandDashboard = () => {
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();

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

      const protectedValue = (policies.data || []).reduce((sum: number, policy: { selling_price: number | null }) => sum + Number(policy.selling_price || 0), 0);

      return {
        customers: customers.count || 0,
        covers: covers.count || 0,
        openClaims: claims.count || 0,
        protectedValue,
      };
    },
    enabled: !!profile,
  });

  const { data: recentClaims = [], isLoading: isLoadingClaims } = useBrandClaims(5);
  const isLoading = isLoadingMetrics || isLoadingClaims;

  const totalValue = useMemo(() => {
    return Number(metrics?.protectedValue || 0);
  }, [metrics]);

  const stats = [
    { label: "Total Customers", value: String(metrics?.customers ?? 0), change: "+0%", up: true, icon: Users },
    { label: "Active Covers", value: String(metrics?.covers ?? 0), change: "+0%", up: true, icon: Shield },
    { label: "Open Claims", value: String(metrics?.openClaims ?? 0), change: "+0%", up: false, icon: FileText },
    { label: "Protected Value", value: `€${new Intl.NumberFormat().format(totalValue)}`, change: "+0%", up: true, icon: TrendingUp },
  ];

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 flex items-center justify-center min-h-[280px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Overview of your brand's protection program.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 mb-8">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="glass-card p-6"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${stat.up ? "text-success" : "text-destructive"}`}>
                  {stat.change}
                </span>
              </div>
              <p className="font-serif text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </motion.div>
          );
        })}
      </div>

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
              {!recentClaims.length ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No claims found.</td>
                </tr>
              ) : (
                recentClaims.map((claim: any) => {
                  const key = claim.status === "closed" ? "closed" : "open";
                  const statusClass = key === "closed" ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-700";
                  return (
                    <tr key={claim.id} className="transition-colors hover:bg-secondary/30">
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
                          {key === "closed" ? "Closed" : "Open"}
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
