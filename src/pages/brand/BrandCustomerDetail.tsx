import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, User, Shield, AlertTriangle, Mail, Phone, MapPin, Sparkles, Wand2, Copy, X, Loader2, Send } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const flattenFaq = (source: unknown): string => {
  if (!Array.isArray(source)) return "";
  return (source as any[])
    .map((item) => {
      const q = (item?.title ?? item?.question ?? "").toString().trim();
      const a = item?.content?.blocks
        ? (item.content.blocks as any[]).filter((b: any) => b?.text).map((b: any) => String(b.text)).join(" ").trim()
        : (item?.answer ?? "").toString().trim();
      if (!q && !a) return "";
      return `Q: ${q}\nA: ${a}`;
    })
    .filter(Boolean)
    .join("\n\n");
};

type DraftIntent = "cross_sell" | "renewal_nudge" | "win_back" | "check_in";
type Draft = { subject: string; body: string; suggested_followup_days?: number };

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

const BrandCustomerDetail = () => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftIntent, setDraftIntent] = useState<DraftIntent>("cross_sell");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const generateDraft = async (intent: DraftIntent) => {
    if (!customerId) return;
    setDraftLoading(true);
    setDraftError(null);
    setDraft(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const brandFaq = flattenFaq(locale === "it" ? tenant.faqIt : tenant.faqEn);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/customer-outreach-draft`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer_id: customerId,
          intent,
          locale,
          brand_faq: brandFaq,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setDraft(body as Draft);
    } catch (e: any) {
      setDraftError(e?.message ?? "Draft failed");
    } finally {
      setDraftLoading(false);
    }
  };

  const openDraftModal = () => {
    setDraftOpen(true);
    setDraft(null);
    setDraftError(null);
    setDraftIntent("cross_sell");
  };

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
  const initials = `${(customer.first_name?.[0] || customer.email?.[0] || "?").toUpperCase()}${(customer.last_name?.[0] || "").toUpperCase()}`;
  const totalProtected = (covers || []).reduce((sum, c) => sum + (c.selling_price || 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/customers`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
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
          <button
            type="button"
            onClick={openDraftModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Wand2 className="h-4 w-4" />
            {t("brandCustomer.draftOutreach")}
          </button>
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

      {/* Draft outreach modal */}
      {draftOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDraftOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-primary" />
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {t("brandCustomer.draftOutreach")}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Intent picker */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                  {t("brandCustomer.intent")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["cross_sell", "renewal_nudge", "win_back", "check_in"] as DraftIntent[]).map((it) => (
                    <button
                      key={it}
                      type="button"
                      onClick={() => setDraftIntent(it)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        draftIntent === it
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      <p className="font-medium">{t(`brandCustomer.intent.${it}`)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{t(`brandCustomer.intent.${it}.sub`)}</p>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void generateDraft(draftIntent)}
                disabled={draftLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
              >
                {draftLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {draftLoading
                  ? t("brandCustomer.drafting")
                  : draft
                    ? t("brandCustomer.regenerate")
                    : t("brandCustomer.generate")}
              </button>

              {draftError && (
                <p className="text-xs text-destructive">{draftError}</p>
              )}

              {draft && (
                <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                      {t("brandCustomer.subject")}
                    </label>
                    <input
                      type="text"
                      value={draft.subject}
                      onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                      {t("brandCustomer.body")}
                    </label>
                    <textarea
                      value={draft.body}
                      onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      rows={12}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                    />
                  </div>
                  {draft.suggested_followup_days != null && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("brandCustomer.followup").replace("{n}", String(draft.suggested_followup_days))}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
                          toast.success(t("brandCustomer.copied"));
                        } catch {
                          toast.error(t("brandCustomer.copyFailed"));
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <Copy className="h-3.5 w-3.5" /> {t("brandCustomer.copy")}
                    </button>
                    {customer.email && (
                      <a
                        href={`mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Send className="h-3.5 w-3.5" /> {t("brandCustomer.openInMail")}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BrandCustomerDetail;
