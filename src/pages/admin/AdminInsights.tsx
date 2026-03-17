import { useEffect, useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const selectCls = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-primary/40";

const CHART_COLORS = ["#7A5F28", "#c4a265", "#e8d5a3", "#a07840", "#4a3810", "#d4b483"];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const fmtShort = (n: number) =>
  n >= 1000 ? `€${(n / 1000).toFixed(1)}k` : `€${n}`;

interface Brand { id: number; name: string; activation_fee: unknown; insurance_premium: unknown; aion_premium_fee: unknown; }

type PeriodOption = "30d" | "90d" | "6m" | "1y" | "all";

const getPeriodFromDate = (period: PeriodOption): string | undefined => {
  const now = new Date();
  if (period === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  if (period === "90d") return new Date(now.getTime() - 90 * 86400000).toISOString();
  if (period === "6m") return new Date(now.getTime() - 180 * 86400000).toISOString();
  if (period === "1y") return new Date(now.getTime() - 365 * 86400000).toISOString();
  return undefined;
};

const toMonthKey = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">{children}</p>
);

const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-5">
    <p className="text-sm font-semibold text-foreground mb-4">{title}</p>
    {children}
  </div>
);

const ChartSkeleton = () => (
  <div className="h-56 w-full rounded-lg bg-secondary/60 animate-pulse" />
);

// ─── Main ────────────────────────────────────────────────────────────────────

export default function AdminInsights() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | "all">("all");
  const [period, setPeriod] = useState<PeriodOption>("1y");
  const [loading, setLoading] = useState(true);

  // Chart data
  const [coversOverTime, setCoversOverTime] = useState<{ month: string; covers: number }[]>([]);
  const [claimsOverTime, setClaimsOverTime] = useState<{ month: string; open: number; closed: number }[]>([]);
  const [claimsByType, setClaimsByType] = useState<{ name: string; value: number }[]>([]);
  const [revenueByBrand, setRevenueByBrand] = useState<{ name: string; activationFee: number; premiumFee: number }[]>([]);
  const [customerGrowth, setCustomerGrowth] = useState<{ month: string; customers: number }[]>([]);
  const [protectedValueOverTime, setProtectedValueOverTime] = useState<{ month: string; value: number }[]>([]);

  useEffect(() => {
    supabase.from("brands").select("id, name, activation_fee, insurance_premium, aion_premium_fee").order("name")
      .then(({ data }) => setBrands((data as Brand[]) ?? []));
  }, []);

  const toPct = (v: unknown): number => {
    if (v == null) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? (v > 1 ? v / 100 : v) : 0;
    const s = String(v).trim();
    const n = parseFloat(s.replace("%", ""));
    if (!Number.isFinite(n)) return 0;
    return s.includes("%") || n > 1 ? n / 100 : n;
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const fromDate = getPeriodFromDate(period);
      const brandIds = selectedBrandId === "all" ? brands.map((b) => b.id) : [selectedBrandId];

      // Policies query
      let polQ = supabase
        .from("policies")
        .select("id, brand_id, start_date, selling_price, cogs, recommended_retail_price, quantity, customer_id");
      if (brandIds.length > 0) polQ = polQ.in("brand_id", brandIds);
      if (fromDate) polQ = polQ.gte("start_date", fromDate);

      // Claims query
      let clmQ = supabase
        .from("claims")
        .select("id, type, status, created_at, policy_id");
      if (fromDate) clmQ = clmQ.gte("created_at", fromDate);

      // Customers query
      let custQ = supabase
        .from("profiles")
        .select("id, created_at, brand_id")
        .eq("role", "customer");
      if (selectedBrandId !== "all") custQ = custQ.eq("brand_id", selectedBrandId);
      if (fromDate) custQ = custQ.gte("created_at", fromDate);

      const [{ data: policies = [] }, { data: claims = [] }, { data: customers = [] }] = await Promise.all([
        polQ, clmQ, custQ,
      ]);

      const policyIdSet = new Set((policies as any[]).map((p) => p.id));

      // --- Covers over time ---
      const coversByMonth = new Map<string, number>();
      for (const p of policies as any[]) {
        if (!p.start_date) continue;
        const key = toMonthKey(p.start_date);
        coversByMonth.set(key, (coversByMonth.get(key) ?? 0) + 1);
      }
      const sortedMonths = Array.from(coversByMonth.keys()).sort();
      setCoversOverTime(sortedMonths.map((m) => ({ month: monthLabel(m), covers: coversByMonth.get(m)! })));

      // --- Claims over time (only for filtered brand) ---
      const filteredClaims = (claims as any[]).filter((c) => policyIdSet.has(c.policy_id));
      const claimsOpenByMonth = new Map<string, number>();
      const claimsClosedByMonth = new Map<string, number>();
      for (const c of filteredClaims) {
        if (!c.created_at) continue;
        const key = toMonthKey(c.created_at);
        if (c.status === "open") claimsOpenByMonth.set(key, (claimsOpenByMonth.get(key) ?? 0) + 1);
        else claimsClosedByMonth.set(key, (claimsClosedByMonth.get(key) ?? 0) + 1);
      }
      const allClaimMonths = Array.from(new Set([...claimsOpenByMonth.keys(), ...claimsClosedByMonth.keys()])).sort();
      setClaimsOverTime(allClaimMonths.map((m) => ({
        month: monthLabel(m),
        open: claimsOpenByMonth.get(m) ?? 0,
        closed: claimsClosedByMonth.get(m) ?? 0,
      })));

      // --- Claims by type ---
      const typeMap = new Map<string, number>();
      for (const c of filteredClaims) {
        const t = c.type ? c.type.replace(/_/g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase()) : "Unknown";
        typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
      }
      setClaimsByType(Array.from(typeMap.entries()).map(([name, value]) => ({ name, value })));

      // --- Revenue by brand (top 8) ---
      const GVT_FEE = 0.2225;
      const brandMap = new Map<number, { name: string; activationFee: number; premiumFee: number }>();
      const brandLookup = new Map(brands.map((b) => [b.id, b]));
      for (const p of policies as any[]) {
        const bid = Number(p.brand_id);
        const b = brandLookup.get(bid);
        if (!b) continue;
        const qty = Number(p.quantity) || 1;
        const cogs = (Number(p.cogs) || 0) * qty;
        const rrp = (Number(p.recommended_retail_price) || 0) * qty;
        const grossP = cogs * toPct(b.insurance_premium);
        const netP = grossP * (1 - GVT_FEE);
        const actFee = rrp * toPct(b.activation_fee);
        const premFee = netP * toPct(b.aion_premium_fee);
        const existing = brandMap.get(bid) ?? { name: b.name, activationFee: 0, premiumFee: 0 };
        brandMap.set(bid, { name: existing.name, activationFee: existing.activationFee + actFee, premiumFee: existing.premiumFee + premFee });
      }
      const topBrands = Array.from(brandMap.values())
        .sort((a, b) => (b.activationFee + b.premiumFee) - (a.activationFee + a.premiumFee))
        .slice(0, 8);
      setRevenueByBrand(topBrands);

      // --- Customer growth over time (cumulative) ---
      const custByMonth = new Map<string, number>();
      for (const c of customers as any[]) {
        if (!c.created_at) continue;
        const key = toMonthKey(c.created_at);
        custByMonth.set(key, (custByMonth.get(key) ?? 0) + 1);
      }
      const custMonths = Array.from(custByMonth.keys()).sort();
      let cumulative = 0;
      setCustomerGrowth(custMonths.map((m) => {
        cumulative += custByMonth.get(m)!;
        return { month: monthLabel(m), customers: cumulative };
      }));

      // --- Protected value over time ---
      const valueByMonth = new Map<string, number>();
      for (const p of policies as any[]) {
        if (!p.start_date) continue;
        const key = toMonthKey(p.start_date);
        const qty = Number(p.quantity) || 1;
        const sp = (Number(p.selling_price) || 0) * qty;
        valueByMonth.set(key, (valueByMonth.get(key) ?? 0) + sp);
      }
      const valueMonths = Array.from(valueByMonth.keys()).sort();
      setProtectedValueOverTime(valueMonths.map((m) => ({ month: monthLabel(m), value: Math.round(valueByMonth.get(m)!) })));

    } finally {
      setLoading(false);
    }
  }, [brands, selectedBrandId, period]);

  useEffect(() => {
    if (brands.length > 0 || selectedBrandId === "all") void loadData();
  }, [loadData, brands]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.value > 100 ? fmt(p.value) : p.value}</p>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">Insights</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Analytics across brands and time periods</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select className={selectCls} value={selectedBrandId} onChange={(e) => setSelectedBrandId(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">All Brands</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="relative">
            <select className={selectCls} value={period} onChange={(e) => setPeriod(e.target.value as PeriodOption)}>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="6m">Last 6 Months</option>
              <option value="1y">Last 12 Months</option>
              <option value="all">All Time</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Covers activated */}
      <div>
        <SectionTitle>Covers & Growth</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Covers Activated per Month">
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={coversOverTime} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="covers" name="Covers" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Customer Growth (Cumulative)">
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={customerGrowth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="customers" name="Customers" stroke={CHART_COLORS[0]} fill="url(#custGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Claims */}
      <div>
        <SectionTitle>Claims</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Claims Opened vs Closed per Month">
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={claimsOverTime} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="open" name="Open" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="closed" name="Closed" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Claims by Type">
            {loading ? <ChartSkeleton /> : claimsByType.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No claims in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={claimsByType}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {claimsByType.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Revenue */}
      <div>
        <SectionTitle>Revenue</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Revenue by Brand">
            {loading ? <ChartSkeleton /> : revenueByBrand.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueByBrand} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtShort} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={80} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="activationFee" name="Activation Fee" fill={CHART_COLORS[0]} stackId="rev" />
                  <Bar dataKey="premiumFee" name="Premium Fee" fill={CHART_COLORS[1]} stackId="rev" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Protected Value Activated per Month">
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={protectedValueOverTime} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[3]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[3]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtShort} />
                  <Tooltip content={<CustomTooltip />} formatter={(v: number) => fmt(v)} />
                  <Area type="monotone" dataKey="value" name="Selling Price" stroke={CHART_COLORS[3]} fill="url(#valGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
