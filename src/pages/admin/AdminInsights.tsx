import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  BarChart, Bar, PieChart, Pie, Cell, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList, Legend,
} from "recharts";

// ─── Chart palette — high-contrast, brand-aligned ────────────────────────────
const C1 = "#B8860B"; // dark goldenrod — primary brand
const C2 = "#2A7B5B"; // deep emerald — strong contrast
const C3 = "#5B7FA5"; // slate blue
const C4 = "#C45A3C"; // terracotta
const C5 = "#8B6DAE"; // muted purple
const C6 = "#A0A0A0"; // neutral gray
const COLORS = [C1, C2, C3, C4, C5, C6];
// Semantic aliases
const GOLD = C1, TEAL = C2, SLATE = C6, WARM = "#8C7A5E", ROSE = C4;
const BL = C1, GR = C2, GY = C6, PU = C3, AM = C4;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getWeek(ds: string) {
  const dt = new Date(ds), d = dt.getDay() || 7;
  dt.setDate(dt.getDate() + 4 - d);
  const ys = new Date(dt.getFullYear(), 0, 1);
  return dt.getFullYear() + "-W" + String(Math.ceil(((+dt - +ys) / 86400000 + 1) / 7)).padStart(2, "0");
}
function getMonth(ds: string) { return ds.substring(0, 7); }

// Returns a translation key for the continent
function countryToContinentKey(c: string | null): string {
  if (!c) return "insights.geo.unknown";
  const up = c.toUpperCase();
  const europe = ["ITALY","ITALIA","FRANCE","FRANCIA","GERMANY","GERMANIA","SPAIN","SPAGNA","UK","UNITED KINGDOM","SWITZERLAND","SVIZZERA","AUSTRIA","BELGIUM","NETHERLANDS","PORTUGAL","POLAND","SWEDEN","NORWAY","DENMARK","FINLAND","IRELAND","GREECE","CZECH REPUBLIC","ROMANIA","HUNGARY","CROATIA","SERBIA","BULGARIA","SLOVAKIA","SLOVENIA","LUXEMBOURG","MONACO","LIECHTENSTEIN","ANDORRA","MALTA","ICELAND","ALBANIA","NORTH MACEDONIA","MONTENEGRO","BOSNIA","LITHUANIA","LATVIA","ESTONIA","CYPRUS","MOLDOVA","UKRAINE","BELARUS","RUSSIA"];
  const americas = ["USA","UNITED STATES","CANADA","BRAZIL","BRASILE","MEXICO","MESSICO","ARGENTINA","COLOMBIA","CHILE","PERU","VENEZUELA","ECUADOR","GUATEMALA","CUBA","BOLIVIA","DOMINICAN REPUBLIC","HONDURAS","PARAGUAY","EL SALVADOR","NICARAGUA","COSTA RICA","PANAMA","URUGUAY","PUERTO RICO"];
  const mideast = ["UAE","UNITED ARAB EMIRATES","SAUDI ARABIA","QATAR","KUWAIT","BAHRAIN","OMAN","JORDAN","LEBANON","ISRAEL","IRAN","IRAQ","TURKEY","TURCHIA","EGYPT","EGITTO","YEMEN","SYRIA"];
  if (europe.includes(up)) return "insights.geo.europe";
  if (americas.includes(up)) return "insights.geo.americas";
  if (mideast.includes(up)) return "insights.geo.mideast";
  return "insights.geo.asia";
}

// Returns a translation key for the generation
function birthYearToGenerationKey(dob: string | null): string {
  if (!dob) return "insights.gen.unknown";
  const y = new Date(dob).getFullYear();
  if (y >= 1997) return "insights.gen.genZ";
  if (y >= 1981) return "insights.gen.millennials";
  if (y >= 1965) return "insights.gen.genX";
  if (y >= 1946) return "insights.gen.boomers";
  return "insights.gen.silent";
}

const selectCls = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-primary/40";

// ─── UI Components ───────────────────────────────────────────────────────────
const KpiCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between hover:border-primary/30 transition-colors">
    <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{label}</p>
    {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
  </div>
);

const ChartCard = ({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-border bg-card p-5 shadow-sm ${className}`}>
    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">{title}</p>
    {children}
  </div>
);

const ColorLegend = ({ items }: { items: { color: string; label: string }[] }) => (
  <div className="flex flex-wrap gap-3 mb-3 text-[11px] text-muted-foreground">
    {items.map(i => (
      <span key={i.label} className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: i.color }} />
        {i.label}
      </span>
    ))}
  </div>
);

const SimpleBarLabel = ({ x, y, width, height, value }: any) => {
  if (!value) return null;
  const inside = height > 22;
  return (
    <text x={x + width / 2} y={inside ? y + height / 2 : y - 8} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"}
      fill={inside ? "#fff" : "hsl(0 0% 40%)"} fontSize={11} fontWeight={600} fontFamily="DM Sans, system-ui, sans-serif">{value}</text>
  );
};

const StackLabel = ({ x, y, width, height, value }: any) => {
  if (!value || height < 20) return null;
  return (
    <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle"
      fill="#fff" fontSize={11} fontWeight={600} fontFamily="DM Sans, system-ui, sans-serif">{value}</text>
  );
};

const CTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background px-3 py-2.5 text-xs shadow-lg backdrop-blur-sm">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color || p.fill }} />
          <span>{p.name ?? p.dataKey}: <strong className="text-foreground">{p.value}</strong></span>
        </p>
      ))}
    </div>
  );
};

const ChartSkeleton = () => <div className="h-56 w-full rounded-xl border border-border bg-card animate-pulse" />;
const KpiSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4">
    <div className="h-7 w-16 rounded-md bg-muted animate-pulse" />
    <div className="h-3 w-24 rounded bg-muted/60 animate-pulse mt-2" />
  </div>
);

// ─── Types ───────────────────────────────────────────────────────────────────
interface PolicyRow {
  id: number;
  start_date: string;
  recommended_retail_price: number;
  selling_price: number;
  customer_id: string;
  shop_id: number;
  shops: { name: string } | null;
  catalogues: { category: string } | null;
}

interface ProfileRow {
  id: string;
  registered_at: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  city: string | null;
  postcode: string | null;
  address: string | null;
  province: string | null;
  nationality: string | null;
  phone_number: string | null;
  created_at: string;
}

interface FeedbackRow {
  user_id: string;
  satisfaction_rate: number | null;
  peace_of_mind_rate: number | null;
  recommendation_rate: number | null;
}

interface Brand { id: number; name: string }

// ─── Data Processing ─────────────────────────────────────────────────────────
interface ProcessedPolicy {
  id: number;
  date: string;
  rrp: number;
  sellingPrice: number;
  shop: string;
  customerId: string;
  regDate: string | null;
  category: string;
}

function useInsightsData(policies: ProcessedPolicy[], profiles: ProfileRow[], feedback: FeedbackRow[]) {
  return useMemo(() => {
    if (!policies.length) return null;

    // Customer map from policies — track per-shop RRP for multi-shop customers
    const custMap: Record<string, { rrp: number; sp: number; np: number; sh: string; fd: string; reg: string | null; shopRRP: Record<string, number> }> = {};
    policies.forEach(p => {
      const c = p.customerId;
      if (!custMap[c]) custMap[c] = { rrp: 0, sp: 0, np: 0, sh: p.shop, fd: p.date, reg: p.regDate, shopRRP: {} };
      custMap[c].rrp += p.rrp; custMap[c].sp += p.sellingPrice; custMap[c].np++;
      custMap[c].shopRRP[p.shop] = (custMap[c].shopRRP[p.shop] || 0) + p.rrp;
      if (p.regDate && !custMap[c].reg) custMap[c].reg = p.regDate;
      if (p.date < custMap[c].fd) { custMap[c].fd = p.date; custMap[c].sh = p.shop; }
    });
    // Assign customer to shop where they spent the most (primary shop)
    Object.values(custMap).forEach(c => {
      let maxShop = c.sh, maxRRP = 0;
      for (const [s, r] of Object.entries(c.shopRRP)) { if (r > maxRRP) { maxRRP = r; maxShop = s; } }
      c.sh = maxShop;
    });
    const custs = Object.values(custMap);
    const regC = custs.filter(c => c.reg);
    const nonRegC = custs.filter(c => !c.reg);
    const uniqueCustomers = Object.keys(custMap).length;

    // Shop splits — assign customer to their primary shop
    const shops = [...new Set(policies.map(p => p.shop))];
    const shopCusts: Record<string, typeof custs> = {};
    shops.forEach(s => shopCusts[s] = custs.filter(c => c.sh === s));
    const shopRegCusts: Record<string, typeof custs> = {};
    shops.forEach(s => shopRegCusts[s] = shopCusts[s].filter(c => c.reg));

    // Feedback & profile stats
    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const regCustIds = Object.entries(custMap).filter(([, v]) => v.reg).map(([k]) => k);
    const profiledCustIds = regCustIds.filter(id => {
      const p = profileMap.get(id);
      return p && p.date_of_birth && p.country && p.city && p.postcode && p.address && p.province && p.nationality && p.phone_number;
    });
    const feedbackUserIds = new Set(feedback.map(f => f.user_id));
    const custsWithFeedback = regCustIds.filter(id => feedbackUserIds.has(id));

    const avgRate = (arr: (number | null)[]) => {
      const valid = arr.filter((v): v is number => v !== null && v > 0);
      return valid.length ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) : null;
    };
    const satisfactionAvg = avgRate(feedback.map(f => f.satisfaction_rate));
    const recommendationAvg = avgRate(feedback.map(f => f.recommendation_rate));
    const peaceOfMindAvg = avgRate(feedback.map(f => f.peace_of_mind_rate));

    // Totals
    const totalRRP = policies.reduce((s, p) => s + p.rrp, 0);
    const totalSP = policies.reduce((s, p) => s + p.sellingPrice, 0);
    const totalCovers = policies.length;

    // Shop volume/rrp
    const shopVolume: Record<string, number> = {};
    const shopRRP: Record<string, number> = {};
    policies.forEach(p => {
      shopVolume[p.shop] = (shopVolume[p.shop] || 0) + 1;
      shopRRP[p.shop] = (shopRRP[p.shop] || 0) + p.rrp;
    });

    // Weekly/monthly aggregation
    type PeriodAgg = { v: number; r: number; shopV: Record<string, number>; shopR: Record<string, number>; nc: Set<string> };
    const WM: Record<string, PeriodAgg> = {};
    const MM: Record<string, PeriodAgg> = {};
    policies.forEach(p => {
      const w = getWeek(p.date), m = getMonth(p.date), sh = p.shop;
      if (!WM[w]) WM[w] = { v: 0, r: 0, shopV: {}, shopR: {}, nc: new Set() };
      if (!MM[m]) MM[m] = { v: 0, r: 0, shopV: {}, shopR: {}, nc: new Set() };
      [WM[w], MM[m]].forEach(agg => {
        agg.v++; agg.r += p.rrp; agg.nc.add(p.customerId);
        agg.shopV[sh] = (agg.shopV[sh] || 0) + 1;
        agg.shopR[sh] = (agg.shopR[sh] || 0) + p.rrp;
      });
    });
    const wks = Object.keys(WM).sort();
    const mos = Object.keys(MM).sort();

    // Category data
    function catData(pols: ProcessedPolicy[]) {
      const ct: Record<string, number> = {}, cr: Record<string, number> = {};
      pols.forEach(p => { const c = p.category; ct[c] = (ct[c] || 0) + 1; cr[c] = (cr[c] || 0) + p.rrp; });
      const sorted = Object.entries(ct).sort((a, b) => b[1] - a[1]);
      const totV = pols.length, totR = pols.reduce((s, p) => s + p.rrp, 0) / 1000;
      return sorted.map(([cat, vol]) => ({
        cat, vol, rrpk: Math.round(cr[cat] / 1000),
        volPct: totV > 0 ? Math.round(vol / totV * 100) : 0,
        rrpPct: totR > 0 ? Math.round(cr[cat] / 1000 / totR * 100) : 0,
      }));
    }

    // New vs returning
    function calcReturning(periods: string[], getKey: (d: string) => string) {
      const allShops = shops;
      const firstSeen: Record<string, string> = {};
      const firstSeenShop: Record<string, Record<string, string>> = {};
      allShops.forEach(s => firstSeenShop[s] = {});
      const sorted = [...policies].sort((a, b) => a.date < b.date ? -1 : 1);
      sorted.forEach(p => {
        const cid = p.customerId, sh = p.shop, key = getKey(p.date);
        if (!firstSeen[cid]) firstSeen[cid] = key;
        if (!firstSeenShop[sh]?.[cid]) {
          if (!firstSeenShop[sh]) firstSeenShop[sh] = {};
          firstSeenShop[sh][cid] = key;
        }
      });
      const result: Record<string, { nov: number; ret: number; shopNov: Record<string, number>; shopRet: Record<string, number> }> = {};
      periods.forEach(k => {
        const shopNov: Record<string, number> = {}, shopRet: Record<string, number> = {};
        allShops.forEach(s => { shopNov[s] = 0; shopRet[s] = 0; });
        result[k] = { nov: 0, ret: 0, shopNov, shopRet };
      });
      const seenP: Record<string, Set<string>> = {};
      const seenShop: Record<string, Record<string, Set<string>>> = {};
      periods.forEach(k => {
        seenP[k] = new Set();
        seenShop[k] = {};
        allShops.forEach(s => seenShop[k][s] = new Set());
      });
      sorted.forEach(p => {
        const cid = p.customerId, sh = p.shop, key = getKey(p.date);
        if (!result[key]) return;
        if (!seenP[key].has(cid)) { seenP[key].add(cid); if (firstSeen[cid] === key) result[key].nov++; else result[key].ret++; }
        if (!seenShop[key][sh]?.has(cid)) {
          if (!seenShop[key][sh]) seenShop[key][sh] = new Set();
          seenShop[key][sh].add(cid);
          if (firstSeenShop[sh]?.[cid] === key) result[key].shopNov[sh] = (result[key].shopNov[sh] || 0) + 1;
          else result[key].shopRet[sh] = (result[key].shopRet[sh] || 0) + 1;
        }
      });
      return result;
    }

    const retW = calcReturning(wks, getWeek);
    const retM = calcReturning(mos, getMonth);

    // RRP avg per client by period
    function rrpAvgByPeriod(periods: string[], getKey: (d: string) => string) {
      const custBy: Record<string, { firstK: string; rrp: number; reg: string | null }> = {};
      policies.forEach(p => {
        const cid = p.customerId, k = getKey(p.date);
        if (!custBy[cid]) custBy[cid] = { firstK: k, rrp: 0, reg: p.regDate };
        custBy[cid].rrp += p.rrp;
        if (p.regDate && !custBy[cid].reg) custBy[cid].reg = p.regDate;
        if (k < custBy[cid].firstK) custBy[cid].firstK = k;
      });
      const regByK: Record<string, number[]> = {};
      const nonByK: Record<string, number[]> = {};
      periods.forEach(k => { regByK[k] = []; nonByK[k] = []; });
      Object.values(custBy).forEach(c => {
        if (!regByK[c.firstK]) return;
        if (c.reg) regByK[c.firstK].push(c.rrp); else nonByK[c.firstK].push(c.rrp);
      });
      const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000) : null;
      return periods.map(k => ({ key: k, reg: avg(regByK[k]), nonReg: avg(nonByK[k]) }));
    }

    // Registration % by period
    const RBW: Record<string, Set<string>> = {};
    const RBM: Record<string, Set<string>> = {};
    policies.filter(p => p.regDate).forEach(p => {
      const w = getWeek(p.regDate!), m = getMonth(p.regDate!);
      if (!RBW[w]) RBW[w] = new Set(); RBW[w].add(p.customerId);
      if (!RBM[m]) RBM[m] = new Set(); RBM[m].add(p.customerId);
    });

    function regPctByPeriod(periods: string[], aggMap: Record<string, PeriodAgg>, regMap: Record<string, Set<string>>) {
      const allKeys = [...new Set([...periods, ...Object.keys(regMap)])].sort();
      return allKeys.map(k => {
        const nc = aggMap[k]?.nc.size || 0;
        const nr = (regMap[k] || new Set()).size;
        return { key: k, pct: nc > 0 ? Math.round(nr / nc * 100) : 0 };
      });
    }

    // Registration % per month per shop
    function regPctByMonthShop() {
      const firstSeenByMo: Record<string, { m: string; sh: string }> = {};
      const sorted = [...policies].sort((a, b) => a.date < b.date ? -1 : 1);
      sorted.forEach(p => { const cid = p.customerId, m = getMonth(p.date); if (!firstSeenByMo[cid]) firstSeenByMo[cid] = { m, sh: p.shop }; });
      const regCids = new Set(policies.filter(p => p.regDate).map(p => p.customerId));
      const novByShop: Record<string, Record<string, number>> = {};
      const regNovByShop: Record<string, Record<string, number>> = {};
      shops.forEach(s => { novByShop[s] = {}; regNovByShop[s] = {}; mos.forEach(m => { novByShop[s][m] = 0; regNovByShop[s][m] = 0; }); });
      Object.entries(firstSeenByMo).forEach(([cid, { m, sh }]) => {
        if (!novByShop[sh]?.[m] && novByShop[sh]?.[m] !== 0) return;
        novByShop[sh][m]++;
        if (regCids.has(cid)) regNovByShop[sh][m]++;
      });
      return { mos, shops, novByShop, regNovByShop };
    }

    // Ticket bands
    function ticketBands(cs: typeof custs) {
      const bands = ["<2k", "2-5k", "5-10k", "10-15k", "15-20k", "20k+"];
      function bkt(rrp: number) { if (rrp < 2000) return 0; if (rrp < 5000) return 1; if (rrp < 10000) return 2; if (rrp < 15000) return 3; if (rrp < 20000) return 4; return 5; }
      const tot = Array(6).fill(0), reg = Array(6).fill(0);
      cs.forEach(c => { const b = bkt(c.rrp); tot[b]++; if (c.reg) reg[b]++; });
      return bands.map((name, i) => ({ name, pct: tot[i] > 0 ? Math.round(reg[i] / tot[i] * 100) : 0, reg: reg[i], tot: tot[i] }));
    }

    // Registration time — uses earliest policy date per customer vs their registration date
    function regTimeData() {
      // Use custMap which already has fd (first date) and reg per customer
      const uq: { cid: string; days: number; actDate: string }[] = [];
      Object.entries(custMap).forEach(([cid, c]) => {
        if (!c.reg) return;
        const d1 = new Date(c.fd).getTime(), d2 = new Date(c.reg).getTime();
        const days = Math.round((d2 - d1) / 86400000);
        uq.push({ cid, days: Math.max(0, days), actDate: c.fd });
      });
      if (!uq.length) return { avgDays: 0, medDays: 0, min: 0, max: 0, byMonthData: [], byWeekData: [], distData: [] };
      const ds = uq.map(p => p.days).sort((a, b) => a - b);
      const avgDays = Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
      const medDays = ds[Math.floor(ds.length / 2)];
      const byM: Record<string, number[]> = {};
      uq.forEach(p => { const m = getMonth(p.actDate); if (!byM[m]) byM[m] = []; byM[m].push(p.days); });
      const byMonthData = Object.keys(byM).sort().map(m => ({ key: m, avg: Math.round(byM[m].reduce((a, b) => a + b, 0) / byM[m].length) }));
      const byW: Record<string, number[]> = {};
      uq.forEach(p => { const w = getWeek(p.actDate); if (!byW[w]) byW[w] = []; byW[w].push(p.days); });
      const byWeekData = Object.keys(byW).sort().map(w => ({ key: w, avg: Math.round(byW[w].reduce((a, b) => a + b, 0) / byW[w].length) }));
      const buckets = ["0", "1", "2", "3", "4-7", "8-14", "15-30", "30+"];
      function bkt(d: number) { if (d <= 3) return d; if (d <= 7) return 4; if (d <= 14) return 5; if (d <= 30) return 6; return 7; }
      const dist = Array(8).fill(0);
      ds.forEach(d => dist[bkt(d)]++);
      return { avgDays, medDays, min: ds[0], max: ds[ds.length - 1], byMonthData, byWeekData, distData: buckets.map((name, i) => ({ name, count: dist[i] })) };
    }

    // Geo & generation (from profiled customers)
    const profiledProfiles = profiledCustIds.map(id => profileMap.get(id)).filter(Boolean) as ProfileRow[];
    const geoCounts: Record<string, number> = {};
    profiledProfiles.forEach(p => { const c = countryToContinentKey(p.country); geoCounts[c] = (geoCounts[c] || 0) + 1; });
    const geoTotal = profiledProfiles.length || 1;
    const geoData = Object.entries(geoCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, value: Math.round(count / geoTotal * 100) }));

    const genCounts: Record<string, number> = {};
    profiledProfiles.forEach(p => { const g = birthYearToGenerationKey(p.date_of_birth); genCounts[g] = (genCounts[g] || 0) + 1; });
    const genTotal = profiledProfiles.length || 1;
    const genData = Object.entries(genCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, value: Math.round(count / genTotal * 100) }));

    // Registration rate denominator: unique customers
    const regRate = uniqueCustomers > 0 ? +((regCustIds.length / uniqueCustomers) * 100).toFixed(1) : 0;

    const regPctMoShop = regPctByMonthShop();

    return {
      custs, regC, nonRegC, uniqueCustomers, regCustIds, profiledCustIds, custsWithFeedback,
      satisfactionAvg, recommendationAvg, peaceOfMindAvg,
      totalRRP, totalSP, totalCovers,
      shops, shopVolume, shopRRP, shopCusts, shopRegCusts,
      WM, MM, wks, mos,
      catAll: catData(policies),
      catByShop: Object.fromEntries(shops.map(s => [s, catData(policies.filter(p => p.shop === s))])),
      retW, retM,
      rrpAvgWeekly: rrpAvgByPeriod(wks, getWeek),
      rrpAvgMonthly: rrpAvgByPeriod(mos, getMonth),
      regPctWeekly: regPctByPeriod(wks, WM, RBW),
      regPctMonthly: regPctByPeriod(mos, MM, RBM),
      regPctMoShop,
      ticketsAll: ticketBands(custs),
      ticketsByShop: Object.fromEntries(shops.map(s => [s, ticketBands(shopCusts[s])])),
      regTime: regTimeData(),
      regRate,
      feedbackCount: feedback.length,
      geoData, genData,
    };
  }, [policies, profiles, feedback]);
}

// ─── Tab definitions ─────────────────────────────────────────────────────────
type TabId = "ov" | "wk" | "mo" | "dd" | "rt";
const TAB_KEYS: { id: TabId; key: string }[] = [
  { id: "ov", key: "insights.tab.overview" },
  { id: "wk", key: "insights.tab.weekly" },
  { id: "mo", key: "insights.tab.monthly" },
  { id: "dd", key: "insights.tab.deepDive" },
  { id: "rt", key: "insights.tab.regTime" },
];

type T = (key: string) => string;

// ─── Main Component ──────────────────────────────────────────────────────────
export default function AdminInsights() {
  const { t, locale } = useLanguage();
  const [tab, setTab] = useState<TabId>("ov");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);

  // Raw data
  const [rawPolicies, setRawPolicies] = useState<ProcessedPolicy[]>([]);
  const [rawProfiles, setRawProfiles] = useState<ProfileRow[]>([]);
  const [rawFeedback, setRawFeedback] = useState<FeedbackRow[]>([]);
  const [brandName, setBrandName] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => {
    supabase.from("brands").select("id, name").eq("status", "verified").order("name")
      .then(({ data }) => setBrands((data as Brand[]) ?? []));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const brandFilter = selectedBrandId !== "all" ? selectedBrandId : null;

      // Fetch policies with shop name and category — paginate to avoid 1000-row limit
      async function fetchAllPolicies() {
        const all: any[] = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          let q = supabase
            .from("policies")
            .select("id, start_date, recommended_retail_price, selling_price, customer_id, shop_id, shops(name), catalogues(category, collection)")
            .eq("status", "live")
            .range(from, from + PAGE - 1);
          if (brandFilter) q = q.eq("brand_id", brandFilter);
          const { data, error } = await q;
          if (error) { console.error("policies error:", error); break; }
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      }

      // Fetch customer profiles — paginate
      async function fetchAllProfiles() {
        const all: any[] = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          let q = supabase
            .from("profiles")
            .select("id, registered_at, first_name, last_name, date_of_birth, country, city, postcode, address, province, nationality, phone_number, created_at")
            .eq("role", "customer")
            .range(from, from + PAGE - 1);
          if (brandFilter) q = q.eq("brand_id", brandFilter);
          const { data, error } = await q;
          if (error) { console.error("profiles error:", error); break; }
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      }

      // Fetch feedback (typically small, but paginate anyway)
      let fbQ = supabase.from("feedback").select("user_id, satisfaction_rate, peace_of_mind_rate, recommendation_rate");
      if (brandFilter) fbQ = fbQ.eq("brand_id", brandFilter);

      const [polData, profData, { data: fbData, error: fbErr }] = await Promise.all([
        fetchAllPolicies(), fetchAllProfiles(), fbQ,
      ]);
      if (fbErr) console.error("feedback error:", fbErr);

      // Build profile registration map
      const profileRegMap = new Map<string, string | null>();
      (profData as ProfileRow[]).forEach(p => profileRegMap.set(p.id, p.registered_at));

      // Transform policies
      const processed: ProcessedPolicy[] = (polData as any[]).map(p => ({
        id: p.id,
        date: p.start_date,
        rrp: Number(p.recommended_retail_price) || 0,
        sellingPrice: Number(p.selling_price) || 0,
        shop: p.shops?.name || `#${p.shop_id}`,
        customerId: p.customer_id,
        regDate: profileRegMap.get(p.customer_id) || null,
        category: (p.catalogues?.category || p.catalogues?.collection || "—").toUpperCase(),
      }));

      setRawPolicies(processed);
      setRawProfiles(profData as ProfileRow[]);
      setRawFeedback((fbData as FeedbackRow[]) ?? []);
      setBrandName(brandFilter ? brands.find(b => b.id === brandFilter)?.name || "" : "");
      setLastUpdated(new Date().toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "long", year: "numeric" }));
    } finally {
      setLoading(false);
    }
  }, [selectedBrandId, brands]);

  useEffect(() => {
    if (brands.length > 0 || selectedBrandId === "all") void loadData();
  }, [loadData, brands]);

  const d = useInsightsData(rawPolicies, rawProfiles, rawFeedback);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">{brandName || t("insights.allBrands")} — {t("insights.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("insights.subtitle")}
            {d && <> · {d.totalCovers} {t("insights.covers")} · {d.uniqueCustomers} {t("insights.uniqueClients")}</>}
            {lastUpdated && <> · {t("insights.updatedOn")} {lastUpdated}</>}
          </p>
        </div>
        <div className="relative">
          <select className={selectCls} value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">{t("insights.allBrands")}</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map(tk => (
          <button key={tk.id} onClick={() => setTab(tk.id)}
            className={`px-4 py-2 text-sm rounded-lg border transition-all ${tab === tk.id ? "bg-primary text-primary-foreground font-medium border-primary shadow-sm" : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"}`}>
            {t(tk.key)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
          </div>
          <ChartSkeleton /><ChartSkeleton />
        </div>
      ) : d ? (
        <>
          {tab === "ov" && <OverviewTab d={d} t={t} />}
          {tab === "wk" && <WeeklyTab d={d} t={t} />}
          {tab === "mo" && <MonthlyTab d={d} t={t} />}
          {tab === "dd" && <DeepDiveTab d={d} t={t} />}
          {tab === "rt" && <RegTimeTab d={d} t={t} />}
        </>
      ) : (
        <p className="text-muted-foreground text-sm py-8 text-center">{t("insights.noData")}</p>
      )}
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────
function OverviewTab({ d, t }: { d: NonNullable<ReturnType<typeof useInsightsData>>; t: T }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard label={t("insights.kpi.liveCovers")} value={d.totalCovers} />
        <KpiCard label={t("insights.kpi.uniqueClients")} value={d.uniqueCustomers} />
        <KpiCard label={t("insights.kpi.totalRRP")} value={`€${Math.round(d.totalRRP / 1000)}k`} />
        <KpiCard label={t("insights.kpi.sellingPrice")} value={`€${Math.round(d.totalSP / 1000)}k`} />
        <KpiCard label={t("insights.kpi.feedback")} value={d.satisfactionAvg ?? "—"} sub={`${d.feedbackCount} ${t("insights.kpi.reviews")}`} />
        <KpiCard label={t("insights.kpi.regRate")} value={`${d.regRate}%`} sub={`${d.regCustIds.length} ${t("insights.kpi.ofTotal")} ${d.uniqueCustomers}`} />
      </div>

      {d.shops.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title={t("insights.chart.volumeByShop")}>
            <ColorLegend items={d.shops.map(s => ({ color: COLORS[d.shops.indexOf(s)] || SLATE, label: `${s} ${d.shopVolume[s]} (${Math.round((d.shopVolume[s] || 0) / d.totalCovers * 100)}%)` }))} />
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={d.shops.map(s => ({ name: s, value: Math.round((d.shopVolume[s] || 0) / d.totalCovers * 100) }))}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {d.shops.map((_, i) => <Cell key={i} fill={COLORS[i] || SLATE} />)}
                  <LabelList dataKey="value" content={({ x, y, value }: any) => {
                    if (!value || value < 10) return null;
                    return <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontWeight="bold" fontSize={13}>{value}%</text>;
                  }} />
                </Pie>
                <Tooltip content={<CTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title={t("insights.chart.rrpByShop")}>
            <ColorLegend items={d.shops.map(s => ({ color: COLORS[d.shops.indexOf(s)] || SLATE, label: `${s} €${Math.round((d.shopRRP[s] || 0) / 1000)}k (${Math.round((d.shopRRP[s] || 0) / d.totalRRP * 100)}%)` }))} />
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={d.shops.map(s => ({ name: s, value: Math.round((d.shopRRP[s] || 0) / d.totalRRP * 100) }))}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {d.shops.map((_, i) => <Cell key={i} fill={COLORS[i] || SLATE} />)}
                  <LabelList dataKey="value" content={({ x, y, value }: any) => {
                    if (!value || value < 10) return null;
                    return <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontWeight="bold" fontSize={13}>{value}%</text>;
                  }} />
                </Pie>
                <Tooltip content={<CTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      <CategoryChart title={t("insights.chart.catTotal")} data={d.catAll} t={t} />
      {d.shops.map(s => (
        <CategoryChart key={s} title={`${t("insights.chart.catByShop")} ${s}`} data={d.catByShop[s] || []} t={t} />
      ))}
    </div>
  );
}

function CategoryChart({ title, data, t }: { title: string; data: { cat: string; vol: number; rrpk: number; volPct: number; rrpPct: number }[]; t: T }) {
  if (!data.length) return null;
  return (
    <ChartCard title={title}>
      <ColorLegend items={[
        { color: C1, label: `${t("insights.label.volume")} (%)` },
        { color: C2, label: "RRP €k (%)" },
      ]} />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="cat" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `€${v}k`} />
          <Tooltip content={<CTooltip />} />
          <Bar yAxisId="left" dataKey="vol" fill={C1} radius={[6, 6, 0, 0]} name={t("insights.label.volume")}>
            <LabelList dataKey="volPct" content={({ x, y, width, height, value }: any) => {
              if (!value || value < 5) return null; const inside = height > 24;
              return <text x={x + width / 2} y={inside ? y + height / 2 : y - 10} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "hsl(0 0% 35%)"} fontSize={12} fontWeight={600}>{value}%</text>;
            }} />
          </Bar>
          <Line yAxisId="right" type="monotone" dataKey="rrpk" stroke={C2} strokeWidth={2.5} dot={{ fill: C2, r: 4, strokeWidth: 2, stroke: "#fff" }} name="RRP €k">
            <LabelList dataKey="rrpPct" content={({ x, y, value }: any) => {
              if (value === undefined || value === null || value < 5) return null;
              return <text x={x} y={y - 16} textAnchor="middle" fill={C2} fontSize={11} fontWeight={600}>{value}%</text>;
            }} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Weekly ──────────────────────────────────────────────────────────────────
function WeeklyTab({ d, t }: { d: NonNullable<ReturnType<typeof useInsightsData>>; t: T }) {
  const wkVol = d.wks.map(w => ({ key: w, v: d.WM[w].v }));
  const wkRRP = d.wks.map(w => ({ key: w, v: Math.round(d.WM[w].r / 1000) }));
  const wkShopVol = d.wks.map(w => {
    const row: any = { key: w };
    d.shops.forEach(s => row[s] = d.WM[w].shopV[s] || 0);
    return row;
  });
  const wkShopRRP = d.wks.map(w => {
    const row: any = { key: w };
    d.shops.forEach(s => row[s] = Math.round((d.WM[w].shopR[s] || 0) / 1000));
    return row;
  });
  const wkRet = d.wks.map(w => ({ key: w, nuovi: d.retW[w].nov, tornano: d.retW[w].ret }));

  const SHOP_COLORS = COLORS;

  return (
    <div className="space-y-5">
      <ChartCard title={t("insights.chart.weeklyCov")}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={wkVol}>
            <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="v" fill={PU} radius={[6, 6, 0, 0]} name={t("insights.label.covers")}><LabelList dataKey="v" content={SimpleBarLabel} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t("insights.chart.weeklyRRP")}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={wkRRP}>
            <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="v" fill={GR} radius={[6, 6, 0, 0]} name="RRP €k">
              <LabelList dataKey="v" content={({ x, y, width, height, value }: any) => {
                if (!value) return null; const inside = height > 20;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#555"} fontSize={11} fontWeight={600}>{value}k</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {d.shops.length >= 2 && (
        <>
          <ChartCard title={t("insights.chart.volByShopWeekly")}>
            <ColorLegend items={d.shops.map((s, i) => ({ color: SHOP_COLORS[i] || SLATE, label: s }))} />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={wkShopVol}>
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
                {d.shops.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="s" fill={SHOP_COLORS[i] || SLATE} radius={i === d.shops.length - 1 ? [2, 2, 0, 0] : undefined} name={s}>
                    <LabelList dataKey={s} content={StackLabel} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("insights.chart.rrpByShopWeekly")}>
            <ColorLegend items={d.shops.map((s, i) => ({ color: SHOP_COLORS[i] || SLATE, label: s }))} />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={wkShopRRP}>
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
                {d.shops.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="s" fill={SHOP_COLORS[i] || SLATE} name={s}>
                    <LabelList dataKey={s} content={({ x, y, width, height, value }: any) => {
                      if (!value || height < 18) return null;
                      return <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={11} fontWeight={600}>{value}k</text>;
                    }} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}

      <ChartCard title={t("insights.chart.avgRRPclient")}>
        <ColorLegend items={[{ color: GR, label: t("insights.label.registered") }, { color: GY, label: t("insights.label.notRegistered") }]} />
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={d.rrpAvgWeekly}>
            <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="reg" fill={GR} radius={[6, 6, 0, 0]} name={t("insights.label.registered")}>
              <LabelList dataKey="reg" content={({ x, y, width, height, value }: any) => {
                if (value === null) return null; const inside = height > 16;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={9} fontWeight="bold">{value}k</text>;
              }} />
            </Bar>
            <Bar dataKey="nonReg" fill={GY} radius={[6, 6, 0, 0]} name={t("insights.label.nonReg")}>
              <LabelList dataKey="nonReg" content={({ x, y, width, height, value }: any) => {
                if (value === null) return null; const inside = height > 16;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={9} fontWeight="bold">{value}k</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ReturnChart title={t("insights.chart.clientsWeek")} data={wkRet} rotateX t={t} />
      {d.shops.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.shops.map(s => (
            <ReturnChart key={s} title={`${t("insights.chart.clientsWeekShop")} ${s}`}
              data={d.wks.map(w => ({ key: w, nuovi: d.retW[w].shopNov[s] || 0, tornano: d.retW[w].shopRet[s] || 0 }))} rotateX height={220} t={t} />
          ))}
        </div>
      )}

      <ChartCard title={t("insights.chart.regPctWeekly")}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={d.regPctWeekly}>
            <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}%`} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="pct" fill={AM} radius={[6, 6, 0, 0]} name="%">
              <LabelList dataKey="pct" content={({ x, y, width, height, value }: any) => {
                if (!value) return null; const inside = height > 20;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight={600}>{value}%</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ─── Monthly ─────────────────────────────────────────────────────────────────
function MonthlyTab({ d, t }: { d: NonNullable<ReturnType<typeof useInsightsData>>; t: T }) {
  const moVol = d.mos.map(m => ({ key: m, v: d.MM[m].v }));
  const moRRP = d.mos.map(m => ({ key: m, v: Math.round(d.MM[m].r / 1000) }));
  const moShopVol = d.mos.map(m => {
    const row: any = { key: m };
    d.shops.forEach(s => row[s] = d.MM[m].shopV[s] || 0);
    return row;
  });
  const moShopRRP = d.mos.map(m => {
    const row: any = { key: m };
    d.shops.forEach(s => row[s] = Math.round((d.MM[m].shopR[s] || 0) / 1000));
    return row;
  });
  const moRet = d.mos.map(m => ({ key: m, nuovi: d.retM[m].nov, tornano: d.retM[m].ret }));

  const SHOP_COLORS = COLORS;

  return (
    <div className="space-y-5">
      <ChartCard title={t("insights.chart.monthlyCov")}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={moVol}>
            <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="v" fill={PU} radius={[6, 6, 0, 0]} name={t("insights.label.covers")}><LabelList dataKey="v" content={SimpleBarLabel} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t("insights.chart.monthlyRRP")}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={moRRP}>
            <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="v" fill={GR} radius={[6, 6, 0, 0]} name="RRP €k">
              <LabelList dataKey="v" content={({ x, y, width, height, value }: any) => {
                if (!value) return null; const inside = height > 20;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#555"} fontSize={11} fontWeight={600}>{value}k</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {d.shops.length >= 2 && (
        <>
          <ChartCard title={t("insights.chart.volByShopMonthly")}>
            <ColorLegend items={d.shops.map((s, i) => ({ color: SHOP_COLORS[i] || SLATE, label: s }))} />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={moShopVol}>
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
                {d.shops.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="s" fill={SHOP_COLORS[i] || SLATE} name={s}><LabelList dataKey={s} content={StackLabel} /></Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("insights.chart.rrpByShopMonthly")}>
            <ColorLegend items={d.shops.map((s, i) => ({ color: SHOP_COLORS[i] || SLATE, label: s }))} />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={moShopRRP}>
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
                {d.shops.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="s" fill={SHOP_COLORS[i] || SLATE} name={s}>
                    <LabelList dataKey={s} content={({ x, y, width, height, value }: any) => {
                      if (!value || height < 18) return null;
                      return <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={11} fontWeight={600}>{value}k</text>;
                    }} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}

      <ChartCard title={t("insights.chart.avgRRPclientMonthly")}>
        <ColorLegend items={[{ color: GR, label: t("insights.label.registered") }, { color: GY, label: t("insights.label.notRegistered") }]} />
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={d.rrpAvgMonthly}>
            <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="reg" fill={GR} radius={[6, 6, 0, 0]} name={t("insights.label.registered")}>
              <LabelList dataKey="reg" content={({ x, y, width, height, value }: any) => {
                if (value === null) return null; const inside = height > 18;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight={600}>{value}k</text>;
              }} />
            </Bar>
            <Bar dataKey="nonReg" fill={GY} radius={[6, 6, 0, 0]} name={t("insights.label.nonReg")}>
              <LabelList dataKey="nonReg" content={({ x, y, width, height, value }: any) => {
                if (value === null) return null; const inside = height > 18;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight={600}>{value}k</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ReturnChart title={t("insights.chart.clientsMonth")} data={moRet} t={t} />
      {d.shops.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.shops.map(s => (
            <ReturnChart key={s} title={`${t("insights.chart.clientsMonthShop")} ${s}`}
              data={d.mos.map(m => ({ key: m, nuovi: d.retM[m].shopNov[s] || 0, tornano: d.retM[m].shopRet[s] || 0 }))} height={220} t={t} />
          ))}
        </div>
      )}

      <ChartCard title={t("insights.chart.regPctMonthly")}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={d.regPctMonthly}>
            <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}%`} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="pct" fill={AM} radius={[6, 6, 0, 0]} name="%">
              <LabelList dataKey="pct" content={({ x, y, width, height, value }: any) => {
                if (!value) return null; const inside = height > 20;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight={600}>{value}%</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {d.shops.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.shops.map((s, si) => {
            const data = d.regPctMoShop.mos.map(m => ({
              key: m,
              pct: (d.regPctMoShop.novByShop[s]?.[m] || 0) > 0
                ? Math.round((d.regPctMoShop.regNovByShop[s]?.[m] || 0) / d.regPctMoShop.novByShop[s][m] * 100) : 0,
            }));
            return (
              <ChartCard key={s} title={`${t("insights.chart.regPctMonthShop")}${s}${t("insights.chart.regPctMonthShopSuffix")}`}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data}>
                    <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}%`} /><Tooltip content={<CTooltip />} />
                    <Bar dataKey="pct" fill={COLORS[si] || SLATE} radius={[6, 6, 0, 0]} name={`% ${s}`}>
                      <LabelList dataKey="pct" content={({ x, y, width, height, value }: any) => {
                        if (!value) return null; const inside = height > 20;
                        return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight={600}>{value}%</text>;
                      }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Return Chart (shared) ───────────────────────────────────────────────────
function ReturnChart({ title, data, rotateX, height = 240, t }: {
  title: string; data: { key: string; nuovi: number; tornano: number }[]; rotateX?: boolean; height?: number; t: T;
}) {
  return (
    <ChartCard title={title}>
      <ColorLegend items={[{ color: GR, label: t("insights.label.new") }, { color: AM, label: t("insights.label.returning") }]} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
          <XAxis dataKey="key" tick={{ fontSize: rotateX ? 9 : 11 }} angle={rotateX ? -45 : 0} textAnchor={rotateX ? "end" : "middle"} height={rotateX ? 60 : 30} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
          <Bar dataKey="nuovi" stackId="s" fill={GR} name={t("insights.label.new")}><LabelList dataKey="nuovi" content={StackLabel} /></Bar>
          <Bar dataKey="tornano" stackId="s" fill={AM} radius={[6, 6, 0, 0]} name={t("insights.label.returning")}><LabelList dataKey="tornano" content={StackLabel} /></Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Deep Dive ───────────────────────────────────────────────────────────────
function DeepDiveTab({ d, t }: { d: NonNullable<ReturnType<typeof useInsightsData>>; t: T }) {
  const regAvgRRP = d.regC.length ? Math.round(d.regC.reduce((s, c) => s + c.rrp, 0) / d.regC.length / 1000) : 0;
  const nonAvgRRP = d.nonRegC.length ? Math.round(d.nonRegC.reduce((s, c) => s + c.rrp, 0) / d.nonRegC.length / 1000) : 0;
  const regAvgCov = d.regC.length ? +(d.regC.reduce((s, c) => s + c.np, 0) / d.regC.length).toFixed(1) : 0;
  const nonAvgCov = d.nonRegC.length ? +(d.nonRegC.reduce((s, c) => s + c.np, 0) / d.nonRegC.length).toFixed(1) : 0;

  const funnelData = [
    { name: `Clienti unici (${d.uniqueCustomers})`, value: d.uniqueCustomers, fill: PU },
    { name: `Registrati (${d.regCustIds.length})`, value: d.regCustIds.length, fill: GR },
    { name: `Profilo completo (${d.profiledCustIds.length})`, value: d.profiledCustIds.length, fill: BL },
    { name: `Con feedback (${d.custsWithFeedback.length})`, value: d.custsWithFeedback.length, fill: AM },
  ];

  const PIE_COLORS = COLORS;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <KpiCard label={t("insights.kpi.uniqueClients")} value={d.uniqueCustomers} />
        <KpiCard label={t("insights.kpi.registered")} value={d.regCustIds.length} sub={`${d.regRate}%`} />
        <KpiCard label={t("insights.kpi.fullProfile")} value={d.profiledCustIds.length} sub={d.regCustIds.length ? `${Math.round(d.profiledCustIds.length / d.regCustIds.length * 100)}% ${t("insights.kpi.ofReg")}` : "—"} />
        <KpiCard label={t("insights.kpi.withFeedback")} value={d.custsWithFeedback.length} sub={d.regCustIds.length ? `${Math.round(d.custsWithFeedback.length / d.regCustIds.length * 100)}% ${t("insights.kpi.ofReg")}` : "—"} />
        <KpiCard label={t("insights.kpi.satisfaction")} value={d.satisfactionAvg ?? "—"} />
        <KpiCard label={t("insights.kpi.recommendation")} value={d.recommendationAvg ?? "—"} />
        <KpiCard label={t("insights.kpi.peaceOfMind")} value={d.peaceOfMindAvg ?? "—"} />
      </div>

      <ChartCard title={t("insights.chart.funnel")}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={funnelData} layout="vertical">
            <XAxis type="number" domain={[0, Math.ceil(d.uniqueCustomers * 1.15)]} tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} width={180} />
            <Tooltip content={<CTooltip />} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} name={t("insights.label.clients")}>
              {funnelData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              <LabelList dataKey="value" position="right" fill="#333" fontSize={12} fontWeight="bold"
                formatter={(v: number) => `${v} (${d.uniqueCustomers > 0 ? Math.round(v / d.uniqueCustomers * 100) : 0}%)`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {d.shops.length >= 2 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PctBarChart title={t("insights.chart.regByShop")}
              data={d.shops.map(s => ({ name: s, pct: (d.shopCusts[s]?.length || 0) > 0 ? Math.round((d.shopRegCusts[s]?.length || 0) / d.shopCusts[s].length * 100) : 0 }))}
              colors={d.shops.map((_, i) => COLORS[i] || SLATE)} yMax={Math.max(40, ...d.shops.map(s => Math.round((d.shopRegCusts[s]?.length || 0) / (d.shopCusts[s]?.length || 1) * 100) + 10))} />
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title={t("insights.chart.rrpByType")}>
          <ColorLegend items={[{ color: GR, label: t("insights.label.registered") }, { color: GY, label: t("insights.label.notRegistered") }]} />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={[{ name: t("insights.label.registered"), v: regAvgRRP }, { name: t("insights.label.notRegistered"), v: nonAvgRRP }]}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
              <Bar dataKey="v" radius={[6, 6, 0, 0]} name="€k">
                {[GR, GY].map((c, i) => <Cell key={i} fill={c} />)}
                <LabelList dataKey="v" content={({ x, y, width, height, value }: any) => {
                  if (!value) return null; const inside = height > 20;
                  return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight="bold">€{value}k</text>;
                }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t("insights.chart.avgCoversPerClient")}>
          <ColorLegend items={[{ color: GR, label: t("insights.label.registered") }, { color: GY, label: t("insights.label.notRegistered") }]} />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={[{ name: t("insights.label.registered"), v: regAvgCov }, { name: t("insights.label.notRegistered"), v: nonAvgCov }]}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
              <Bar dataKey="v" radius={[6, 6, 0, 0]} name={t("insights.label.covers2")}>
                {[GR, GY].map((c, i) => <Cell key={i} fill={c} />)}
                <LabelList dataKey="v" content={SimpleBarLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {d.shops.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.shops.map((s, si) => {
            const regArr = d.shopRegCusts[s] || [];
            const nonArr = (d.shopCusts[s] || []).filter(c => !c.reg);
            const rAvg = regArr.length ? Math.round(regArr.reduce((a, c) => a + c.rrp, 0) / regArr.length / 1000) : 0;
            const nAvg = nonArr.length ? Math.round(nonArr.reduce((a, c) => a + c.rrp, 0) / nonArr.length / 1000) : 0;
            return (
              <ChartCard key={s} title={`${t("insights.chart.rrpByShopDetail")} ${s} (€k)`}>
                <ColorLegend items={[{ color: GR, label: t("insights.label.registered") }, { color: GY, label: t("insights.label.notRegistered") }]} />
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={[{ name: t("insights.label.registered"), v: rAvg }, { name: t("insights.label.notRegistered"), v: nAvg }]}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}k`} /><Tooltip content={<CTooltip />} />
                    <Bar dataKey="v" radius={[6, 6, 0, 0]} name="€k">
                      {[GR, GY].map((c, i) => <Cell key={i} fill={c} />)}
                      <LabelList dataKey="v" content={({ x, y, width, height, value }: any) => {
                        if (!value) return null; const inside = height > 20;
                        return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight="bold">€{value}k</text>;
                      }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            );
          })}
        </div>
      )}

      <TicketBandChart title={t("insights.chart.ticketBandTotal")} data={d.ticketsAll} t={t} />
      {d.shops.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.shops.map(s => (
            <TicketBandChart key={s} title={`${t("insights.chart.ticketBandShop")} ${s}`} data={d.ticketsByShop[s] || []} t={t} />
          ))}
        </div>
      )}

      {(d.geoData.length > 0 || d.genData.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.geoData.length > 0 && (
            <ChartCard title={t("insights.chart.geoDistribution")}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={d.geoData.map(g => ({ ...g, name: t(g.name) }))} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={3}>
                    {d.geoData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    <LabelList dataKey="value" content={({ x, y, value }: any) => {
                    if (!value || value < 10) return null;
                    return <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontWeight="bold" fontSize={13}>{value}%</text>;
                  }} />
                  </Pie>
                  <Tooltip content={<CTooltip />} /><Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {d.genData.length > 0 && (
            <ChartCard title={t("insights.chart.genDistribution")}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={d.genData.map(g => ({ ...g, name: t(g.name) }))} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" paddingAngle={3}>
                    {d.genData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    <LabelList dataKey="value" content={({ x, y, value }: any) => {
                    if (!value || value < 10) return null;
                    return <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontWeight="bold" fontSize={13}>{value}%</text>;
                  }} />
                  </Pie>
                  <Tooltip content={<CTooltip />} /><Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}

function PctBarChart({ title, data, colors, yMax = 100 }: { title: string; data: { name: string; pct: number }[]; colors: string[]; yMax?: number }) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis domain={[0, yMax]} tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}%`} /><Tooltip content={<CTooltip />} />
          <Bar dataKey="pct" radius={[6, 6, 0, 0]} name="%">
            {data.map((_, i) => <Cell key={i} fill={colors[i] || GY} />)}
            <LabelList dataKey="pct" content={({ x, y, width, height, value }: any) => {
              if (!value) return null; const inside = height > 20;
              return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight="bold">{value}%</text>;
            }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function TicketBandChart({ title, data, t }: { title: string; data: { name: string; pct: number; reg: number; tot: number }[]; t: T }) {
  if (!data.length) return null;
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={270}>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis domain={[0, 60]} tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} tickFormatter={v => `${v}%`} />
          <Tooltip formatter={(v: number, _: any, entry: any) => [`${entry.payload.reg}/${entry.payload.tot} (${v}%)`, t("insights.label.pctRegistered")]} />
          <Bar dataKey="pct" fill={GR} radius={[6, 6, 0, 0]} name={t("insights.label.pctRegistered")}>
            <LabelList dataKey="pct" content={({ x, y, width, height, value }: any) => {
              if (!value) return null; const inside = height > 20;
              return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#333"} fontSize={11} fontWeight={600}>{value}%</text>;
            }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Registration Time ───────────────────────────────────────────────────────
function RegTimeTab({ d, t }: { d: NonNullable<ReturnType<typeof useInsightsData>>; t: T }) {
  const rt = d.regTime;
  if (!rt.byMonthData.length && !rt.byWeekData.length) {
    return <p className="text-muted-foreground text-sm py-8 text-center">Nessun dato di registrazione disponibile.</p>;
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiCard label={t("insights.kpi.avgDays")} value={rt.avgDays} />
        <KpiCard label={t("insights.kpi.medianDays")} value={rt.medDays} />
        <KpiCard label={t("insights.kpi.min")} value={rt.min} />
        <KpiCard label={t("insights.kpi.max")} value={rt.max} />
      </div>

      <ChartCard title={t("insights.chart.avgDaysByMonth")}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rt.byMonthData}>
            <XAxis dataKey="key" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="avg" fill={PU} radius={[6, 6, 0, 0]} name={t("insights.label.days")}>
              <LabelList dataKey="avg" content={({ x, y, width, height, value }: any) => {
                if (!value) return null; const inside = height > 20;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#555"} fontSize={11} fontWeight={600}>{value}g</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t("insights.chart.avgDaysByWeek")}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rt.byWeekData}>
            <XAxis dataKey="key" tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }} angle={-45} textAnchor="end" height={60} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="avg" fill={BL} radius={[6, 6, 0, 0]} name={t("insights.label.days")}>
              <LabelList dataKey="avg" content={({ x, y, width, height, value }: any) => {
                if (!value) return null; const inside = height > 20;
                return <text x={x + width / 2} y={inside ? y + height / 2 : y - 6} textAnchor="middle" dominantBaseline={inside ? "middle" : "auto"} fill={inside ? "#fff" : "#555"} fontSize={11} fontWeight={600}>{value}g</text>;
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t("insights.chart.regDaysDist")}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rt.distData}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><YAxis tick={{ fontSize: 11, fill: "hsl(0 0% 45%)" }} /><Tooltip content={<CTooltip />} />
            <Bar dataKey="count" fill={GR} radius={[6, 6, 0, 0]} name={t("insights.label.clients")}><LabelList dataKey="count" content={SimpleBarLabel} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
