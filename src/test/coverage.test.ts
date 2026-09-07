import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAX_COVERED_VALUE,
  coveredCogs,
  coveredRetailValue,
  coveredUpToLabel,
  isAboveCoverageCap,
  policyCoveredValue,
  resolveMaxCoveredValue,
} from "@/lib/coverage";

describe("coverage cap", () => {
  it("resolves the brand ceiling with a 100k default", () => {
    expect(resolveMaxCoveredValue(null)).toBe(DEFAULT_MAX_COVERED_VALUE);
    expect(resolveMaxCoveredValue({ max_covered_value: null })).toBe(100000);
    expect(resolveMaxCoveredValue({ max_covered_value: 50000 })).toBe(50000);
  });

  it("caps the retail value and the COGS (policy 761: 480k necklace, 30% collars)", () => {
    expect(coveredRetailValue(480000, 100000)).toBe(100000);
    expect(coveredCogs(480000, 0.3, 100000)).toBe(30000);
    expect(coveredRetailValue(46721.31, 100000)).toBe(46721.31);
    expect(coveredCogs("14000", 0.25, 100000)).toBe(3500);
    expect(coveredRetailValue(null, 100000)).toBe(0);
  });

  it("prefers the value frozen on the policy over the current ceiling", () => {
    const frozen = { recommended_retail_price: 480000, covered_value: 100000 };
    expect(policyCoveredValue(frozen, 200000)).toBe(100000);
    expect(policyCoveredValue({ recommended_retail_price: 480000, covered_value: null }, 200000)).toBe(200000);
    expect(isAboveCoverageCap(frozen, 100000)).toBe(true);
    expect(isAboveCoverageCap({ recommended_retail_price: 5030, covered_value: 5030 }, 100000)).toBe(false);
    expect(coveredUpToLabel(frozen, 100000)).toBe("Covered up to €100,000");
  });
});
