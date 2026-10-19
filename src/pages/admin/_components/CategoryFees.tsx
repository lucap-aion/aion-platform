import { useCallback, useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CATEGORIES } from "./pricing-model";
import { Skeleton } from "@/components/ui/skeleton";
import { FOCUS_VOCABULARY, categoryName, focusCategories, pricingClassFor } from "@/lib/commercialCycle";

// The pilot's categories, and their fee rates.
//
// "The brand should say 'we are interested in these categories' that we fill in somewhere,
// and for each category we do a data request. My understanding is that this comes from
// Record → Per category rates → Category 1, 2, 3, n." Since 2026-10-14 it does: a row here is
// a category the pilot covers and one segment of the data request, named by its label. Its
// rate cells stay optional overrides — a row with none is a category at the house's rates.
//
// "Fee rates are per category — in Ferragamo there is Bags and Watches, two different
// categories with different fee rates." The record had one set of rates for a whole house, so
// either a bag and a watch were priced identically or the difference lived in somebody's head
// and was retyped into each business case.
//
// The brand-level rates above stay, and stay authoritative: live policies, the Chubb export
// and the internal report are all priced from brands.*, and moving those is a different job
// with a different blast radius. A row here is an OVERRIDE, and a blank field in it means
// "whatever the house-wide rate is" — never zero. That distinction is the whole design: a
// category row typed to record that watches are 4% must not silently set that category's
// activation fee to nothing.

type Row = {
  id: number;
  category: string;
  label: string | null;
  insurance_premium: number | null;
  activation_fee: number | null;
  aion_premium_fee: number | null;
  cogs_ratio: number | null;
  min_covered_value: number | null;
  max_covered_value: number | null;
  note: string | null;
};

/** The overridable numbers, and how each is written and read. */
const FIELDS = [
  // "The COGS % are per category." The premium is a rate on the cost of goods, so the cost of
  // goods as a share of the price is what turns that rate into a cost per piece. It has no
  // house-wide value on the record; blank means the business case's 30%.
  { key: "cogs_ratio", label: "COGS", unit: "pct", hint: "% of retail price", fallback: 0.3 },
  { key: "insurance_premium", label: "Insurance premium", unit: "pct", hint: "% of COGS" },
  { key: "aion_premium_fee", label: "AION premium fee", unit: "pct", hint: "% of net premium" },
  { key: "activation_fee", label: "Activation fee", unit: "pct", hint: "% of covered value" },
  { key: "min_covered_value", label: "Min covered", unit: "eur", hint: "€ floor" },
  { key: "max_covered_value", label: "Max covered", unit: "eur", hint: "€ ceiling" },
] as const;

type FieldKey = typeof FIELDS[number]["key"];

// Rates are ENTERED and SHOWN as percentages, because that is how they are quoted and
// discussed, and STORED as fractions, because that is what every formula downstream applies.
// One conversion, in one place — getting it wrong by a factor of 100 is the kind of mistake
// that reaches a client.
const toStored = (unit: "pct" | "eur", typed: string): number | null => {
  if (typed.trim() === "") return null;
  const n = Number(typed.replace(/[^\d.-]/g, ""));
  if (Number.isNaN(n)) return null;
  return unit === "pct" ? n / 100 : n;
};
const toTyped = (unit: "pct" | "eur", stored: number | null): string => {
  if (stored == null) return "";
  // 0.0015 → "0.15", without 0.15000000000000002.
  return unit === "pct" ? String(Number((stored * 100).toFixed(6))) : String(stored);
};

export default function CategoryFees({ brandId, readOnly, brandRates, focus }: {
  brandId: number;
  readOnly?: boolean;
  /** The house-wide rates, shown as the placeholder in every blank cell. */
  brandRates: Partial<Record<FieldKey, number | null>>;
  /** brands.product_focus — offered as the starting list while the table is empty. */
  focus?: string | null;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [adding, setAdding] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await untyped
      .from("brand_category_fees")
      .select("id, category, label, insurance_premium, activation_fee, aion_premium_fee, cogs_ratio, min_covered_value, max_covered_value, note")
      .eq("brand_id", brandId)
      // Insertion order is the house's order — the data request numbers its segments by it.
      .order("id");
    if (error) toast({ title: "Could not read the category rates", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  // Added by the name the client will read; the pricing class is derived and can be changed
  // on the row. Several at once when they come from the catalogue's reading.
  const addCategories = async (labels: string[]) => {
    const clean = labels.map((l) => l.trim()).filter(Boolean);
    if (!clean.length) return;
    setBusy("new");
    const { error } = await untyped.from("brand_category_fees")
      .insert(clean.map((label) => ({ brand_id: brandId, category: pricingClassFor(label), label })));
    setBusy(null);
    if (error) {
      toast({
        title: "Could not add that category",
        // The unique index is the one an admin will actually hit.
        description: /duplicate|unique/i.test(error.message)
          ? `${clean.join(", ")} is already on the list.` : error.message,
        variant: "destructive",
      });
      return;
    }
    setAdding("");
    await load();
  };

  const saveLabel = async (row: Row, typed: string) => {
    const label = typed.trim() || null;
    if (label === row.label) return;
    setBusy(row.id);
    const { error } = await untyped.from("brand_category_fees").update({ label }).eq("id", row.id);
    setBusy(null);
    if (error) {
      toast({
        title: "Not saved",
        description: /duplicate|unique/i.test(error.message) ? `${label} is already on the list.` : error.message,
        variant: "destructive",
      });
      await load();
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, label } : r)));
  };

  const saveClass = async (row: Row, category: string) => {
    if (category === row.category) return;
    setBusy(row.id);
    const { error } = await untyped.from("brand_category_fees").update({ category }).eq("id", row.id);
    setBusy(null);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); await load(); return; }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, category } : r)));
  };

  // Written on blur, not on every keystroke: a rate typed digit by digit would otherwise
  // save "0.0", "0.04", "0.045" in turn, and the middle ones are wrong numbers briefly
  // visible to anybody else on the same brand.
  const saveCell = async (row: Row, key: FieldKey, unit: "pct" | "eur", typed: string) => {
    const value = toStored(unit, typed);
    if (value === row[key]) return;
    setBusy(row.id);
    const { error } = await untyped.from("brand_category_fees")
      .update({ [key]: value }).eq("id", row.id);
    setBusy(null);
    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" });
      await load();
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [key]: value } : r)));
  };

  const saveNote = async (row: Row, note: string) => {
    if ((note || null) === row.note) return;
    setBusy(row.id);
    const { error } = await untyped.from("brand_category_fees")
      .update({ note: note || null }).eq("id", row.id);
    setBusy(null);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, note: note || null } : r)));
  };

  const remove = async (row: Row) => {
    setBusy(row.id);
    const { error } = await untyped.from("brand_category_fees").delete().eq("id", row.id);
    setBusy(null);
    if (error) { toast({ title: "Not removed", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  const taken = new Set(rows.map((r) => categoryName(r).toLowerCase()));
  const suggestions = FOCUS_VOCABULARY.filter((c) => !taken.has(c.toLowerCase()));
  const fromCatalogue = focusCategories(focus).filter((c) => !taken.has(c.toLowerCase()));

  if (loading) return <Skeleton className="h-24 w-full rounded-lg" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The categories the pilot covers. Each one is a segment of the data request, named as
        written here, in this order. Rates are optional: leave a cell empty and that category
        keeps the house-wide value above — shown greyed as the placeholder.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          <p>No categories yet — the data request falls back to the catalogue's product focus{fromCatalogue.length ? ` (${fromCatalogue.join(", ")})` : ", which is empty too"}.</p>
          {!readOnly && fromCatalogue.length > 0 && (
            <button
              type="button"
              onClick={() => void addCategories(fromCatalogue.slice(0, 8))}
              disabled={busy === "new"}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
            >
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Use {fromCatalogue.length === 1 ? "it" : "these"} as the pilot's categories
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">
                  Category
                  <span className="block font-normal normal-case tracking-normal text-[11px] text-muted-foreground/70">as the client reads it · priced as</span>
                </th>
                {FIELDS.map((f) => (
                  <th key={f.key} className="py-2 pr-3 font-medium">
                    {f.label}
                    <span className="block font-normal normal-case tracking-normal text-[11px] text-muted-foreground/70">{f.hint}</span>
                  </th>
                ))}
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="space-y-1">
                        <input
                          type="text"
                          disabled={readOnly || busy === row.id}
                          defaultValue={categoryName(row)}
                          onBlur={(e) => void saveLabel(row, e.target.value)}
                          className="w-48 rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
                          aria-label={`Category ${i + 1} name`}
                        />
                        {/* The pricing class decides which insurer quote prices it; the client
                            never sees it. */}
                        <select
                          value={row.category}
                          disabled={readOnly || busy === row.id}
                          onChange={(e) => void saveClass(row, e.target.value)}
                          className="block w-48 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground disabled:opacity-60"
                          aria-label={`${categoryName(row)} priced as`}
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>priced as {c}</option>)}
                        </select>
                      </div>
                    </div>
                  </td>
                  {FIELDS.map((f) => (
                    <td key={f.key} className="py-2 pr-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={readOnly || busy === row.id}
                        defaultValue={toTyped(f.unit, row[f.key])}
                        placeholder={toTyped(f.unit, brandRates[f.key] ?? ("fallback" in f ? f.fallback : null)) || "—"}
                        onBlur={(e) => void saveCell(row, f.key, f.unit, e.target.value)}
                        className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
                        aria-label={`${row.category} ${f.label}`}
                      />
                    </td>
                  ))}
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      disabled={readOnly || busy === row.id}
                      defaultValue={row.note ?? ""}
                      placeholder="Chubb quote ref…"
                      onBlur={(e) => void saveNote(row, e.target.value)}
                      className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
                      aria-label={`${row.category} source`}
                    />
                  </td>
                  <td className="py-2 text-right">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => void remove(row)}
                        disabled={busy === row.id}
                        className="rounded border border-border p-1 text-destructive disabled:opacity-50"
                        aria-label={`Remove ${categoryName(row)} from the pilot`}
                      >
                        {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && rows.length < 8 && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void addCategories([adding]); }}
        >
          {/* Free text, with the catalogue reader's vocabulary offered: a pilot can be scoped
              to "Small leather goods" even though the reader would never say it. */}
          <input
            type="text"
            list={`category-suggestions-${brandId}`}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Add a category…"
            className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            aria-label="Category to add"
          />
          <datalist id={`category-suggestions-${brandId}`}>
            {suggestions.map((c) => <option key={c} value={c} />)}
          </datalist>
          <button
            type="submit"
            disabled={!adding.trim() || busy === "new"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </button>
        </form>
      )}
      {!readOnly && rows.length >= 8 && (
        <p className="text-xs text-muted-foreground">Eight categories is as many segments as the data request holds.</p>
      )}
    </div>
  );
}
