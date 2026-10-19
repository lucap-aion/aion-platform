import { useState } from "react";
import ClientAvatar from "@/components/ClientAvatar";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, User, Shield, AlertTriangle, Mail, Phone, MapPin, Sparkles, Mic, CalendarClock, ShoppingBag } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const statusColors: Record<string, string> = {
  live: "bg-emerald-50 text-emerald-700",
  active: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
  expired: "bg-muted text-gray-600",
  pending: "bg-orange-50 text-orange-700",
  blocked: "bg-red-50 text-red-700",
};

const claimStatusColors: Record<string, string> = {
  open: "bg-orange-50 text-orange-700",
  closed: "bg-emerald-50 text-emerald-700",
};

const fmt = (d: string | null) =>
  d ? format(new Date(d), "MMM dd, yyyy") : "—";

const eur = (n: number) => `€${Math.round(n).toLocaleString()}`;

// The day a cover started, on the boutiques' calendar — the same day
// brand_customer_segments counts visits on, so the card and the VIP chip agree.
const romeDay = (d: string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });

type CoverForStats = {
  status: string | null;
  start_date: string | null;
  selling_price: number | null;
  catalogues?: { category?: string | null } | null;
};

// What this client has bought, from the covers AION registered. A cancelled
// cover is a returned piece, not a purchase (as in brand_customer_segments).
const purchaseStats = (covers: CoverForStats[]) => {
  const bought = covers.filter((c) => c.status !== "cancelled");
  const spend = bought.reduce((sum, c) => sum + (c.selling_price || 0), 0);
  const days = new Set(bought.filter((c) => c.start_date).map((c) => romeDay(c.start_date!)));
  const last = bought.reduce<string | null>(
    (max, c) => (c.start_date && (!max || c.start_date > max) ? c.start_date : max), null);
  const byCategory = new Map<string, number>();
  for (const c of bought) {
    const raw = c.catalogues?.category?.trim();
    const cat = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "Other";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }
  const live = covers.filter((c) => (c.status || "live") === "live");
  return {
    purchases: bought.length,
    visits: days.size,
    spend,
    avgTicket: bought.length ? spend / bought.length : 0,
    last,
    categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    liveCount: live.length,
    protectedValue: live.reduce((sum, c) => sum + (c.selling_price || 0), 0),
  };
};

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
          catalogues!insured_items_item_id_fkey ( name, picture, category ),
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

  // The boutique's own memory of this person. Confirmed notes only: a draft is
  // one manager's unreviewed dictation, and a client card is the last place to
  // show something nobody has checked.
  const { data: visits } = useQuery({
    queryKey: ["brand-customer-visits", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_visits" as never)
        .select("id, visited_at, outcome, summary, objection, follow_up, follow_up_due, items")
        .eq("customer_id", customerId!)
        .eq("status", "confirmed")
        .order("visited_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string;
        visited_at: string;
        outcome: string | null;
        summary: string | null;
        objection: string | null;
        follow_up: string | null;
        follow_up_due: string | null;
        items: Array<{ product?: string | null; size?: string | null }> | null;
      }>;
    },
    enabled: !!customerId,
  });

  const { data: crossSell } = useQuery({
    queryKey: ["brand-customer-cross-sell", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("brand_customer_cross_sell", { p_customer_id: customerId! });
      if (error) throw error;
      return (data ?? []) as Array<{
        catalogue_id: number;
        product_name: string | null;
        category: string | null;
        sku: string | null;
        picture: string | null;
        reason: string;
      }>;
    },
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
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
        <div className="mb-8 h-8 w-32 rounded-lg bg-muted animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-40 rounded bg-muted animate-pulse" />
                <div className="h-4 w-full rounded bg-muted animate-pulse" />
                <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
          <div className="glass-card p-6 space-y-3">
            <div className="h-5 w-28 rounded bg-muted animate-pulse" />
            <div className="h-4 w-full rounded bg-muted animate-pulse" />
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
  const stats = purchaseStats((covers || []) as CoverForStats[]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/customers`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="flex items-center gap-4">
          <ClientAvatar
            name={`${customer.first_name || ""} ${customer.last_name || ""}`}
            email={customer.email}
            value={customer.avatar}
            className="h-14 w-14 text-lg"
          />
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
          {/* Visits — what the floor remembers. Deliberately above Covers: a
              purchase is already everywhere in this app, and the visit that did
              not end in one exists nowhere else. */}
          {!!visits?.length && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <div className="glass-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
                  <Mic className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold text-foreground">
                    In the boutique ({visits.length})
                  </h2>
                </div>
                <div className="divide-y divide-border">
                  {visits.map((v) => (
                    <div key={v.id} className="px-6 py-4">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{fmt(v.visited_at)}</span>
                        {v.outcome === "purchased" && <span className="text-emerald-600">· bought</span>}
                        {v.outcome === "not_purchased" && <span>· left without buying</span>}
                        {v.outcome === "undecided" && <span className="text-amber-600">· still thinking</span>}
                      </div>
                      {v.summary && (
                        <p className="text-sm leading-relaxed text-foreground">{v.summary}</p>
                      )}
                      {v.objection && (
                        <p className="mt-1 text-xs italic text-muted-foreground">"{v.objection}"</p>
                      )}
                      {(v.items ?? []).length > 0 && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {(v.items ?? [])
                            .map((it) => [it.product, it.size].filter(Boolean).join(" "))
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {v.follow_up && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/80">
                          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                          {v.follow_up}
                          {v.follow_up_due ? ` — ${v.follow_up_due}` : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

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
                        className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted"
                      >
                        <div className="h-10 w-10 shrink-0 rounded-lg bg-white p-1">
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
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status] || "bg-muted text-gray-600"}`}>
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
                <AlertTriangle className="h-4 w-4 text-orange-500" />
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
                        className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted"
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
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-1">
                <ShoppingBag className="h-4 w-4" /> Purchases
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Pieces registered with AION; returned pieces excluded.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Pieces bought</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{stats.purchases}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Visits with a purchase</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{stats.visits}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Average ticket</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {stats.purchases ? eur(stats.avgTicket) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total spend</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{eur(stats.spend)}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Last purchase</p>
                  <p className="text-sm font-semibold text-foreground">{fmt(stats.last)}</p>
                </div>
                {stats.categories.length > 0 && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1.5">Categories</p>
                    <div className="flex flex-wrap gap-1.5">
                      {stats.categories.map(([cat, n]) => (
                        <span key={cat} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-foreground">
                          {cat}
                          <span className="tabular-nums text-muted-foreground">{n}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/50 pt-4">
                <div>
                  <p className="text-xs text-muted-foreground">Live covers</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{stats.liveCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Claims</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{claims?.length || 0}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Protected value (live covers)</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{eur(stats.protectedValue)}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {crossSell && crossSell.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="glass-card p-6">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-1">
                  <Sparkles className="h-4 w-4 text-primary" /> Cross-sell suggestions
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Picked from your catalogue based on this customer's past purchases.
                </p>
                <ul className="space-y-2.5">
                  {crossSell.map((item) => (
                    <li
                      key={item.catalogue_id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-2.5"
                    >
                      <div className="h-10 w-10 shrink-0 rounded-md bg-white p-1">
                        {item.picture ? (
                          <img
                            src={item.picture}
                            alt={item.product_name ?? ""}
                            className="h-full w-full object-contain mix-blend-multiply"
                          />
                        ) : (
                          <div className="h-full w-full rounded-md bg-muted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.product_name ?? `SKU ${item.sku ?? item.catalogue_id}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">
                          {[item.category, item.reason].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BrandCustomerDetail;
