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

export type RateUsed = {
  quote_id: number;
  segment: string;
  category: string;
  coverage: string;
  damage_scope: string | null;
  rate_of_cogs: number;
  insurer: string;
  quoted_for: string | null;
  quoted_at: string | null;
  gmv_from: number | null;
  gmv_to: number | null;
  own_quote: boolean;
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
  }[];
  aion_fees: {
    setup: number; service: number; activation: number; total: number;
    tier: number | null;
    service_fee_month: number | null;
    service_months_full: number | null;
    service_months_discounted: number | null;
    service_note: string | null;
  };
  // Null until an average price is declared for at least one segment.
  per_product: {
    insurer_fee: number; aion_fee: number; total: number;
    setup: number; total_with_setup: number;
    total_pct_of_price: number; total_pct_of_price_incl_vat: number;
  } | null;
};
