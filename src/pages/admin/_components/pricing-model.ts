// The shapes the pricing model speaks in — shared by the quote editor, the
// business-case panel and the cycle screen.
//
// compute_business_case returns jsonb, so nothing downstream is typed unless it
// is typed here. The panel used to read it as `any`, which is how the per-piece
// block quietly went on rendering `pp.total_with_setup` as "—" for a while after
// the field was renamed: an undefined property on an `any` looks exactly like a
// figure the model chose not to return.

export const CATEGORIES = ["jewellery", "watches", "bags", "apparel", "leather", "other"];

export const COVERAGES = [
  { value: "theft", label: "Theft only" },
  { value: "theft_and_damage", label: "Theft + accidental damage" },
];

export const DAMAGE_SCOPES = [
  { value: "", label: "Not stated" },
  { value: "partial", label: "Partial" },
  { value: "total", label: "Total" },
];

export type Quote = {
  id: number;
  insurer: string;
  quoted_for: string | null;
  brand_id: number | null;
  category: string;
  coverage: string;
  damage_scope: string | null;
  rate_of_cogs: number;
  duration_years: number | null;
  claims_allowed: string | null;
  gmv_from: number | null;
  gmv_to: number | null;
  volume_note: string | null;
  source: string | null;
  quoted_at: string | null;
  active: boolean;
};

/** Where a segment's insurer rate came from — compute_business_case's `rate_source`. */
export type RateSource = "record_category" | "own_quote" | "borrowed_quote" | "record_brand";

export type RateUsed = {
  quote_id: number | null;
  segment: string;
  category: string;
  coverage: string;
  damage_scope: string | null;
  rate_of_cogs: number;
  insurer: string | null;
  quoted_for: string | null;
  quoted_at: string | null;
  gmv_from: number | null;
  gmv_to: number | null;
  own_quote: boolean;
  /** Absent from cases computed before 2026-10-14. */
  rate_source?: RateSource;
  /** The record row's note, or the quote's source. */
  source?: string | null;
};

export type BusinessCase = {
  months: number;
  revenues_covered: number;
  products_covered: number | null;
  average_price: number | null;
  gross_premium: number;
  net_premium: number;
  aion_total_revenue: number;
  total_cost_to_brand: number;
  vat: number;
  indicative: boolean;
  volume_band_mismatch: boolean;
  notes: string[];
  rates_used: RateUsed[];
  segments: {
    segment: string; category: string; coverage: string;
    revenues_covered: number; value_covered: number;
    rate_of_cogs: number; gross_premium: number; units: number | null;
    rate_source?: RateSource;
    activation_fee_pct?: number | null;
    aion_premium_share?: number;
  }[];
  aion_fees: {
    setup: number; service: number; activation: number; total: number;
    tier: number | null;
    service_fee_month: number | null;
    service_months_full: number | null;
    service_months_discounted: number | null;
    service_note: string | null;
    activation_from_record?: boolean;
  };
  // Null until an average price is declared for at least one segment.
  per_product: {
    insurer_fee: number; aion_fee: number; total: number;
    setup: number; total_with_setup: number;
    total_pct_of_price: number; total_pct_of_price_incl_vat: number;
  } | null;
};

// ── The brand record's rates, as the model applies them ─────────────────────
// compute_business_case resolves every segment's rates in a fixed order (migration
// 20261014000002). The panel needs the same answer BEFORE Calculate — to say which segments
// cannot be priced, and to show what a piece costs with no revenue typed yet — so the order is
// written once more here and pinned by a test that reads the SQL.

/** A row of brand_category_fees, as the pricing panel reads it. */
export type RecordCategory = {
  category: string; label: string | null;
  insurance_premium: number | null; activation_fee: number | null; aion_premium_fee: number | null;
};
export type RecordRates = {
  insurance_premium: number | null; activation_fee: number | null; aion_premium_fee: number | null;
};

const nameOf = (r: RecordCategory) => (r.label?.trim() || r.category).toLowerCase();

/** The record row a segment is priced from: by the name it carries, else by pricing class. */
export function recordRowFor(seg: { name: string; category: string }, rows: RecordCategory[]): RecordCategory | null {
  const name = seg.name.trim().toLowerCase();
  return rows.find((r) => nameOf(r) === name)
    ?? rows.find((r) => r.category === seg.category.toLowerCase())
    ?? null;
}

export type ResolvedRate = {
  rate: number | null; source: RateSource | null;
  activation: number | null; share: number | null;
};

export function resolveRates(
  seg: { name: string; category: string; coverage: string },
  rows: RecordCategory[], brand: RecordRates | null,
  quotes: Pick<Quote, "category" | "coverage" | "brand_id" | "active" | "rate_of_cogs">[], brandId: number | null,
  standardShare: number | null = null,
): ResolvedRate {
  const row = recordRowFor(seg, rows);
  const activation = row?.activation_fee ?? brand?.activation_fee ?? null;
  const share = row?.aion_premium_fee ?? brand?.aion_premium_fee ?? standardShare;
  if (row?.insurance_premium != null) return { rate: row.insurance_premium, source: "record_category", activation, share };
  const matching = quotes.filter((q) => q.active !== false && q.category === seg.category.toLowerCase() && q.coverage === seg.coverage);
  const own = matching.find((q) => brandId != null && q.brand_id === brandId);
  // The panel does not know the volume band or damage scope the model will weigh, so the
  // quote's rate here is the likeliest one, not a promise — the source is what matters.
  if (own) return { rate: Number(own.rate_of_cogs), source: "own_quote", activation, share };
  if (matching.length) return { rate: Number(matching[0].rate_of_cogs), source: "borrowed_quote", activation, share };
  if (brand?.insurance_premium != null) return { rate: brand.insurance_premium, source: "record_brand", activation, share };
  return { rate: null, source: null, activation, share };
}

export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  record_category: "this category's rate on the brand record",
  own_quote: "an insurer quote for this house",
  borrowed_quote: "an insurer quote for another house",
  record_brand: "the brand record's house-wide rate",
};
