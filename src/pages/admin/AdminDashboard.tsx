import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Shield, Users, FileText, Store, DollarSign, BarChart3,
  Activity, Package, UserCheck, ChevronDown, TrendingUp,
  TrendingDown, Minus, ArrowRight, Percent, Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const GVT_FEE = 0.2225;

const fmt = (n: number) =>
  new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);
const fmtN = (n: number) => new Intl.NumberFormat("en").format(n);

const toPct = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? (v > 1 ? v / 100 : v) : 0;
  const s = String(v).trim();
  const hasPercent = s.includes("%");
  const n = parseFloat(s.replace("%", ""));
  if (!Number.isFinite(n)) return 0;
  return hasPercent || n > 1 ? n / 100 : n;
};

// ISO week helpers
const isoWeeksInYear = (year: number) => {
  const dec31 = new Date(year, 11, 31);
  const dow = dec31.getDay() || 7;
  return dow >= 4 ? 53 : 52;
};

const getWeekRange = (year: number, week: number) => {
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (dow - 1) + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
};

interface Brand { id: number; name: string; slug: string | null; activation_fee: unknown; insurance_premium: unknown; aion_premium_fee: unknown; }

interface Statistics {
  brands: number; customers: number; covers: number; claims: number; openClaims: number;
  closedClaims: number; shops: number; rrpTotal: number; sellingPriceTotal: number;
  cogsTotal: number; grossPremium: number; netPremium: number; aionActivationFee: number;
  aionPremiumFee: number; aionRevenue: number; effectivePremiumPct: number | null;
  effectiveActivationFeePct: number | null; effectiveAionPremiumFeePct: number | null;
  latestActivation: string; claimRate: number | null;
}

const emptyStats = (): Statistics => ({
  brands: 0, customers: 0, covers: 0, claims: 0, openClaims: 0, closedClaims: 0, shops: 0,
  rrpTotal: 0, sellingPriceTotal: 0, cogsTotal: 0, grossPremium: 0, netPremium: 0,
  aionActivationFee: 0, aionPremiumFee: 0, aionRevenue: 0,
  effectivePremiumPct: null, effectiveActivationFeePct: null, effectiveAionPremiumFeePct: null,
  latestActivation: "", claimRate: null,
});

// ─── Sub-components ────────────────────────────────────────────────────────

const MetricCardSkeleton = ({ icon: Icon, label }: { icon: typeof BarChart3; label: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 h-full flex flex-col justify-between">
    <div className="flex items-center justify-between">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
    <div className="mt-3">
      <div className="h-7 w-20 rounded-md bg-muted animate-pulse" />
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  </div>
);

const FinRowSkeleton = ({ label }: { label: string }) => (
  <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
    <p className="text-sm font-medium text-foreground">{label}</p>
    <div className="h-4 w-20 rounded bg-muted animate-pulse" />
  </div>
);

const MetricCard = ({ icon: Icon, label, value, sub, href, accent = false }: {
  icon: typeof BarChart3; label: string; value: string; sub?: string; href?: string; accent?: boolean;
}) => {
  const inner = (
    <div className={`rounded-xl border p-4 h-full flex flex-col justify-between transition-all group
      ${accent ? "border-primary/30 bg-primary/5 hover:border-primary/50" : "border-border bg-card hover:border-primary/30 hover:shadow-sm"}`}>
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent ? "bg-primary/15" : "bg-muted"}`}>
          <Icon className={`h-4 w-4 ${accent ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        {href && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />}
      </div>
      <div className="mt-3">
        <p className={`text-2xl font-bold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link to={href} className="block h-full">{inner}</Link> : inner;
};

const FinRow = ({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) => (
  <div className={`flex items-center justify-between py-3 border-b border-border last:border-0 ${highlight ? "text-primary" : ""}`}>
    <div>
      <p className={`text-sm font-medium ${highlight ? "text-primary" : "text-foreground"}`}>{label}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
    <p className={`text-sm font-bold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
  </div>
);

const RevenueBar = ({ activationFee, premiumFee, total }: { activationFee: number; premiumFee: number; total: number }) => {
  const aPct = total > 0 ? (activationFee / total) * 100 : 50;
  const pPct = total > 0 ? (premiumFee / total) * 100 : 50;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-primary transition-all" style={{ width: `${aPct}%` }} />
        <div className="bg-primary/40 transition-all" style={{ width: `${pPct}%` }} />
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-primary" />Activation Fee ({aPct.toFixed(0)}%)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-primary/40" />Premium Fee ({pPct.toFixed(0)}%)</span>
      </div>
    </div>
  );
};

const selectCls = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-primary/40";

// ─── Main ───────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { adminRecord } = useAuth();

  const [allBrands, setAllBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | "all">("all");
  const [period, setPeriod] = useState<"all" | "week" | "month" | "year">("all");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [customerType, setCustomerType] = useState<"all" | "new" | "returning">("all");
  const [stats, setStats] = useState<Statistics>(emptyStats());
  const [loading, setLoading] = useState(true);

  const computeStats = useCallback(async () => {
    setLoading(true);
    try {
      const result = emptyStats();
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (period === "year") {
        fromDate = new Date(selectedYear, 0, 1).toISOString();
        toDate = new Date(selectedYear, 11, 31, 23, 59, 59, 999).toISOString();
      } else if (period === "month") {
        fromDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString();
        toDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999).toISOString();
      } else if (period === "week") {
        const range = getWeekRange(selectedYear, selectedWeek);
        fromDate = range.from;
        toDate = range.to;
      }

      // Phase 1: brands metadata first so we know verified IDs for downstream filters
      const fetchedBrands: Brand[] = allBrands.length > 0
        ? allBrands
        : await supabase.from("brands").select("id, name, slug, activation_fee, insurance_premium, aion_premium_fee").eq("status", "verified").order("name")
            .then(({ data }) => {
              const b = (data as Brand[]) ?? [];
              setAllBrands(b);
              return b;
            });

      const verifiedBrandIds = fetchedBrands.map((b) => b.id);
      const safeBrandIds = verifiedBrandIds.length > 0 ? verifiedBrandIds : [-1];

      const eligibleCustomerIdsPromise: Promise<string[] | null> =
        customerType !== "all" && fromDate
          ? (async () => {
              let q = supabase.from("profiles").select("id").eq("role", "customer");
              if (selectedBrandId !== "all") q = q.in("brand_id", [selectedBrandId]);
              else q = q.in("brand_id", safeBrandIds);
              if (customerType === "new") {
                q = q.gte("created_at", fromDate!);
                if (toDate) q = q.lte("created_at", toDate);
              } else {
                q = q.lt("created_at", fromDate!);
              }
              const { data } = await q;
              return (data ?? []).map((c: any) => c.id as string);
            })()
          : Promise.resolve<string[] | null>(null);

      // Phase 2: counts + eligible IDs in parallel — verified-brand filter via .in() on brand_id
      const [
        eligibleIds,
        { count: brandsCount },
        { count: shopsCount },
        { count: customersCount },
        { data: claimsRows },
      ] = await Promise.all([
        eligibleCustomerIdsPromise,
        supabase.from("brands").select("id", { count: "exact", head: true }).eq("status", "verified"),
        supabase.from("shops").select("id", { count: "exact", head: true }).in("brand_id", safeBrandIds),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer").in("brand_id", safeBrandIds),
        supabase.from("claims").select("status, policies!claims_policy_id_fkey!inner(brand_id)").in("policies.brand_id", safeBrandIds),
      ]);

      const claimsArr = (claimsRows ?? []) as Array<{ status: string | null }>;
      const claimsCount = claimsArr.length;
      const openClaimsCount = claimsArr.filter((c) => c.status === "open").length;
      const closedClaimsCount = claimsArr.filter((c) => c.status === "closed").length;

      const brandIds = selectedBrandId === "all" ? verifiedBrandIds : [selectedBrandId];
      const brandRates = new Map<number, { activation_fee: number; insurance_premium: number; aion_premium_fee: number }>();
      for (const b of fetchedBrands) {
        if (brandIds.includes(b.id)) brandRates.set(b.id, { activation_fee: toPct(b.activation_fee), insurance_premium: toPct(b.insurance_premium), aion_premium_fee: toPct(b.aion_premium_fee) });
      }

      if (eligibleIds !== null && eligibleIds.length === 0) {
        result.brands = brandsCount ?? 0;
        result.shops = shopsCount ?? 0;
        result.customers = 0;
        setStats(result);
        return;
      }

      // Phase 3: Aggregated policy stats via RPC
      const rpcParams: Record<string, unknown> = {};
      if (brandIds.length > 0) rpcParams.p_brand_ids = brandIds;
      if (fromDate) rpcParams.p_from_date = fromDate;
      if (toDate) rpcParams.p_to_date = toDate;
      if (eligibleIds !== null) rpcParams.p_customer_ids = eligibleIds;

      const { data: policyStats = [] } = await supabase.rpc("dashboard_policy_stats", rpcParams);

      // Aggregate per-brand rows into totals, applying brand-specific rates
      for (const row of policyStats as any[]) {
        const bid = Number(row.brand_id);
        const cogs = Number(row.total_cogs) || 0;
        const rrp = Number(row.total_rrp) || 0;
        const sp = Number(row.total_selling_price) || 0;
        result.covers += Number(row.covers) || 0;
        result.cogsTotal += cogs;
        result.rrpTotal += rrp;
        result.sellingPriceTotal += sp;
        const rates = brandRates.get(bid);
        const grossPremium = cogs * (rates?.insurance_premium ?? 0);
        const netPremium = grossPremium * (1 - GVT_FEE);
        const aionActivationFee = rrp * (rates?.activation_fee ?? 0);
        const aionPremiumFee = netPremium * (rates?.aion_premium_fee ?? 0);
        result.grossPremium += grossPremium;
        result.netPremium += netPremium;
        result.aionActivationFee += aionActivationFee;
        result.aionPremiumFee += aionPremiumFee;
        if (row.latest_start_date) {
          const ts = new Date(row.latest_start_date).getTime();
          if (!result.latestActivation || ts > new Date(result.latestActivation).getTime()) {
            result.latestActivation = row.latest_start_date;
          }
        }
      }
      result.aionRevenue = result.aionPremiumFee + result.aionActivationFee;
      result.effectivePremiumPct = result.cogsTotal > 0 ? result.grossPremium / result.cogsTotal : null;
      result.effectiveActivationFeePct = result.rrpTotal > 0 ? result.aionActivationFee / result.rrpTotal : null;
      result.effectiveAionPremiumFeePct = result.netPremium > 0 ? result.aionPremiumFee / result.netPremium : null;

      result.claims = claimsCount ?? 0;
      result.openClaims = openClaimsCount ?? 0;
      result.closedClaims = closedClaimsCount ?? 0;

      result.brands = brandsCount ?? 0;
      result.customers = eligibleIds !== null ? eligibleIds.length : (customersCount ?? 0);
      result.shops = shopsCount ?? 0;
      result.claimRate = result.covers > 0 ? result.claims / result.covers : null;

      setStats(result);
    } finally { setLoading(false); }
  }, [allBrands, selectedBrandId, period, selectedYear, selectedMonth, selectedWeek, customerType]);

  useEffect(() => { void computeStats(); }, [computeStats]);

  const name = adminRecord?.first_name || "Admin";
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const now = new Date();
  const maxWeeks = isoWeeksInYear(selectedYear);
  const weeks = Array.from({ length: maxWeeks }, (_, i) => i + 1);

  return (
    <div className="p-6 md:p-8 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">Welcome back, {name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Brand filter */}
          <div className="relative">
            <select className={selectCls} value={selectedBrandId} onChange={(e) => setSelectedBrandId(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">All Brands</option>
              {allBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Period filter */}
          <div className="relative">
            <select className={selectCls} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="all">All Time</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Year selector (for week/month/year) */}
          {period !== "all" && (
            <div className="relative">
              <select className={selectCls} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}

          {/* Week selector */}
          {period === "week" && (
            <div className="relative">
              <select className={selectCls} value={selectedWeek} onChange={(e) => setSelectedWeek(Number(e.target.value))}>
                {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}

          {/* Month selector */}
          {period === "month" && (
            <div className="relative">
              <select className={selectCls} value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
                {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}

          {/* Customer type filter */}
          <div className="relative">
            <select className={selectCls} value={customerType} onChange={(e) => setCustomerType(e.target.value as typeof customerType)}>
              <option value="all">All Customers</option>
              <option value="new">New Customers</option>
              <option value="returning">Returning Customers</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* ── Row 1: Platform KPIs ── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Platform</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {loading ? (
            <>
              <MetricCardSkeleton icon={Shield} label="Brands" />
              <MetricCardSkeleton icon={Users} label="Customers" />
              <MetricCardSkeleton icon={Package} label="Covers" />
              <MetricCardSkeleton icon={Store} label="Stores" />
            </>
          ) : (
            <>
              <MetricCard icon={Shield} label="Brands" value={fmtN(stats.brands)} href="/admin/brands" />
              <MetricCard icon={Users} label={customerType === "new" ? "New Customers" : customerType === "returning" ? "Returning Customers" : "Customers"} value={fmtN(stats.customers)} href="/admin/customers" />
              <MetricCard icon={Package} label="Covers" value={fmtN(stats.covers)} href="/admin/covers" />
              <MetricCard icon={Store} label="Stores" value={fmtN(stats.shops)} href="/admin/stores" />
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: Claims & Activity ── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Claims & Activity</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {loading ? (
            <>
              <MetricCardSkeleton icon={FileText} label="Total Claims" />
              <MetricCardSkeleton icon={Activity} label="Open Claims" />
              <MetricCardSkeleton icon={FileText} label="Closed Claims" />
              <MetricCardSkeleton icon={Percent} label="Claim Rate" />
            </>
          ) : (
            <>
              <MetricCard icon={FileText} label="Total Claims" value={fmtN(stats.claims)} href="/admin/claims" />
              <MetricCard icon={Activity} label="Open Claims" value={fmtN(stats.openClaims)} sub="Pending action" href="/admin/claims" accent={stats.openClaims > 0} />
              <MetricCard icon={FileText} label="Closed Claims" value={fmtN(stats.closedClaims)} href="/admin/claims" />
              <MetricCard icon={Percent} label="Claim Rate" value={stats.claimRate != null ? fmtPct(stats.claimRate) : "—"} sub="Claims / Covers" />
            </>
          )}
        </div>
      </div>

      {/* ── Row 3: Financials + Revenue ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Financials panel */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Financials</p>
          {loading ? (
            <>
              <FinRowSkeleton label="Total RRP" />
              <FinRowSkeleton label="Total Selling Price" />
              <FinRowSkeleton label="Total COGS" />
              <FinRowSkeleton label="Gross Premium" />
              <FinRowSkeleton label="Net Premium" />
            </>
          ) : (
            <>
              <FinRow label="Total RRP" value={fmt(stats.rrpTotal)} />
              <FinRow label="Total Selling Price" value={fmt(stats.sellingPriceTotal)} />
              <FinRow label="Total COGS" value={fmt(stats.cogsTotal)} />
              <FinRow label="Gross Premium" value={fmt(stats.grossPremium)} sub={`${fmtPct(stats.effectivePremiumPct)} of COGS`} />
              <FinRow label="Net Premium" value={fmt(stats.netPremium)} sub={`After GVT ${(GVT_FEE * 100).toFixed(2)}%`} />
            </>
          )}
        </div>

        {/* AION Revenue panel */}
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">AION Revenue</p>

          {/* Total */}
          <div className="flex items-end justify-between py-3 border-b border-primary/15">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                <Wallet className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground">Total Revenue</span>
            </div>
            {loading
              ? <div className="h-8 w-28 rounded-md bg-primary/15 animate-pulse" />
              : <span className="text-2xl font-bold text-primary tabular-nums">{fmt(stats.aionRevenue)}</span>
            }
          </div>

          {loading ? (
            <div className="mt-3 h-2 w-full rounded-full bg-muted animate-pulse" />
          ) : (
            <RevenueBar activationFee={stats.aionActivationFee} premiumFee={stats.aionPremiumFee} total={stats.aionRevenue} />
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-primary/15 bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Activation Fee</p>
              {loading
                ? <div className="h-5 w-20 rounded bg-muted animate-pulse mt-1" />
                : <p className="text-base font-bold text-foreground mt-0.5 tabular-nums">{fmt(stats.aionActivationFee)}</p>
              }
              <p className="text-xs text-muted-foreground/70 mt-0.5">{loading ? "" : `${fmtPct(stats.effectiveActivationFeePct)} of RRP`}</p>
            </div>
            <div className="rounded-lg border border-primary/15 bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Premium Fee</p>
              {loading
                ? <div className="h-5 w-20 rounded bg-muted animate-pulse mt-1" />
                : <p className="text-base font-bold text-foreground mt-0.5 tabular-nums">{fmt(stats.aionPremiumFee)}</p>
              }
              <p className="text-xs text-muted-foreground/70 mt-0.5">{loading ? "" : `${fmtPct(stats.effectiveAionPremiumFeePct)} of Net Premium`}</p>
            </div>
          </div>

          {!loading && stats.latestActivation && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-background/40 px-3 py-2">
              <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">
                Latest activation: <span className="font-medium text-foreground">{new Date(stats.latestActivation).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
