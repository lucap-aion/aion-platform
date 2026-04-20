import { useEffect, useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const selectCls = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-primary/40";

const CHART_COLORS = ["#7A5F28", "#c4a265", "#e8d5a3", "#a07840", "#4a3810", "#d4b483", "#8B6914", "#D4A942"];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const fmtN = (n: number) => new Intl.NumberFormat("en").format(n);

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

interface Brand { id: number; name: string; }

type PeriodOption = "30d" | "90d" | "6m" | "1y" | "all";

const getPeriodFromDate = (period: PeriodOption): string | undefined => {
  const now = new Date();
  if (period === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  if (period === "90d") return new Date(now.getTime() - 90 * 86400000).toISOString();
  if (period === "6m") return new Date(now.getTime() - 180 * 86400000).toISOString();
  if (period === "1y") return new Date(now.getTime() - 365 * 86400000).toISOString();
  return undefined;
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">{children}</p>
);

const ChartCard = ({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>
    <p className="text-sm font-semibold text-foreground mb-4">{title}</p>
    {children}
  </div>
);

const KpiCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between">
    <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{label}</p>
    {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
  </div>
);

const ChartSkeleton = () => (
  <div className="h-56 w-full rounded-lg bg-muted/60 animate-pulse" />
);

const KpiSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4">
    <div className="h-7 w-16 rounded-md bg-muted animate-pulse" />
    <div className="h-3 w-24 rounded bg-muted/60 animate-pulse mt-2" />
  </div>
);

const BreakdownTable = ({ data, valueLabel = "Count", formatValue }: {
  data: { name: string; count: number; value?: number }[];
  valueLabel?: string;
  formatValue?: (n: number) => string;
}) => {
  if (!data.length) return <p className="text-sm text-muted-foreground py-4 text-center">No data</p>;
  return (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 text-xs font-medium text-muted-foreground">Name</th>
            <th className="text-right py-2 text-xs font-medium text-muted-foreground">Count</th>
            {data[0]?.value !== undefined && (
              <th className="text-right py-2 text-xs font-medium text-muted-foreground">{valueLabel}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.name} className="border-b border-border/50 last:border-0">
              <td className="py-2 text-foreground">{row.name}</td>
              <td className="py-2 text-right tabular-nums text-foreground">{fmtN(row.count)}</td>
              {row.value !== undefined && (
                <td className="py-2 text-right tabular-nums text-foreground">{formatValue ? formatValue(row.value) : fmt(row.value)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Main ────────────────────────────────────────────────────────────────────

export default function AdminInsights() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | "all">("all");
  const [period, setPeriod] = useState<PeriodOption>("1y");
  const [loading, setLoading] = useState(true);

  // KPIs
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [activatedPct, setActivatedPct] = useState(0);
  const [registeredPct, setRegisteredPct] = useState(0);
  const [profiledPct, setProfiledPct] = useState(0);

  // Breakdowns
  const [customersByStore, setCustomersByStore] = useState<{ name: string; count: number; value: number }[]>([]);
  const [customersByCategory, setCustomersByCategory] = useState<{ name: string; count: number; value: number }[]>([]);
  const [customersByType, setCustomersByType] = useState<{ name: string; count: number; value: number }[]>([]);
  const [coversByStore, setCoversByStore] = useState<{ name: string; count: number; value: number }[]>([]);
  const [coversByCategory, setCoversByCategory] = useState<{ name: string; count: number; value: number }[]>([]);
  const [coversByType, setCoversByType] = useState<{ name: string; count: number; value: number }[]>([]);
  const [claimsByStatus, setClaimsByStatus] = useState<{ name: string; value: number }[]>([]);
  const [supportCount, setSupportCount] = useState(0);

  useEffect(() => {
    supabase.from("brands").select("id, name").order("name")
      .then(({ data }) => setBrands((data as Brand[]) ?? []));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const fromDate = getPeriodFromDate(period);
      const brandFilter = selectedBrandId !== "all" ? selectedBrandId : null;

      // ── Fetch all data in parallel ──────────────────────────────────
      let custQ = supabase
        .from("profiles")
        .select("id, created_at, registered_at, email_confirmed_at, first_name, last_name, shop_id, brand_id, status")
        .eq("role", "customer");
      if (brandFilter) custQ = custQ.eq("brand_id", brandFilter);

      let polQ = supabase
        .from("policies")
        .select("id, customer_id, shop_id, item_id, selling_price, quantity, brand_id, start_date, catalogues(category), shops(name)");
      if (brandFilter) polQ = polQ.eq("brand_id", brandFilter);
      if (fromDate) polQ = polQ.gte("start_date", fromDate);

      let clmQ = supabase.from("claims").select("id, status, policy_id");
      if (fromDate) clmQ = clmQ.gte("created_at", fromDate);

      let supQ = supabase.from("support_messages").select("id", { count: "exact", head: true });
      if (brandFilter) supQ = supQ.eq("brand_id", brandFilter);
      if (fromDate) supQ = supQ.gte("created_at", fromDate);

      // Shops lookup
      let shopsQ = supabase.from("shops").select("id, name");
      if (brandFilter) shopsQ = shopsQ.eq("brand_id", brandFilter);

      const [
        { data: customers = [] },
        { data: policies = [] },
        { data: claims = [] },
        { count: supportMsgCount },
        { data: shops = [] },
      ] = await Promise.all([custQ, polQ, clmQ, supQ, shopsQ]);

      // ── Customer KPIs ──────────────────────────────────────────────
      const total = (customers as any[]).length;
      setTotalCustomers(total);

      if (total > 0) {
        const activated = (customers as any[]).filter((c: any) => c.email_confirmed_at).length;
        const registered = (customers as any[]).filter((c: any) => c.registered_at).length;
        const profiled = (customers as any[]).filter((c: any) => c.first_name && c.last_name).length;
        setActivatedPct(activated / total);
        setRegisteredPct(registered / total);
        setProfiledPct(profiled / total);
      } else {
        setActivatedPct(0);
        setRegisteredPct(0);
        setProfiledPct(0);
      }

      // ── Build lookups ──────────────────────────────────────────────
      const shopMap = new Map<number, string>();
      for (const s of shops as any[]) shopMap.set(s.id, s.name ?? `Store #${s.id}`);

      const policyIdSet = new Set((policies as any[]).map((p: any) => p.id));
      const customerCreatedMap = new Map<string, string>();
      for (const c of customers as any[]) customerCreatedMap.set(c.id, c.created_at);

      // Determine new vs returning threshold
      const isNewCustomer = (customerId: string) => {
        if (!fromDate) return true;
        const created = customerCreatedMap.get(customerId);
        return created ? created >= fromDate : false;
      };

      // ── Customers by Store ─────────────────────────────────────────
      const custByStoreMap = new Map<string, Set<string>>();
      const custValueByStoreMap = new Map<string, number>();
      const custByCatMap = new Map<string, Set<string>>();
      const custValueByCatMap = new Map<string, number>();
      const newCustomerIds = new Set<string>();
      const returningCustomerIds = new Set<string>();
      let newCustValue = 0;
      let returningCustValue = 0;

      // Covers by store / category / type
      const coverByStoreMap = new Map<string, { count: number; value: number }>();
      const coverByCatMap = new Map<string, { count: number; value: number }>();
      let newCovers = 0, newCoverValue = 0, retCovers = 0, retCoverValue = 0;

      for (const p of policies as any[]) {
        const qty = Number(p.quantity) || 1;
        const sp = (Number(p.selling_price) || 0) * qty;
        const storeName = p.shops?.name ?? shopMap.get(p.shop_id) ?? "Unknown Store";
        const category = p.catalogues?.category ?? "Uncategorized";
        const custId = p.customer_id as string;
        const isNew = isNewCustomer(custId);

        // Customers by store
        if (custId) {
          if (!custByStoreMap.has(storeName)) custByStoreMap.set(storeName, new Set());
          custByStoreMap.get(storeName)!.add(custId);
          custValueByStoreMap.set(storeName, (custValueByStoreMap.get(storeName) ?? 0) + sp);

          if (!custByCatMap.has(category)) custByCatMap.set(category, new Set());
          custByCatMap.get(category)!.add(custId);
          custValueByCatMap.set(category, (custValueByCatMap.get(category) ?? 0) + sp);

          if (isNew) { newCustomerIds.add(custId); newCustValue += sp; }
          else { returningCustomerIds.add(custId); returningCustValue += sp; }
        }

        // Covers by store
        const storeEntry = coverByStoreMap.get(storeName) ?? { count: 0, value: 0 };
        coverByStoreMap.set(storeName, { count: storeEntry.count + 1, value: storeEntry.value + sp });

        // Covers by category
        const catEntry = coverByCatMap.get(category) ?? { count: 0, value: 0 };
        coverByCatMap.set(category, { count: catEntry.count + 1, value: catEntry.value + sp });

        // Covers by type
        if (isNew) { newCovers++; newCoverValue += sp; }
        else { retCovers++; retCoverValue += sp; }
      }

      // Set customer breakdowns
      setCustomersByStore(
        Array.from(custByStoreMap.entries())
          .map(([name, ids]) => ({ name, count: ids.size, value: custValueByStoreMap.get(name) ?? 0 }))
          .sort((a, b) => b.count - a.count)
      );
      setCustomersByCategory(
        Array.from(custByCatMap.entries())
          .map(([name, ids]) => ({ name, count: ids.size, value: custValueByCatMap.get(name) ?? 0 }))
          .sort((a, b) => b.count - a.count)
      );
      setCustomersByType([
        { name: "New Customers", count: newCustomerIds.size, value: newCustValue },
        { name: "Returning Customers", count: returningCustomerIds.size, value: returningCustValue },
      ]);

      // Set cover breakdowns
      setCoversByStore(
        Array.from(coverByStoreMap.entries())
          .map(([name, { count, value }]) => ({ name, count, value }))
          .sort((a, b) => b.count - a.count)
      );
      setCoversByCategory(
        Array.from(coverByCatMap.entries())
          .map(([name, { count, value }]) => ({ name, count, value }))
          .sort((a, b) => b.count - a.count)
      );
      setCoversByType([
        { name: "New Customers", count: newCovers, value: newCoverValue },
        { name: "Returning Customers", count: retCovers, value: retCoverValue },
      ]);

      // ── Claims by Status ───────────────────────────────────────────
      const filteredClaims = brandFilter
        ? (claims as any[]).filter((c: any) => policyIdSet.has(c.policy_id))
        : (claims as any[]);
      const statusMap = new Map<string, number>();
      for (const c of filteredClaims) {
        const s = c.status ? c.status.charAt(0).toUpperCase() + c.status.slice(1) : "Unknown";
        statusMap.set(s, (statusMap.get(s) ?? 0) + 1);
      }
      setClaimsByStatus(Array.from(statusMap.entries()).map(([name, value]) => ({ name, value })));

      // ── Support ────────────────────────────────────────────────────
      setSupportCount(supportMsgCount ?? 0);

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
          <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.value > 100 ? fmt(p.value) : fmtN(p.value)}</p>
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

      {/* ── Customer KPIs ─────────────────────────────────────────── */}
      <div>
        <SectionTitle>Customer Overview</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {loading ? (
            <>
              <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
            </>
          ) : (
            <>
              <KpiCard label="Total Customers" value={fmtN(totalCustomers)} />
              <KpiCard label="% Activated" value={fmtPct(activatedPct)} sub="Email confirmed" />
              <KpiCard label="% Registered" value={fmtPct(registeredPct)} sub="Completed registration" />
              <KpiCard label="% Profiled" value={fmtPct(profiledPct)} sub="Name filled in" />
            </>
          )}
        </div>
      </div>

      {/* ── Customers by dimension ────────────────────────────────── */}
      <div>
        <SectionTitle>Number of Customers & Customer Value</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="By Store">
            {loading ? <ChartSkeleton /> : <BreakdownTable data={customersByStore} valueLabel="Value" formatValue={fmt} />}
          </ChartCard>
          <ChartCard title="By Category">
            {loading ? <ChartSkeleton /> : <BreakdownTable data={customersByCategory} valueLabel="Value" formatValue={fmt} />}
          </ChartCard>
          <ChartCard title="By New / Returning">
            {loading ? <ChartSkeleton /> : <BreakdownTable data={customersByType} valueLabel="Value" formatValue={fmt} />}
          </ChartCard>
        </div>
      </div>

      {/* ── Covers by dimension ───────────────────────────────────── */}
      <div>
        <SectionTitle>Number of Covers & Cover Value</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="By Store">
            {loading ? <ChartSkeleton /> : <BreakdownTable data={coversByStore} valueLabel="Value" formatValue={fmt} />}
          </ChartCard>
          <ChartCard title="By Category">
            {loading ? <ChartSkeleton /> : <BreakdownTable data={coversByCategory} valueLabel="Value" formatValue={fmt} />}
          </ChartCard>
          <ChartCard title="By New / Returning Customer">
            {loading ? <ChartSkeleton /> : <BreakdownTable data={coversByType} valueLabel="Value" formatValue={fmt} />}
          </ChartCard>
        </div>
      </div>

      {/* ── Claims & Support ──────────────────────────────────────── */}
      <div>
        <SectionTitle>Claims & Support</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Claims by Status">
            {loading ? <ChartSkeleton /> : claimsByStatus.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No claims in this period</div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie
                      data={claimsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                    >
                      {claimsByStatus.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {claimsByStatus.map((entry, i) => (
                    <div key={entry.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-sm text-foreground">{entry.name}</span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-foreground">{fmtN(entry.value)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-sm font-medium text-foreground">Total</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">{fmtN(claimsByStatus.reduce((a, b) => a + b.value, 0))}</span>
                  </div>
                </div>
              </div>
            )}
          </ChartCard>

          <ChartCard title="Customer Support Requests">
            {loading ? <ChartSkeleton /> : (
              <div className="h-56 flex flex-col items-center justify-center">
                <p className="text-5xl font-bold tabular-nums text-foreground">{fmtN(supportCount)}</p>
                <p className="text-sm text-muted-foreground mt-2">Total requests in period</p>
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
