import { ShoppingBag } from "lucide-react";
import { format } from "date-fns";

// The client's purchases card, shared by the brand and admin client pages so
// both show the same numbers.

const eur = (n: number) => `€${Math.round(n).toLocaleString()}`;

const fmt = (d: string | null) =>
  d ? format(new Date(d), "MMM dd, yyyy") : "—";

// The day a cover started, on the boutiques' calendar — the same day
// brand_customer_segments counts visits on, so the card and the VIP chip agree.
const romeDay = (d: string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });

export type CoverForStats = {
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

export default function PurchasesCard({ covers, claimsCount }: { covers: CoverForStats[]; claimsCount: number }) {
  const stats = purchaseStats(covers);
  return (
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
          <p className="text-lg font-semibold text-foreground tabular-nums">{fmt(stats.last)}</p>
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
          <p className="text-lg font-semibold text-foreground tabular-nums">{claimsCount}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">Protected value (live covers)</p>
          <p className="text-lg font-semibold text-foreground tabular-nums">{eur(stats.protectedValue)}</p>
        </div>
      </div>
    </div>
  );
}
