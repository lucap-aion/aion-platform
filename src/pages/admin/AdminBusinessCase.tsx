import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Download, AlertTriangle, Calculator } from "lucide-react";

// Step 4 of the commercial cycle: the pricing conversation.
//
// The model lives in compute_business_case (it mirrors the Ferragamo dataroom,
// so the numbers reconcile with what clients have already been shown). This is
// the perimeter that feeds it — declared once, adjusted a few times, then turned
// into a deck.
//
// The one thing this screen must never do is quietly present another house's
// insurer quote as if it were this brand's. When a rate is borrowed it says so,
// on screen and on the slide.

type Brand = { id: number; name: string | null };
type Segment = {
  name: string; category: string;
  revenues: string; cogs_ratio: string; avg_price: string; start_month: string;
};

const CATEGORIES = ["jewellery", "watches", "bags", "apparel", "leather", "other"];

const emptySegment = (): Segment => ({
  name: "", category: "jewellery", revenues: "", cogs_ratio: "0.30", avg_price: "", start_month: "1",
});

const eur = (n: unknown) =>
  typeof n === "number" ? `€${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}` : "—";
const pct = (n: unknown, digits = 2) =>
  typeof n === "number" ? `${(n * 100).toFixed(digits)}%` : "—";

export default function AdminBusinessCase() {
  const { toast } = useToast();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [months, setMonths] = useState("36");
  const [setupDiscount, setSetupDiscount] = useState(true);
  const [includeApi, setIncludeApi] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([emptySegment()]);
  const [busy, setBusy] = useState<null | "preview" | "deck">(null);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [deck, setDeck] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("brands").select("id, name").order("name");
      const list = (data ?? []) as Brand[];
      setBrands(list);
      setBrandId((cur) => cur ?? list[0]?.id ?? null);
    })();
  }, []);

  const payloadSegments = useMemo(() =>
    segments
      .filter((s) => s.name.trim() && Number(s.revenues) > 0)
      .map((s) => ({
        name: s.name.trim(),
        category: s.category,
        revenues: Number(s.revenues),
        cogs_ratio: Number(s.cogs_ratio) || 0.3,
        avg_price: Number(s.avg_price) || undefined,
        start_month: Number(s.start_month) || 1,
      })),
  [segments]);

  const call = async (extra: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("build-collateral", {
      body: {
        brand_id: brandId, kind: "business_case",
        months: Number(months) || 36,
        setup_discounted: setupDiscount,
        include_api: includeApi,
        segments: payloadSegments,
        ...extra,
      },
    });
    if (error) throw new Error(error.message);
    const d = data as Record<string, any>;
    if (d?.error) throw new Error(d.error);
    return d;
  };

  const calculate = async () => {
    if (!payloadSegments.length) { toast({ title: "Add a segment with a name and covered revenue first.", variant: "destructive" }); return; }
    setBusy("preview"); setDeck(null);
    try {
      const out = await call({ preview: true });
      if (out.ok === false) { toast({ title: "Cannot price this yet", description: out.reason, variant: "destructive" }); setResult(null); return; }
      setResult(out.business_case);
    } catch (e) {
      toast({ title: "Calculation failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const buildDeck = async () => {
    setBusy("deck");
    try {
      const out = await call({});
      if (out.ok === false) { toast({ title: "Cannot build the deck", description: out.reason, variant: "destructive" }); return; }
      setResult(out.business_case ?? result);
      setDeck({ url: String(out.download_url ?? ""), name: String(out.file_name ?? "business case.pptx") });
      toast({ title: "Deck ready" });
    } catch (e) {
      toast({ title: "Deck failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const setSeg = (i: number, patch: Partial<Segment>) =>
    setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const fees = result?.aion_fees ?? {};
  const pp = result?.per_product ?? {};

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-foreground">Business case</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Price a programme from the perimeter the client declared. Figures are a model, not an offer —
          the formal insurer quotation governs.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Brand
          <select value={brandId ?? ""} onChange={(e) => setBrandId(Number(e.target.value) || null)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name ?? `Brand ${b.id}`}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Months modelled
          <input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric"
            className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={setupDiscount} onChange={(e) => setSetupDiscount(e.target.checked)} />
          Setup discounted
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={includeApi} onChange={(e) => setIncludeApi(e.target.checked)} />
          Include API fee
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Perimeter</h2>
          <button onClick={() => setSegments((p) => [...p, emptySegment()])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add segment
          </button>
        </div>

        <div className="grid grid-cols-12 gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className="col-span-3">Segment</span>
          <span className="col-span-2">Category</span>
          <span className="col-span-2">Covered revenue €</span>
          <span className="col-span-2">COGS ratio</span>
          <span className="col-span-2">Avg price €</span>
          <span className="col-span-1">Start m.</span>
        </div>

        {segments.map((s, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <input className="col-span-3 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="Pilot — EU" value={s.name} onChange={(e) => setSeg(i, { name: e.target.value })} />
            <select className="col-span-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={s.category} onChange={(e) => setSeg(i, { category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="col-span-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="numeric" placeholder="12000000" value={s.revenues} onChange={(e) => setSeg(i, { revenues: e.target.value })} />
            <input className="col-span-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="decimal" value={s.cogs_ratio} onChange={(e) => setSeg(i, { cogs_ratio: e.target.value })} />
            <input className="col-span-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="numeric" placeholder="4200" value={s.avg_price} onChange={(e) => setSeg(i, { avg_price: e.target.value })} />
            <div className="col-span-1 flex items-center gap-1">
              <input className="w-12 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="numeric" value={s.start_month} onChange={(e) => setSeg(i, { start_month: e.target.value })} />
              {segments.length > 1 && (
                <button onClick={() => setSegments((p) => p.filter((_, j) => j !== i))}
                  className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove segment">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="flex gap-2 pt-1">
          <button onClick={() => void calculate()} disabled={busy !== null || !brandId}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate
          </button>
          <button onClick={() => void buildDeck()} disabled={busy !== null || !result}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">
            {busy === "deck" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Build deck
          </button>
          {deck && (
            <a href={deck.url} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Download className="h-4 w-4" /> {deck.name}
            </a>
          )}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          {result.indicative && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Indicative pricing.</strong> At least one rate below was quoted for a different house.
                Showing it is a commercial decision — the slide carries the same warning.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            {[
              ["Covered revenue", eur(result.revenues_covered)],
              ["Gross premium", eur(result.gross_premium)],
              ["AION fees", eur(fees.total)],
              ["Cost to the brand", eur(result.total_cost_to_brand)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="font-serif text-xl font-bold text-foreground">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Per piece</h3>
              {pp.total ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>Insurer <span className="text-foreground">{eur(pp.insurer_fee)}</span></li>
                  <li>AION <span className="text-foreground">{eur(pp.aion_fee)}</span></li>
                  <li>Total <span className="text-foreground">{eur(pp.total)}</span> — {pct(pp.total_pct_of_price)} of retail ({pct(pp.total_pct_of_price_incl_vat)} incl. VAT)</li>
                </ul>
              ) : <p className="text-sm text-muted-foreground">Add an average price per segment for per-piece figures.</p>}
            </div>

            <div className="rounded-xl border border-border p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">AION</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Tier <span className="text-foreground">{fees.tier ?? "—"}</span> on covered GMV</li>
                <li>Setup <span className="text-foreground">{eur(fees.setup)}</span> · Service <span className="text-foreground">{eur(fees.service)}</span> · Activation <span className="text-foreground">{eur(fees.activation)}</span></li>
                <li>Revenue over the period <span className="text-foreground">{eur(result.aion_total_revenue)}</span></li>
                {fees.service_note && <li className="text-amber-600">{fees.service_note}</li>}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Where these rates come from</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(result.rates_used ?? []).map((r: any, i: number) => (
                <li key={i}>
                  <span className="text-foreground">{r.category}</span> — {pct(r.rate_of_cogs)} of COGS · {r.insurer}
                  {r.quoted_for ? `, quoted for ${r.quoted_for}` : ""}{r.quoted_at ? ` (${r.quoted_at})` : ""}
                  {r.own_quote ? "" : <span className="ml-1 font-medium text-amber-600">— indicative</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
