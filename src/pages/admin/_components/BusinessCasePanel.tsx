import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
// The standalone `toast`, not `useToast().toast`: the hook returns a fresh
// object every render, so a fetcher that lists it as a dependency re-runs on
// every render — which for a fetcher that sets a loading flag is an infinite
// loop that never leaves the spinner. This one is module-scoped and stable.
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Download, AlertTriangle, Calculator, ChevronDown, ChevronRight, Upload, FileSpreadsheet } from "lucide-react";
import InsurerQuotes from "./InsurerQuotes";
import { CATEGORIES, COVERAGES, DAMAGE_SCOPES, type BusinessCase, type Quote, type RateUsed } from "./pricing-model";
import { Skeleton } from "@/components/ui/skeleton";

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

type Terms = {
  key: string; setup_fee: number; setup_discount: number; api_fee: number;
  service_discount: number; service_discount_months: number;
  gvt_fee: number; aion_premium_share: number; vat: number; note: string | null;
  tiers: { tier: number; gmv_up_to: number | null; activation_fee_pct: number; service_fee_month: number | null }[];
};

type Segment = {
  name: string; category: string; coverage: string; damage_scope: string;
  revenues: string; cogs_ratio: string; avg_price: string; start_month: string;
};

const emptySegment = (): Segment => ({
  name: "", category: "jewellery", coverage: "theft_and_damage", damage_scope: "",
  revenues: "", cogs_ratio: "0.30", avg_price: "", start_month: "1",
});

// ── The perimeter, kept ─────────────────────────────────────────────────────
// It used to be component state and nothing else, so leaving the tab lost it. A formal
// Chubb quotation takes one to two months; the perimeter it applies to has to still be
// there when it lands, and the person who opens it may not be the one who typed it.
//
// Stored in the MODEL's shape — numbers and nulls, exactly what compute_business_case
// takes — rather than in the form's shape of strings, so the row is meaningful to anything
// that reads it later. The two conversions below are the whole cost of that.
export type StoredSegment = {
  name: string | null; category: string | null; coverage: string | null; damage_scope: string | null;
  revenues: number | null; cogs_ratio: number | null; avg_price: number | null; start_month: number | null;
};
export type StoredBusinessCase = {
  months: number | null;
  setup_discounted: boolean | null;
  include_api: boolean | null;
  segments: StoredSegment[] | null;
  imported_from: string | null;
  imported_at: string | null;
  updated_at: string | null;
};

const numOrNull = (v: string): number | null => {
  const n = Number(String(v).trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n : null;
};

const toStored = (s: Segment): StoredSegment => ({
  name: s.name.trim() || null,
  category: s.category,
  coverage: s.coverage,
  damage_scope: s.damage_scope || null,
  revenues: numOrNull(s.revenues),
  cogs_ratio: numOrNull(s.cogs_ratio),
  avg_price: numOrNull(s.avg_price),
  start_month: numOrNull(s.start_month) ?? 1,
});

const fromStored = (r: StoredSegment): Segment => ({
  name: r.name ?? "",
  category: r.category ?? "jewellery",
  coverage: r.coverage ?? "theft_and_damage",
  damage_scope: r.damage_scope ?? "",
  revenues: r.revenues != null ? String(r.revenues) : "",
  cogs_ratio: r.cogs_ratio != null ? String(r.cogs_ratio) : "0.30",
  avg_price: r.avg_price != null ? String(r.avg_price) : "",
  start_month: String(r.start_month ?? 1),
});

/** A wholly untouched row is not worth a database round trip. */
const isEmptySegment = (s: Segment) =>
  !s.name.trim() && !s.revenues.trim() && !s.avg_price.trim();

/** An extracted row arrives in the model's shape already, so it reuses one conversion. */
const fromExtracted = (r: {
  name: string; category: string; coverage: string; damage_scope: string;
  revenues: number; cogs_ratio: number | null; avg_price: number | null; start_month: number;
}): Segment => fromStored({
  name: r.name, category: r.category, coverage: r.coverage,
  damage_scope: r.damage_scope || null,
  revenues: r.revenues, cogs_ratio: r.cogs_ratio, avg_price: r.avg_price,
  start_month: r.start_month,
});

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^;]*;base64,/, ""));
  reader.onerror = () => reject(new Error("could not read that file"));
  reader.readAsDataURL(file);
});

// What build-collateral makes of the client's returned workbook.
type ReadWorkbook = {
  ok?: boolean; reason?: string;
  segments?: { name: string; category: string; coverage: string; damage_scope: string;
               revenues: number; cogs_ratio: number | null; avg_price: number | null;
               start_month: number; source: string }[];
  notes?: string[];
  sheets?: string[];
  received_as?: string;
};

const eur = (n: unknown) =>
  typeof n === "number" ? `€${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}` : "—";
const eur2 = (n: unknown) =>
  typeof n === "number" ? `€${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}` : "—";
const pct = (n: unknown, digits = 2) =>
  typeof n === "number" ? `${(n * 100).toFixed(digits)}%` : "—";

export default function BusinessCasePanel({ brandId, brands, stored, onArtifact }: {
  brandId: number | null;
  brands: { id: number; name: string | null }[];
  /** The perimeter as last saved, from the cycle overview. Null before anyone declared one. */
  stored?: StoredBusinessCase | null;
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
  const [importing, setImporting] = useState(false);
  const [importNotes, setImportNotes] = useState<string[] | null>(null);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [importedAt, setImportedAt] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  // The assumptions behind every figure on this screen. They were invisible —
  // the GVT fee, AION's share of the net premium, the setup fee and the tier
  // table all live in one row of aion_pricing_terms, and nothing showed you
  // which row was being applied or what was in it.
  const [terms, setTerms] = useState<Terms | null>(null);

  // Which categories can actually be priced, so the answer arrives before the
  // Calculate button rather than as a failure out of it.
  const loadQuotes = useCallback(async () => {
    const { data } = await untyped.from("insurance_quotes")
      .select("category, coverage, damage_scope, rate_of_cogs, brand_id, quoted_for, quoted_at, id, insurer, gmv_from, gmv_to, active")
      .eq("active", true);
    setQuotes((data ?? []) as unknown as Quote[]);
  }, []);
  useEffect(() => { void loadQuotes(); }, [loadQuotes]);

  useEffect(() => {
    void (async () => {
      const { data } = await untyped.from("aion_pricing_terms")
        .select("*").eq("key", "standard_2026").maybeSingle();
      setTerms((data ?? null) as Terms | null);
      setLoadingRefs(false);
    })();
  }, []);

  // ── The perimeter survives the tab ────────────────────────────────────────
  // Seeded once per brand from what was last saved, then written back as it is edited.
  // Everything below used to be component state and nothing else: eight fields per segment,
  // gone the moment you navigated away, retyped when the client came back with a question.
  const seededFor = useRef<number | null>(null);
  const [serverSig, setServerSig] = useState<string | null>(null);

  useEffect(() => {
    if (brandId == null || seededFor.current === brandId) return;
    seededFor.current = brandId;
    const rows = (stored?.segments ?? []).map(fromStored);
    setMonths(String(stored?.months ?? 36));
    setSetupDiscount(stored?.setup_discounted !== false);
    setIncludeApi(stored?.include_api === true);
    setSegments(rows.length ? rows : [emptySegment()]);
    setImportedFrom(stored?.imported_from ?? null);
    setImportedAt(stored?.imported_at ?? null);
    setServerSig(JSON.stringify({
      months: stored?.months ?? 36,
      setup_discounted: stored?.setup_discounted !== false,
      include_api: stored?.include_api === true,
      segments: rows.filter((r) => !isEmptySegment(r)).map(toStored),
    }));
  }, [brandId, stored]);

  const perimeterSig = useMemo(() => JSON.stringify({
    months: Number(months),
    setup_discounted: setupDiscount,
    include_api: includeApi,
    segments: segments.filter((r) => !isEmptySegment(r)).map(toStored),
  }), [months, setupDiscount, includeApi, segments]);

  const monthsValid = /^\d+$/.test(months.trim()) && Number(months) >= 1 && Number(months) <= 120;

  // Debounced, and only when something actually differs from what the server holds — a save
  // per keystroke on a form this size is a write storm, and re-saving the seed on mount
  // would touch every brand you merely looked at.
  useEffect(() => {
    if (brandId == null || serverSig === null || perimeterSig === serverSig) return;
    // A months box mid-edit ("3" on the way to "36") is not worth persisting, and the
    // column is constrained to 1–120 so an out-of-range value would be rejected anyway.
    if (!monthsValid) return;
    const t = setTimeout(() => {
      void (async () => {
        const payload = JSON.parse(perimeterSig) as Record<string, unknown>;
        const { error } = await untyped.from("brand_business_case").upsert({
          brand_id: brandId, ...payload,
          imported_from: importedFrom, imported_at: importedAt,
          updated_at: new Date().toISOString(),
        } as never, { onConflict: "brand_id" });
        if (error) {
          toast({ title: "The perimeter could not be saved", description: error.message, variant: "destructive" });
          return;
        }
        setServerSig(perimeterSig);
      })();
    }, 900);
    return () => clearTimeout(t);
  }, [brandId, perimeterSig, serverSig, monthsValid, importedFrom, importedAt]);

  // ── Reading it out of the client's own workbook ───────────────────────────
  // The workbook AION generated, filled in and sent back. Retyping it is where the two
  // hours in this step actually go.
  const onWorkbook = async (file: File) => {
    if (brandId == null) return;
    if (file.size > 12 * 1024 * 1024) {
      toast({ title: "That file is too large", description: "The reader takes workbooks up to 12MB.", variant: "destructive" });
      return;
    }
    setImporting(true);
    setImportNotes(null);
    try {
      const b64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("build-collateral", {
        body: { brand_id: brandId, kind: "read_data_request", file_base64: b64, file_name: file.name },
      });
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as ReadWorkbook & { error?: string };
      if (d.error) throw new Error(d.error);
      if (d.ok === false) {
        toast({ title: "Could not read that workbook", description: d.reason, variant: "destructive" });
        return;
      }
      const rows = (d.segments ?? []).map(fromExtracted);
      setImportNotes(d.notes ?? []);
      if (rows.length) {
        // REPLACES the perimeter rather than appending to it: importing twice should not
        // silently double what is being priced.
        setSegments(rows);
        setImportedFrom(d.received_as ?? file.name);
        setImportedAt(new Date().toISOString());
        toast({
          title: `${rows.length} segment${rows.length === 1 ? "" : "s"} read from the workbook`,
          description: "Nothing has been priced. Check every figure against what they meant, then calculate.",
        });
      } else {
        toast({
          title: "No perimeter in that workbook",
          description: "It is attached to the brand either way — see the notes below.",
          variant: "destructive",
        });
      }
      // The returned workbook is an artifact now, so the cycle should re-sign its links.
      onArtifact?.();
    } catch (e) {
      toast({ title: "Could not read the workbook", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally {
      setImporting(false);
      // Clear the input, or picking the SAME file again fires no change event.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
    loadingRefs ? [] : payloadSegments.filter((s) =>
      !quotes.some((q) => q.category === s.category && q.coverage === s.coverage)),
  [payloadSegments, quotes, loadingRefs]);

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Perimeter</h3>
            {importedFrom && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <FileSpreadsheet className="h-3 w-3" />
                Read from {importedFrom}
                {importedAt ? ` on ${new Date(importedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The workbook AION generated, filled in and sent back. Reading it is the
                difference between checking eight fields per segment and typing them. */}
            <label className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs ${
              importing || brandId == null ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted"}`}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {importing ? "Reading…" : "Import returned workbook"}
              <input
                ref={fileRef} type="file" className="sr-only"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={importing || brandId == null}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onWorkbook(f); }}
              />
            </label>
            <button onClick={() => setSegments((p) => [...p, emptySegment()])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add segment
            </button>
          </div>
        </div>

        {/* What the reader had to assume. Shown next to the fields it filled, because a
            figure that came out of a guess and a figure the client declared look identical
            once they are both in a box. */}
        {importNotes && importNotes.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">What the reader did with their workbook</p>
              <button onClick={() => setImportNotes(null)} className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground">
                Dismiss
              </button>
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {importNotes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}

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

      {loadingRefs ? (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <Skeleton className="h-4 w-56" />
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-3.5 w-full max-w-64" />)}
          </div>
          <Skeleton className="h-3.5 w-full max-w-md" />
        </div>
      ) : terms && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">The terms these figures apply</h3>
          <div className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
            <span>Setup <span className="text-foreground">{eur(terms.setup_fee)}</span>, discounted {pct(terms.setup_discount, 0)}</span>
            <span>GVT fee <span className="text-foreground">{pct(terms.gvt_fee)}</span> between gross and net premium</span>
            <span>API fee <span className="text-foreground">{eur(terms.api_fee)}</span> when included</span>
            <span>AION takes <span className="text-foreground">{pct(terms.aion_premium_share, 0)}</span> of the net premium</span>
            <span>Service discounted {pct(terms.service_discount, 0)} for the first {terms.service_discount_months} months</span>
            <span>VAT <span className="text-foreground">{pct(terms.vat, 0)}</span></span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(terms.tiers ?? []).map((t) => (
              <span key={t.tier}>
                <span className="text-foreground">Tier {t.tier}</span>
                {" "}to {t.gmv_up_to == null ? "no cap" : eur(t.gmv_up_to)} · {pct(t.activation_fee_pct, 2)} activation ·{" "}
                {t.service_fee_month == null ? "service on quotation" : `${eur(t.service_fee_month)}/mo service`}
              </span>
            ))}
          </div>
          {terms.note && <p className="mt-2 text-[11px] text-muted-foreground">{terms.note}</p>}
        </div>
      )}

      <div className="rounded-xl border border-border">
        <button onClick={() => setShowQuotes((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-foreground">
          {showQuotes ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Insurer quotes
          {loadingRefs
            ? <Skeleton className="h-3.5 w-20" />
            : <span className="font-normal text-muted-foreground">· {quotes.length} on file</span>}
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
