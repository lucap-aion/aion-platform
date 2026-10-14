// A business case as `compute_business_case` returns it, worked through by hand from the SQL
// so every figure reconciles: two segments over 36 months, bags live from month 1 and shoes
// from month 7, at 30% and 28% COGS; a 10% GVT fee, a 25% AION share of the net premium,
// tier 2 (setup €20,000 at 50% off, service €1,500/month with the first 12 months at half),
// activation 0.08% (bags from the record, shoes from the tier), VAT 22%.
//
// One rate comes from the brand record and one is a quote borrowed from another house, so the
// case is indicative — and that house's name is in `quoted_for`, where the tests check it
// never reaches a slide. Used by the tests and by `scripts/proof-deck.mts --deck business-case`.

import type { BusinessCase } from "../../../supabase/functions/_shared/business-case-deck.ts";

/** The name a borrowed quote was made for. It must appear on no slide. */
export const BORROWED_FROM = "Comparable Client S.p.A.";

export const FIXTURE_CASE: BusinessCase = {
  months: 36,
  segments: [
    {
      segment: "Bags and leather goods", category: "bags", coverage: "theft_and_damage", damage_scope: null,
      months_live: 36, revenues_covered: 4200000, value_covered: 1260000,
      rate_of_cogs: 0.06, gross_premium: 75600, units: 1750,
      rate_source: "record_category", activation_fee_pct: 0.0008, aion_premium_share: 0.25,
    },
    {
      segment: "Shoes", category: "shoes", coverage: "theft_and_damage", damage_scope: "partial",
      months_live: 30, revenues_covered: 916667, value_covered: 256667,
      rate_of_cogs: 0.045, gross_premium: 11550, units: 1078,
      // No activation rate on the record for shoes: the tier's 0.08% applies, and the SQL
      // reports the segment's own rate as null.
      rate_source: "borrowed_quote", activation_fee_pct: null, aion_premium_share: 0.25,
    },
  ],
  revenues_covered: 5116667,
  products_covered: 2828,
  average_price: 1809,
  gross_premium: 87150,
  net_premium: 78435,
  aion_insurance_revenue: 19609,
  aion_fees: {
    setup: 10000, service: 45000, activation: 4093, total: 59093, tier: 2,
    service_fee_month: 1500, service_months_full: 24, service_months_discounted: 12, service_note: null,
    activation_from_record: true,
  },
  aion_total_revenue: 78702,
  total_cost_to_brand: 146243,
  vat: 0.22,
  per_product: {
    insurer_fee: 30.81, aion_fee: 17.36, total: 48.17, setup: 3.54, total_with_setup: 51.71,
    total_pct_of_price: 0.0266, total_pct_of_price_incl_vat: 0.0218,
  },
  rates_used: [
    {
      quote_id: null, segment: "Bags and leather goods", category: "bags",
      coverage: "theft_and_damage", damage_scope: null, rate_of_cogs: 0.06,
      insurer: null, quoted_for: null, quoted_at: null, gmv_from: null, gmv_to: null,
      own_quote: true, rate_source: "record_category", source: "Agreed with the house's finance team",
    },
    {
      quote_id: 14, segment: "Shoes", category: "shoes",
      coverage: "theft_and_damage", damage_scope: "partial", rate_of_cogs: 0.045,
      insurer: "Chubb", quoted_for: BORROWED_FROM, quoted_at: "2026-07-30",
      gmv_from: 2000000, gmv_to: 10000000, own_quote: false, rate_source: "borrowed_quote",
    },
  ],
  notes: ["Shoes: rate was quoted for a 2000000–10000000 volume band, this segment declares 1100000"],
  volume_band_mismatch: true,
  indicative: true,
};

/**
 * The stress case: six segments, six rates alternating record and borrowed, three
 * volume-band notes. The figures do not reconcile — it exists to check the drawing holds
 * when a perimeter is as large as a house is likely to declare.
 */
export const SIX_SEGMENT_CASE: BusinessCase = (() => {
  const c = structuredClone(FIXTURE_CASE);
  const names = ["Bags and leather goods", "Shoes", "Small leather goods", "Ready-to-wear", "Jewellery", "Eyewear"];
  c.segments = names.map((n, i) => ({ ...c.segments[i % 2], segment: n, category: n.toLowerCase() }));
  c.rates_used = names.map((n, i) => ({ ...c.rates_used![i % 2], segment: n, category: n.toLowerCase() }));
  c.notes = names.slice(0, 3).map((n) => `${n}: rate was quoted for a 2000000–10000000 volume band, this segment declares 1100000`);
  return c;
})();
