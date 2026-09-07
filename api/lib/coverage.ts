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
