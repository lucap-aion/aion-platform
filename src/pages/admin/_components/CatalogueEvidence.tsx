import { useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";

// Why the product focus says what it says.
//
// The focus is read off the catalogue, and the catalogue is a SAMPLE of a website — what the
// crawler reached, in the market it was read in. That is usually a fair reading and sometimes
// a bad one: prada.com gave up 82 pieces filed under "Accessori" and 20 under "Borse", so the
// honest reading of that sample is "Accessories", and the honest reading of Prada is not.
//
// So the screen shows the sample instead of asking anyone to trust it. These are the house's
// OWN shelf labels with a count and a value against each — no vocabulary, no interpretation,
// nothing this component could get wrong. An admin who disagrees types over the focus field,
// which claims it and stops onboarding rewriting it.

type Shelf = { label: string; pieces: number; value: number };

export default function CatalogueEvidence({ brandId, focus }: {
  brandId: number;
  /** Only to say whether what is typed is still the catalogue's own reading. */
  focus: string | null;
}) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      // category + price only, and capped: this is a hint under a form field, not a report.
      const { data } = await untyped
        .from("storefront_products")
        .select("category, price")
        .eq("brand_id", brandId)
        .limit(2000);
      if (!live) return;
      const rows = (data ?? []) as { category: string | null; price: number | null }[];
      const tally = new Map<string, Shelf>();
      for (const r of rows) {
        const label = (r.category ?? "").trim() || "(unfiled)";
        const s = tally.get(label) ?? { label, pieces: 0, value: 0 };
        s.pieces += 1;
        s.value += Number(r.price) > 0 ? Number(r.price) : 0;
        tally.set(label, s);
      }
      setTotal(rows.length);
      setShelves([...tally.values()].sort((a, b) => b.pieces - a.pieces));
    })();
    return () => { live = false; };
  }, [brandId]);

  if (!shelves) return null;
  if (!total) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No catalogue read yet, so the focus above is not evidence — set it by hand.
      </p>
    );
  }

  const shown = shelves.slice(0, 8);
  const rest = shelves.length - shown.length;

  return (
    <details className="mt-2 [&_summary]:list-none">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        What the catalogue says — {total.toLocaleString()} pieces across {shelves.length}{" "}
        {shelves.length === 1 ? "shelf" : "shelves"}
        {focus ? "" : " (nothing set above)"}
      </summary>
      <div className="mt-2 space-y-1">
        {shown.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 truncate text-muted-foreground" title={s.label}>{s.label}</span>
            {/* The bar is the point: a share is easier to disbelieve than a number. */}
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary/60"
                style={{ width: `${Math.max(2, Math.round((s.pieces / total) * 100))}%` }}
              />
            </span>
            <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
              {s.pieces} · {Math.round((s.pieces / total) * 100)}%
              {s.value > 0 ? ` · €${Math.round(s.value).toLocaleString("en-US")}` : ""}
            </span>
          </div>
        ))}
        {rest > 0 && (
          <p className="text-xs text-muted-foreground/70">…and {rest} more.</p>
        )}
        <p className="pt-1 text-xs text-muted-foreground/70">
          Shelf labels as the house files them. The catalogue is what the crawler reached, not
          the whole assortment — if it under-represents a category, type the focus by hand.
        </p>
      </div>
    </details>
  );
}
