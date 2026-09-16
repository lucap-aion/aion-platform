import { useCallback, useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CATEGORIES } from "./pricing-model";
import { Skeleton } from "@/components/ui/skeleton";

// Fee rates, per category.
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
  insurance_premium: number | null;
  activation_fee: number | null;
  aion_premium_fee: number | null;
  min_covered_value: number | null;
  max_covered_value: number | null;
  note: string | null;
};

/** The five overridable numbers, and how each is written and read. */
const FIELDS = [
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

export default function CategoryFees({ brandId, readOnly, brandRates }: {
  brandId: number;
  readOnly?: boolean;
  /** The house-wide rates, shown as the placeholder in every blank cell. */
  brandRates: Partial<Record<FieldKey, number | null>>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [adding, setAdding] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await untyped
      .from("brand_category_fees")
      .select("id, category, insurance_premium, activation_fee, aion_premium_fee, min_covered_value, max_covered_value, note")
      .eq("brand_id", brandId)
      .order("category");
    if (error) toast({ title: "Could not read the category rates", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const addCategory = async () => {
    if (!adding) return;
    setBusy("new");
    const { error } = await untyped.from("brand_category_fees")
      .insert({ brand_id: brandId, category: adding });
    setBusy(null);
    if (error) {
      toast({
        title: "Could not add that category",
        // The unique constraint is the one an admin will actually hit.
        description: /duplicate|unique/i.test(error.message)
          ? `${adding} already has a row.` : error.message,
        variant: "destructive",
      });
      return;
    }
    setAdding("");
    await load();
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

  const unused = CATEGORIES.filter((c) => !rows.some((r) => r.category === c));

  if (loading) return <Skeleton className="h-24 w-full rounded-lg" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        A category here overrides the house-wide rates above. Leave a cell empty and that
        category keeps the house-wide value — shown greyed as the placeholder.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No per-category rates. Every category is priced at the house-wide rates above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Category</th>
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
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2 pr-3 capitalize">{row.category}</td>
                  {FIELDS.map((f) => (
                    <td key={f.key} className="py-2 pr-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={readOnly || busy === row.id}
                        defaultValue={toTyped(f.unit, row[f.key])}
                        placeholder={toTyped(f.unit, brandRates[f.key] ?? null) || "—"}
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
                        aria-label={`Remove the ${row.category} rates`}
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

      {!readOnly && unused.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm capitalize"
            aria-label="Category to add"
          >
            <option value="">Add a category…</option>
            {unused.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void addCategory()}
            disabled={!adding || busy === "new"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </button>
        </div>
      )}
    </div>
  );
}
