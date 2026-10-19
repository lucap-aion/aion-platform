// Mirror of src/lib/coverage.ts for the serverless api (built separately, cannot import src/).
// A brand covers each item only up to brands.max_covered_value (retail price, per unit):
// COGS and the covered value written on the policy are computed on the capped price.
export const DEFAULT_MAX_COVERED_VALUE = 100000;

export function resolveMaxCoveredValue(brand?: { max_covered_value?: number | null } | null): number {
  const v = Number(brand?.max_covered_value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_COVERED_VALUE;
}

export function coveredRetailValue(recommendedRetailPrice: number | null | undefined, maxCoveredValue: number): number {
  const rrp = Number(recommendedRetailPrice) || 0;
  return Math.min(Math.abs(rrp), maxCoveredValue) * (rrp < 0 ? -1 : 1);
}

// A piece priced at or below brands.min_covered_value is recorded but not activated.
// This is NOT the mirror of the ceiling: above the ceiling a piece is still covered
// (capped at it), below the floor it is not covered at all. 999 was the platform-wide
// literal before the floor became per-brand, so it stays the fallback.
export const DEFAULT_MIN_COVERED_VALUE = 999;

export function resolveMinCoveredValue(brand?: { min_covered_value?: number | null } | null): number {
  const raw = brand?.min_covered_value;
  // 0 is a legitimate floor — a brand that covers everything — so the absent case has to
  // be tested before coercing: Number(null) is 0, which would silently activate every
  // piece for a brand whose column is null.
  if (raw === null || raw === undefined) return DEFAULT_MIN_COVERED_VALUE;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_COVERED_VALUE;
}

export function policyStatusForRetail(
  recommendedRetailPrice: number | null | undefined,
  minCoveredValue: number,
): 'live' | 'blocked' {
  return (Number(recommendedRetailPrice) || 0) > minCoveredValue ? 'live' : 'blocked';
}
