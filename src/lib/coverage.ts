// ==============================|| COVERAGE CAP ||============================== //
// A brand covers each item only up to `brands.max_covered_value` (retail price, per unit).
// Everything derived from the retail price (COGS, insurance premium, activation fee,
// Chubb Detail_2) is computed on the covered value, not on the full price. The covered
// value is frozen on the policy at sale time (`policies.covered_value`, also kept by a DB
// trigger), so a later change of the brand ceiling only affects new policies.
// Mirrored in api/lib/coverage.ts (the api folder is built separately).

export const DEFAULT_MAX_COVERED_VALUE = 100000;

/** Brand row -> covered ceiling (per unit, EUR). */
export function resolveMaxCoveredValue(brand?: { max_covered_value?: number | null } | null): number {
  const v = Number(brand?.max_covered_value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_COVERED_VALUE;
}

/** Unit retail value actually covered: rrp capped at the ceiling. */
export function coveredRetailValue(recommendedRetailPrice: number | string | null | undefined, maxCoveredValue: number): number {
  const rrp = Number(recommendedRetailPrice) || 0;
  return Math.min(Math.abs(rrp), maxCoveredValue) * (rrp < 0 ? -1 : 1);
}

/** COGS on the covered value only (covered retail x category cost pct), rounded to cents. */
export function coveredCogs(recommendedRetailPrice: number | string | null | undefined, costPct: number | null | undefined, maxCoveredValue: number): number {
  return Math.round(coveredRetailValue(recommendedRetailPrice, maxCoveredValue) * (Number(costPct) || 0) * 100) / 100;
}

type PolicyLike = { covered_value?: number | null; recommended_retail_price?: number | null };

/** Covered value of a policy: the value frozen at sale, else derived from the retail price. */
export function policyCoveredValue(policy: PolicyLike | null | undefined, maxCoveredValue: number): number {
  const stored = Number(policy?.covered_value);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return coveredRetailValue(policy?.recommended_retail_price, maxCoveredValue);
}

/** True when the item's retail price exceeds what the program covers. */
export function isAboveCoverageCap(policy: PolicyLike | null | undefined, maxCoveredValue: number): boolean {
  const rrp = Number(policy?.recommended_retail_price) || 0;
  return rrp > policyCoveredValue(policy, maxCoveredValue) + 1e-9;
}

/** Label for the badge shown next to a retail price above the cap. */
export function coveredUpToLabel(policy: PolicyLike | null | undefined, maxCoveredValue: number): string {
  return `Covered up to €${policyCoveredValue(policy, maxCoveredValue).toLocaleString("en-EU", { maximumFractionDigits: 0 })}`;
}
