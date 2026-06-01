import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, ArrowUpRight, Calendar } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

type ExpiringCover = {
  id: number;
  start_date: string | null;
  expiration_date: string | null;
  selling_price: number | null;
  customer_id: string | null;
  catalogues: { name: string | null; picture: string | null } | null;
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const daysBetween = (iso: string | null) => {
  if (!iso) return Infinity;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};

// Three buckets that match how a clienteling team actually thinks about
// renewals: this week (act now), this fortnight (queue calls), this month
// (line up email touches).
const BUCKETS = [
  { key: "wk", labelKey: "brandRenewals.bucket.wk", maxDays: 7, tone: "border-rose-500/30 bg-rose-500/5" },
  { key: "2w", labelKey: "brandRenewals.bucket.2w", maxDays: 14, tone: "border-amber-500/30 bg-amber-500/5" },
  { key: "mo", labelKey: "brandRenewals.bucket.mo", maxDays: 30, tone: "border-border bg-card" },
] as const;

const BrandRenewals = () => {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const slugPrefix = useAuthSlug();

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const horizonIso = useMemo(
    () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    [],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["brand-renewals", profile?.brand_id, todayIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, start_date, expiration_date, selling_price, customer_id,
          catalogues!insured_items_item_id_fkey(name, picture),
          profiles!insured_items_customer_id_fkey(first_name, last_name, email)
        `)
        .eq("brand_id", profile!.brand_id)
        .eq("status", "live")
        .gte("expiration_date", todayIso)
        .lte("expiration_date", horizonIso)
        .order("expiration_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ExpiringCover[];
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  const buckets = useMemo(() => {
    const out: Record<string, ExpiringCover[]> = { wk: [], "2w": [], mo: [] };
    let prevMax = 0;
    BUCKETS.forEach((b) => {
      (data ?? []).forEach((c) => {
        const days = daysBetween(c.expiration_date);
        if (days > prevMax && days <= b.maxDays) out[b.key].push(c);
      });
      prevMax = b.maxDays;
    });
    return out;
  }, [data]);

  const totalAtRisk = useMemo(
    () => (data ?? []).reduce((s, c) => s + (Number(c.selling_price) || 0), 0),
    [data],
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{t("brandRenewals.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("brandRenewals.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label={t("brandRenewals.kpi.totalAtRisk")} value={fmtEur(totalAtRisk)} />
        <Kpi label={t("brandRenewals.kpi.sevenDays")} value={(buckets.wk.length || 0).toLocaleString()} tone="warn" />
        <Kpi label={t("brandRenewals.kpi.twoWeeks")} value={(buckets["2w"].length || 0).toLocaleString()} />
        <Kpi label={t("brandRenewals.kpi.month")} value={(buckets.mo.length || 0).toLocaleString()} />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card p-6 h-32 animate-pulse" />
          ))}
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Calendar className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {t("brandRenewals.empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKETS.map((b) => (
            <RenewalBucket
              key={b.key}
              label={t(b.labelKey)}
              subtotalLabel={t("brandRenewals.atRisk")}
              tone={b.tone}
              items={buckets[b.key]}
              slugPrefix={slugPrefix}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const RenewalBucket = ({
  label,
  subtotalLabel,
  tone,
  items,
  slugPrefix,
}: {
  label: string;
  subtotalLabel: string;
  tone: string;
  items: ExpiringCover[];
  slugPrefix: string;
}) => {
  if (items.length === 0) return null;
  const subtotal = items.reduce((s, c) => s + (Number(c.selling_price) || 0), 0);
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border ${tone} overflow-hidden`}
    >
      <header className="flex items-center justify-between px-5 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {label} <span className="text-muted-foreground font-normal">· {items.length}</span>
          </h2>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmtEur(subtotal)} {subtotalLabel}
        </span>
      </header>
      <ul className="divide-y divide-border/40 bg-background/40">
        {items.map((c) => {
          const name = `${c.profiles?.first_name ?? ""} ${c.profiles?.last_name ?? ""}`.trim() || c.profiles?.email || "—";
          const days = daysBetween(c.expiration_date);
          return (
            <li key={c.id}>
              <Link
                to={`${slugPrefix}/covers/${c.id}`}
                className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/60"
              >
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white p-1 border border-border/40">
                  {c.catalogues?.picture ? (
                    <img
                      src={c.catalogues.picture}
                      alt={c.catalogues.name ?? ""}
                      className="h-full w-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <Shield className="h-full w-full text-muted-foreground p-1" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {c.catalogues?.name ?? `Cover #${c.id}`}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {name}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-foreground tabular-nums">
                    {fmtEur(Number(c.selling_price) || 0)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(c.expiration_date)}
                    {Number.isFinite(days) && (
                      <> · <span className="font-medium">{days}d</span></>
                    )}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
};

const Kpi = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) => (
  <div className="glass-card p-4">
    <p className={`text-[10px] uppercase tracking-wider ${tone === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
      {label}
    </p>
    <p className="text-lg font-semibold text-foreground tabular-nums mt-1">{value}</p>
  </div>
);

export default BrandRenewals;
