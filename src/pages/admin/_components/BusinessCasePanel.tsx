import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
// The standalone `toast`, not `useToast().toast`: the hook returns a fresh
// object every render, so a fetcher that lists it as a dependency re-runs on
// every render — which for a fetcher that sets a loading flag is an infinite
// loop that never leaves the spinner. This one is module-scoped and stable.
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Download, AlertTriangle, Calculator, ChevronDown, ChevronRight } from "lucide-react";
import InsurerQuotes from "./InsurerQuotes";
import { CATEGORIES, COVERAGES, DAMAGE_SCOPES, type BusinessCase, type Quote, type RateUsed } from "./pricing-model";

// Step 4 of the commercial cycle: the pricing conversation.
//
// The model lives in compute_business_case (it mirrors the Ferragamo dataroom,
// so the numbers reconcile with what clients have already been shown). This is
// the perimeter that feeds it — declared once, adjusted a few times, then turned
// into a deck.
//
// Two things this screen must never do. It must not quietly present another
// house's insurer quote as if it were this brand's — that is why provenance is
// on screen and on the slide. And it must not show figures that no longer match
// the inputs above them: the previous version left the result cards standing
// while you edited the perimeter, and left "Build deck" enabled, so the deck
// could be built from numbers nobody had looked at.

// What build-collateral answers with, for both the preview and the deck build.
type CollateralResponse = {
  ok?: boolean; error?: string; reason?: string;
  business_case?: BusinessCase;
  download_url?: string; file_name?: string;
};

type Segment = {
  name: string; category: string; coverage: string; damage_scope: string;
  revenues: string; cogs_ratio: string; avg_price: string; start_month: string;
};

const emptySegment = (): Segment => ({
  name: "", category: "jewellery", coverage: "theft_and_damage", damage_scope: "",
  revenues: "", cogs_ratio: "0.30", avg_price: "", start_month: "1",
});

const eur = (n: unknown) =>
  typeof n === "number" ? `€${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}` : "—";
const eur2 = (n: unknown) =>
  typeof n === "number" ? `€${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}` : "—";
const pct = (n: unknown, digits = 2) =>
  typeof n === "number" ? `${(n * 100).toFixed(digits)}%` : "—";

export default function BusinessCasePanel({ brandId, brands, onArtifact }: {
  brandId: number | null;
  brands: { id: number; name: string | null }[];
  onArtifact?: () => void;
}) {
  const [months, setMonths] = useState("36");
  const [setupDiscount, setSetupDiscount] = useState(true);
  const [includeApi, setIncludeApi] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([emptySegment()]);
  const [busy, setBusy] = useState<null | "preview" | "deck">(null);
  const [result, setResult] = useState<BusinessCase | null>(null);
  const [deck, setDeck] = useState<{ url: string; name: string } | null>(null);
  const [showQuotes, setShowQuotes] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);

  // Which categories can actually be priced, so the answer arrives before the
  // Calculate button rather than as a failure out of it.
  const loadQuotes = useCallback(async () => {
    const { data } = await untyped.from("insurance_quotes")
      .select("category, coverage, damage_scope, rate_of_cogs, brand_id, quoted_for, quoted_at, id, insurer, gmv_from, gmv_to, active")
      .eq("active", true);
    setQuotes((data ?? []) as unknown as Quote[]);
  }, []);
  useEffect(() => { void loadQuotes(); }, [loadQuotes]);

  // Any change to the inputs invalidates what is on screen. Keeping stale
  // figures visible next to edited inputs is how a wrong number gets read out.
  const inputs = useMemo(
    () => JSON.stringify({ brandId, months, setupDiscount, includeApi, segments }),
    [brandId, months, setupDiscount, includeApi, segments],
  );
  const computedFor = useRef<string | null>(null);
  useEffect(() => {
    if (computedFor.current !== null && computedFor.current !== inputs) {
      setResult(null); setDeck(null); computedFor.current = null;
    }
  }, [inputs]);

  const payloadSegments = useMemo(() =>
    segments
      .filter((s) => s.name.trim() && Number(s.revenues) > 0)
      .map((s) => ({
        name: s.name.trim(),
        category: s.category,
        coverage: s.coverage,
        damage_scope: s.damage_scope || undefined,
        revenues: Number(s.revenues),
        cogs_ratio: Number(s.cogs_ratio) || 0.3,
        avg_price: Number(s.avg_price) || undefined,
        start_month: Number(s.start_month) || 1,
      })),
  [segments]);

  // Preflight, per segment: is there a rate that could price this at all?
  const uncovered = useMemo(() =>
    payloadSegments.filter((s) =>
      !quotes.some((q) => q.category === s.category && q.coverage === s.coverage)),
  [payloadSegments, quotes]);

  const monthsValid = /^\d+$/.test(months.trim()) && Number(months) >= 1 && Number(months) <= 120;

  const call = async (extra: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("build-collateral", {
      body: {
        brand_id: brandId, kind: "business_case",
        months: Number(months),
        setup_discounted: setupDiscount,
        include_api: includeApi,
        segments: payloadSegments,
        ...extra,
      },
    });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as CollateralResponse;
    if (d.error) throw new Error(d.error);
    return d;
  };

  const calculate = async () => {
    if (!payloadSegments.length) {
      toast({ title: "Nothing to price yet", description: "A segment needs a name and a covered revenue above zero.", variant: "destructive" });
      return;
    }
    if (!monthsValid) {
      toast({ title: "Check the months modelled", description: "A whole number of months between 1 and 120.", variant: "destructive" });
      return;
    }
    setBusy("preview"); setDeck(null);
    try {
      const out = await call({ preview: true });
      if (out.ok === false) { toast({ title: "Cannot price this yet", description: out.reason, variant: "destructive" }); setResult(null); return; }
      setResult(out.business_case ?? null);
      computedFor.current = inputs;
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
      computedFor.current = inputs;
      setDeck({ url: String(out.download_url ?? ""), name: String(out.file_name ?? "business case.pptx") });
      toast({ title: "Deck ready" });
      onArtifact?.();
    } catch (e) {
      toast({ title: "Deck failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const setSeg = (i: number, patch: Partial<Segment>) =>
    setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const fees = result?.aion_fees;
  const pp = result?.per_product;
  const field = "rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Months modelled
          <input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric"
            className={`w-28 ${field} ${monthsValid ? "" : "border-destructive"}`} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={setupDiscount} onChange={(e) => setSetupDiscount(e.target.checked)} />
          Setup discounted
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={includeApi} onChange={(e) => setIncludeApi(e.target.checked)} />
          Include API fee
        </label>
        <p className="pb-2 text-xs text-muted-foreground">
          Covered revenue is the figure for the whole modelled period. A segment starting later contributes
          only the months it is live.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Perimeter</h3>
          <button onClick={() => setSegments((p) => [...p, emptySegment()])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add segment
          </button>
        </div>

        {segments.map((s, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Segment
                <input className={field} placeholder="Pilot — EU" value={s.name}
                  onChange={(e) => setSeg(i, { name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Category
                <select className={field} value={s.category} onChange={(e) => setSeg(i, { category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Cover
                <select className={field} value={s.coverage} onChange={(e) => setSeg(i, { coverage: e.target.value })}>
                  {COVERAGES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Damage scope
                <select className={field} value={s.damage_scope} disabled={s.coverage === "theft"}
                  onChange={(e) => setSeg(i, { damage_scope: e.target.value })}>
                  {DAMAGE_SCOPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Covered revenue €
                <input className={field} inputMode="numeric" placeholder="12000000" value={s.revenues}
                  onChange={(e) => setSeg(i, { revenues: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                COGS ratio
                <input className={field} inputMode="decimal" value={s.cogs_ratio}
                  onChange={(e) => setSeg(i, { cogs_ratio: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Average price €
                <input className={field} inputMode="numeric" placeholder="4200" value={s.avg_price}
                  onChange={(e) => setSeg(i, { avg_price: e.target.value })} />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Starts month
                  <input className={field} inputMode="numeric" value={s.start_month}
                    onChange={(e) => setSeg(i, { start_month: e.target.value })} />
                </label>
                {segments.length > 1 && (
                  <button onClick={() => setSegments((p) => p.filter((_, j) => j !== i))}
                    className="mb-1.5 rounded p-1.5 text-muted-foreground hover:text-destructive" aria-label="Remove segment">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {uncovered.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              No rate on file for{" "}
              {uncovered.map((s) => `${s.category} (${s.coverage === "theft" ? "theft only" : "theft + damage"})`).join(", ")}.
              {" "}<button onClick={() => setShowQuotes(true)} className="font-medium underline">Add the quote</button>
              {" "}or this will not price.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => void calculate()} disabled={busy !== null || !brandId}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate
          </button>
          <button onClick={() => void buildDeck()} disabled={busy !== null || !result}
            title={result ? "" : "Calculate first — the deck is built from the figures you have checked"}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">
            {busy === "deck" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Build deck
          </button>
          {deck && (
            <a href={deck.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
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

          {(result.notes ?? []).length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-400">Worth checking before you present this</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {(result.notes as string[]).map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            {[
              ["Covered revenue", eur(result.revenues_covered)],
              ["Gross premium", eur(result.gross_premium)],
              ["AION fees", eur(fees?.total)],
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
              {pp ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>Insurer <span className="text-foreground">{eur2(pp.insurer_fee)}</span></li>
                  <li>AION <span className="text-foreground">{eur2(pp.aion_fee)}</span></li>
                  <li>Recurring total <span className="text-foreground">{eur2(pp.total)}</span> — {pct(pp.total_pct_of_price)} of retail, {pct(pp.total_pct_of_price_incl_vat)} of retail incl. VAT</li>
                  <li className="text-xs">Setup spread over the perimeter adds {eur2(pp.setup)} → <span className="text-foreground">{eur2(pp.total_with_setup)}</span> all-in</li>
                </ul>
              ) : <p className="text-sm text-muted-foreground">Add an average price per segment for per-piece figures.</p>}
            </div>

            <div className="rounded-xl border border-border p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">AION</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Tier <span className="text-foreground">{fees?.tier ?? "—"}</span> on covered GMV</li>
                <li>Setup <span className="text-foreground">{eur(fees?.setup)}</span> · Service <span className="text-foreground">{eur(fees?.service)}</span> · Activation <span className="text-foreground">{eur(fees?.activation)}</span></li>
                {typeof fees?.service_fee_month === "number" && (
                  <li className="text-xs">{fees.service_months_discounted} month{fees.service_months_discounted === 1 ? "" : "s"} discounted, {fees.service_months_full} at {eur(fees.service_fee_month)}/month</li>
                )}
                <li>Revenue over the period <span className="text-foreground">{eur(result.aion_total_revenue)}</span></li>
                {fees?.service_note && <li className="text-amber-600">{fees.service_note}</li>}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Where these rates come from</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(result.rates_used ?? []).map((r: RateUsed, i: number) => (
                <li key={i}>
                  <span className="text-foreground">{r.category}</span>
                  {" · "}{r.coverage === "theft" ? "theft only" : `theft + damage${r.damage_scope ? ` (${r.damage_scope})` : ""}`}
                  {" — "}{pct(r.rate_of_cogs)} of COGS · {r.insurer}
                  {r.quoted_for ? `, quoted for ${r.quoted_for}` : ""}{r.quoted_at ? ` (${r.quoted_at})` : ""}
                  {r.own_quote ? "" : <span className="ml-1 font-medium text-amber-600">— indicative</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border">
        <button onClick={() => setShowQuotes((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-foreground">
          {showQuotes ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Insurer quotes
          <span className="font-normal text-muted-foreground">· {quotes.length} on file</span>
        </button>
        {showQuotes && (
          <div className="border-t border-border p-4">
            <InsurerQuotes brands={brands} onChanged={() => void loadQuotes()} />
          </div>
        )}
      </div>
    </div>
  );
}
