import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
// The standalone `toast`, not `useToast().toast`: the hook returns a fresh
// object every render, so a fetcher that lists it as a dependency re-runs on
// every render — which for a fetcher that sets a loading flag is an infinite
// loop that never leaves the spinner. This one is module-scoped and stable.
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Check, X } from "lucide-react";
import { CATEGORIES, COVERAGES, DAMAGE_SCOPES, type Quote } from "./pricing-model";
import { Skeleton } from "@/components/ui/skeleton";

// The quotes Chubb has actually given us.
//
// The model has always read from this table, but nothing could write to it: the
// only rows that existed were two seeded from the Ferragamo dataroom plus
// whatever brands.insurance_premium happened to hold. Every other category
// dead-ended at "no insurer quote on file", from inside the Calculate button,
// with no way to fix it without a SQL client.
//
// Rates are entered as PERCENTAGES because that is how they are quoted and
// discussed. They are stored as fractions of COGS, which is what the model
// applies. Getting that conversion wrong by a factor of 100 is the kind of
// mistake that reaches a client, so it happens in exactly one place.

type Draft = {
  insurer: string; quoted_for: string; brand_id: string; category: string;
  coverage: string; damage_scope: string; rate_pct: string;
  gmv_from: string; gmv_to: string; duration_years: string;
  claims_allowed: string; source: string; quoted_at: string;
};

const emptyDraft = (): Draft => ({
  insurer: "Chubb", quoted_for: "", brand_id: "", category: "jewellery",
  coverage: "theft_and_damage", damage_scope: "", rate_pct: "",
  gmv_from: "", gmv_to: "", duration_years: "2",
  claims_allowed: "", source: "", quoted_at: new Date().toISOString().slice(0, 10),
});

const num = (s: string): number | null => {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};
const eur0 = (n: number | null) =>
  n == null ? null : `€${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;

export default function InsurerQuotes({ brands, onChanged }: {
  brands: { id: number; name: string | null }[];
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await untyped.from("insurance_quotes")
      .select("*").order("category").order("coverage").order("quoted_at", { ascending: false });
    if (error) toast({ title: "Could not load quotes", description: error.message, variant: "destructive" });
    setRows((data ?? []) as unknown as Quote[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const brandName = (id: number | null) =>
    id == null ? null : brands.find((b) => b.id === id)?.name ?? `Brand ${id}`;

  const save = async () => {
    const rate = num(draft.rate_pct);
    if (rate == null || rate <= 0) {
      toast({ title: "Enter the rate", description: "The rate Chubb quoted, as a percentage of COGS — e.g. 2.83", variant: "destructive" });
      return;
    }
    // A rate typed as 0.0283 rather than 2.83 is a hundredfold error that the
    // model would apply without complaint. It is always worth one question.
    if (rate > 40) {
      toast({ title: "That rate looks wrong", description: `${rate}% of COGS is far outside anything quoted so far. Enter it as a percentage.`, variant: "destructive" });
      return;
    }
    if (!draft.quoted_for.trim() && !draft.brand_id) {
      toast({ title: "Say who it was quoted for", description: "A rate with no owner cannot be marked indicative or not, which is the whole point of recording it.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await untyped.from("insurance_quotes").insert({
      insurer: draft.insurer.trim() || "Chubb",
      quoted_for: draft.quoted_for.trim() || brandName(num(draft.brand_id)) || null,
      brand_id: num(draft.brand_id),
      category: draft.category,
      coverage: draft.coverage,
      damage_scope: draft.coverage === "theft" ? null : (draft.damage_scope || null),
      rate_of_cogs: rate / 100,
      duration_years: num(draft.duration_years) ?? 2,
      claims_allowed: draft.claims_allowed.trim() || null,
      gmv_from: num(draft.gmv_from),
      gmv_to: num(draft.gmv_to),
      source: draft.source.trim() || null,
      quoted_at: draft.quoted_at || null,
      active: true,
    } as never);
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Quote saved" });
    setDraft(emptyDraft()); setAdding(false);
    await load(); onChanged?.();
  };

  const toggle = async (q: Quote) => {
    const { error } = await untyped.from("insurance_quotes").update({ active: !q.active } as never).eq("id", q.id);
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    await load(); onChanged?.();
  };

  const remove = async (q: Quote) => {
    const { error } = await untyped.from("insurance_quotes").delete().eq("id", q.id);
    if (error) { toast({ title: "Could not delete", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Quote deleted" });
    await load(); onChanged?.();
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const field = "rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Every rate the model can use. A segment is priced from the quote that matches its category, its
          cover and — where a band was given — its volume, preferring the brand's own quote over a borrowed one.
        </p>
        <button onClick={() => setAdding((a) => !a)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add quote
        </button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Category
              <select className={field} value={draft.category} onChange={(e) => set({ category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Cover
              <select className={field} value={draft.coverage} onChange={(e) => set({ coverage: e.target.value })}>
                {COVERAGES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Damage scope
              <select className={field} value={draft.damage_scope} disabled={draft.coverage === "theft"}
                onChange={(e) => set({ damage_scope: e.target.value })}>
                {DAMAGE_SCOPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Rate, % of COGS
              <input className={field} inputMode="decimal" placeholder="3.50"
                value={draft.rate_pct} onChange={(e) => set({ rate_pct: e.target.value })} />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Quoted for (brand)
              <select className={field} value={draft.brand_id} onChange={(e) => set({ brand_id: e.target.value })}>
                <option value="">— not one of ours —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name ?? `Brand ${b.id}`}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              …or legal entity
              <input className={field} placeholder="Brand Name S.p.A."
                value={draft.quoted_for} onChange={(e) => set({ quoted_for: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Volume from €
              <input className={field} inputMode="numeric" placeholder="10000000"
                value={draft.gmv_from} onChange={(e) => set({ gmv_from: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Volume to €
              <input className={field} inputMode="numeric" placeholder="blank = no cap"
                value={draft.gmv_to} onChange={(e) => set({ gmv_to: e.target.value })} />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Claims allowed
              <input className={field} placeholder="1 theft, 2 AD"
                value={draft.claims_allowed} onChange={(e) => set({ claims_allowed: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Duration, years
              <input className={field} inputMode="decimal"
                value={draft.duration_years} onChange={(e) => set({ duration_years: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Quoted on
              <input type="date" className={field}
                value={draft.quoted_at} onChange={(e) => set({ quoted_at: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Where it came from
              <input className={field} placeholder="Email from Chubb, 12 Mar"
                value={draft.source} onChange={(e) => set({ source: e.target.value })} />
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => void save()} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save quote
            </button>
            <button onClick={() => { setAdding(false); setDraft(emptyDraft()); }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        // Not "no quotes on file" — that sentence means nothing can be priced,
        // and it must only appear once we know it is true.
        <div className="space-y-2 pt-1">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No quotes on file. Nothing can be priced until at least one is added.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Cover</th>
                <th className="py-2 pr-3 font-medium">Rate</th>
                <th className="py-2 pr-3 font-medium">Volume band</th>
                {/* The terms the rate assumes. Both were captured by the form above,
                    stored, and never shown again — nothing reads claims_allowed or
                    duration_years anywhere: not compute_business_case, not this table, not
                    the deck. A one-claim rate and a three-claim rate are different products,
                    so a figure entered here was being compared against a figure whose terms
                    nobody could see. */}
                <th className="py-2 pr-3 font-medium">Terms</th>
                <th className="py-2 pr-3 font-medium">Quoted for</th>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((q) => (
                <tr key={q.id} className={q.active ? "" : "opacity-45"}>
                  <td className="py-2 pr-3 text-foreground">{q.category}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {q.coverage === "theft" ? "Theft" : "Theft + damage"}
                    {q.damage_scope ? ` · ${q.damage_scope}` : ""}
                  </td>
                  <td className="py-2 pr-3 font-medium text-foreground">{(q.rate_of_cogs * 100).toFixed(2)}%</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {q.gmv_from == null ? "—" : `${eur0(q.gmv_from)}–${q.gmv_to == null ? "no cap" : eur0(q.gmv_to)}`}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {[q.claims_allowed, q.duration_years ? `${q.duration_years}y` : null]
                      .filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {q.quoted_for ?? brandName(q.brand_id) ?? "—"}
                    {q.brand_id == null && <span className="ml-1 text-[11px] text-amber-600">not linked to a brand</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{q.quoted_at ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => void toggle(q)} title={q.active ? "Stop using this rate" : "Use this rate again"}
                        className="rounded p-1 text-muted-foreground hover:text-foreground">
                        {q.active ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => void remove(q)} title="Delete"
                        className="rounded p-1 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
