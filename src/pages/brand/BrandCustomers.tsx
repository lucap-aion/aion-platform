import { motion } from "framer-motion";
import { Search, Filter } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BrandCustomers = () => {
  const [search, setSearch] = useState("");
  const { profile } = useAuth();

  const { data: customers, isLoading } = useQuery({
    queryKey: ["brand-customers", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, created_at, role")
        .eq("role", "customer")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // For each customer, get policy and claim counts
      const enriched = await Promise.all(
        (data || []).map(async (c) => {
          const [policiesRes, claimsRes] = await Promise.all([
            supabase.from("policies").select("id, selling_price", { count: "exact" }).eq("customer_id", c.id),
            supabase.from("claims").select("id", { count: "exact" }).in(
              "policy_id",
              (await supabase.from("policies").select("id").eq("customer_id", c.id)).data?.map((p) => p.id) || []
            ),
          ]);
          const totalValue = policiesRes.data?.reduce((sum, p) => sum + (p.selling_price || 0), 0) || 0;
          return {
            ...c,
            covers: policiesRes.count || 0,
            claims: claimsRes.count || 0,
            value: totalValue,
          };
        })
      );
      return enriched;
    },
    enabled: !!profile,
  });

  const filtered = customers?.filter((c) => {
    const name = `${c.first_name || ""} ${c.last_name || ""} ${c.email}`;
    return name.toLowerCase().includes(search.toLowerCase());
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-6 md:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your brand's customer base.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            <Filter className="h-4 w-4" /> Filter
          </button>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Covers</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Claims</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Protected Value</th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!filtered?.length ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No customers found.</td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="cursor-pointer transition-colors hover:bg-secondary/30">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {(c.first_name?.[0] || "")}{(c.last_name?.[0] || "")}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{c.first_name} {c.last_name}</p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground">{c.covers}</td>
                  <td className="px-6 py-4 text-sm text-foreground">{c.claims}</td>
                  <td className="px-6 py-4 text-sm font-medium text-foreground">€{c.value.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
};

export default BrandCustomers;
