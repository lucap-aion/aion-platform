import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, User, Shield, AlertTriangle, Mail, Phone, MapPin } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const statusColors: Record<string, string> = {
  live: "bg-emerald-50 text-emerald-700",
  active: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
  expired: "bg-gray-100 text-gray-600",
  pending: "bg-amber-50 text-amber-700",
  blocked: "bg-red-50 text-red-700",
};

const claimStatusColors: Record<string, string> = {
  open: "bg-amber-50 text-amber-700",
  closed: "bg-emerald-50 text-emerald-700",
};

const fmt = (d: string | null) =>
  d ? format(new Date(d), "MMM dd, yyyy") : "—";

const BrandCustomerDetail = () => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();

  const { data: customer, isLoading } = useQuery({
    queryKey: ["brand-customer-detail", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email, phone_number, address, city, country, postcode, avatar, created_at")
        .eq("id", customerId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!customerId,
  });

  const { data: covers } = useQuery({
    queryKey: ["brand-customer-covers", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, start_date, expiration_date, status, selling_price, recommended_retail_price,
          catalogues!insured_items_item_id_fkey ( name, picture ),
          shops!insured_items_shop_id_fkey ( name )
        `)
        .eq("customer_id", customerId!)
        .eq("brand_id", profile!.brand_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!customerId && !!profile?.brand_id,
  });

  const { data: claims } = useQuery({
    queryKey: ["brand-customer-claims", customerId],
    queryFn: async () => {
      const policyIds = (covers || []).map((c) => c.id);
      if (!policyIds.length) return [];
      const { data, error } = await supabase
        .from("claims")
        .select(`
          id, type, status, created_at,
          policies!claims_policy_id_fkey (
            catalogues!insured_items_item_id_fkey ( name )
          )
        `)
        .in("policy_id", policyIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!covers && covers.length > 0,
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
          <div className="glass-card p-6 space-y-3">
            <div className="h-5 w-28 rounded bg-secondary/60 animate-pulse" />
            <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">Customer not found.</p>
          <button
            type="button"
            onClick={() => navigate(`${slugPrefix}/customers`)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to customers
          </button>
        </div>
      </div>
    );
  }

  const fullName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email || "Unknown";
  const initials = `${(customer.first_name?.[0] || customer.email?.[0] || "?").toUpperCase()}${(customer.last_name?.[0] || "").toUpperCase()}`;
  const totalProtected = (covers || []).reduce((sum, c) => sum + (c.selling_price || 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/customers`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary shrink-0 overflow-hidden">
            {customer.avatar
              ? <img src={customer.avatar} alt="" className="h-full w-full object-cover" />
              : initials}
          </div>
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{fullName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Customer since {customer.created_at ? format(new Date(customer.created_at), "MMMM yyyy") : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Covers */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="glass-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Covers ({covers?.length || 0})</h2>
              </div>
              {!covers?.length ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No covers found.</div>
              ) : (
                <div className="divide-y divide-border">
                  {covers.map((cover) => {
                    const status = cover.status || "live";
                    return (
                      <Link
                        key={cover.id}
                        to={`${slugPrefix}/covers/${cover.id}`}
                        className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/30"
                      >
                        <div className="h-10 w-10 shrink-0 rounded-lg bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-1">
                          <img
                            src={(cover as any).catalogues?.picture || "/placeholder.svg"}
                            alt={(cover as any).catalogues?.name || ""}
                            className="h-full w-full object-contain mix-blend-multiply"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {(cover as any).catalogues?.name || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {fmt(cover.start_date)} — {fmt(cover.expiration_date)}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status] || "bg-gray-100 text-gray-600"}`}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* Claims */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="glass-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-base font-semibold text-foreground">Claims ({claims?.length || 0})</h2>
              </div>
              {!claims?.length ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No claims found.</div>
              ) : (
                <div className="divide-y divide-border">
                  {claims.map((claim: any) => {
                    const st = claim.status === "closed" ? "closed" : "open";
                    return (
                      <Link
                        key={claim.id}
                        to={`${slugPrefix}/claims/${claim.id}`}
                        className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/30"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            Claim #{claim.id} — {claim.type || "General"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {claim.policies?.catalogues?.name || "—"} · {fmt(claim.created_at)}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${claimStatusColors[st]}`}>
                          {st.charAt(0).toUpperCase() + st.slice(1)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> Contact Details
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2.5">
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium text-foreground break-all">{customer.email || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium text-foreground">{customer.phone_number || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p className="font-medium text-foreground">
                      {[customer.address, customer.city, customer.postcode, customer.country].filter(Boolean).join(", ") || "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="glass-card p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Active Covers</p>
                  <p className="text-lg font-semibold text-foreground">{covers?.length || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Claims</p>
                  <p className="text-lg font-semibold text-foreground">{claims?.length || 0}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Total Protected Value</p>
                  <p className="text-lg font-semibold text-foreground">€{totalProtected.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default BrandCustomerDetail;
