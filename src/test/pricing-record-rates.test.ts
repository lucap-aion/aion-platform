import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultMonths, resolveRates, recordRowFor, type RecordCategory } from "@/pages/admin/_components/pricing-model";

// "Fee rates should flow into commercial cycle pricing." The model resolves each segment's
// rate in SQL; the panel resolves it again to warn before Calculate and to show a per-piece
// cost with no revenue typed. Two copies of one order, so the order is pinned here.

const rows: RecordCategory[] = [
  { category: "bags", label: "Bags and leather goods", insurance_premium: 0.05, activation_fee: 0.002, aion_premium_fee: 0.25 },
  { category: "other", label: "Eyewear", insurance_premium: null, activation_fee: null, aion_premium_fee: null },
];
const brand = { insurance_premium: 0.06, activation_fee: 0.0015, aion_premium_fee: 0.3 };
const quote = (category: string, brand_id: number | null, rate = 0.0778) =>
  ({ category, coverage: "theft_and_damage", brand_id, active: true, rate_of_cogs: rate });
const seg = (name: string, category: string) => ({ name, category, coverage: "theft_and_damage" });

describe("the record's rates price the business case", () => {
  it("finds a segment's record row by name before class", () => {
    expect(recordRowFor(seg("Eyewear", "other"), rows)?.label).toBe("Eyewear");
    expect(recordRowFor(seg("Pilot — EU", "bags"), rows)?.label).toBe("Bags and leather goods");
    expect(recordRowFor(seg("Watches", "watches"), rows)).toBeNull();
  });

  it("own quote → record category → record house-wide → borrowed quote", () => {
    // "Quote for the brand, category rate on the Record, general rate on the Record, quote for
    // another brand." This house's own quote beats even a category rate on its record.
    expect(resolveRates(seg("Bags and leather goods", "bags"), rows, brand, [quote("bags", 21)], 21))
      .toMatchObject({ rate: 0.0778, source: "own_quote", activation: 0.002, share: 0.25 });
    expect(resolveRates(seg("Bags and leather goods", "bags"), rows, brand, [quote("bags", 99)], 21))
      .toMatchObject({ rate: 0.05, source: "record_category" });
    // The record's house-wide rate beats a quote borrowed from another house.
    expect(resolveRates(seg("Watches", "watches"), [], brand, [quote("watches", 99, 0.0283)], 21))
      .toMatchObject({ rate: 0.06, source: "record_brand", activation: 0.0015, share: 0.3 });
    expect(resolveRates(seg("Watches", "watches"), [], null, [quote("watches", 99, 0.0283)], 21))
      .toMatchObject({ rate: 0.0283, source: "borrowed_quote" });
    expect(resolveRates(seg("Shoes", "leather"), [], null, [], 21, 0.3))
      .toMatchObject({ rate: null, source: null, share: 0.3 });
  });

  it("takes the COGS ratio from the segment, else the record's category, else 30%", () => {
    const withCogs: RecordCategory[] = [{ ...rows[0], cogs_ratio: 0.4 }];
    expect(resolveRates({ ...seg("Bags and leather goods", "bags"), cogs_ratio: "0.25" }, withCogs, brand, [], 21))
      .toMatchObject({ cogs: 0.25, cogsFrom: "segment" });
    expect(resolveRates({ ...seg("Bags and leather goods", "bags"), cogs_ratio: "" }, withCogs, brand, [], 21))
      .toMatchObject({ cogs: 0.4, cogsFrom: "record" });
    expect(resolveRates(seg("Shoes", "leather"), withCogs, brand, [], 21))
      .toMatchObject({ cogs: 0.3, cogsFrom: "default" });
  });

  it("models the insurance term when nobody has typed one — not a 36 from nowhere", () => {
    const q = (brand_id: number | null, duration_years: number | null) =>
      ({ brand_id, duration_years, active: true, insurer: "Chubb" });
    expect(defaultMonths([q(99, 3), q(21, 2)], 21)).toMatchObject({ months: 24 });
    expect(defaultMonths([q(99, 2), q(98, 2), q(97, 3)], 21)).toMatchObject({ months: 24 });
    expect(defaultMonths([], 21)).toMatchObject({ months: 24 });
    expect(defaultMonths([q(21, 2)], 21).basis).toContain("Chubb's quote for this house");
  });

  it("is the order the SQL applies", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261015000001_business_case_rate_order_and_cogs.sql"), "utf8");
    const at = (needle: string) => {
      const i = sql.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("v_source := 'own_quote'"),
      at("v_source := 'record_category'"),
      at("v_source := 'record_brand'"),
      at("v_source := 'borrowed_quote'"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql).toContain("q.active and q.brand_id = p_brand_id");
    expect(sql).toContain("q.active and q.brand_id is distinct from p_brand_id");
    expect(sql).toContain("case when v_has_cat then v_cat.cogs_ratio end, 0.30)");
    expect(sql).toContain("coalesce(case when v_has_cat then v_cat.activation_fee end, b.activation_fee)");
    expect(sql).toContain("coalesce(case when v_has_cat then v_cat.aion_premium_fee end, b.aion_premium_fee, t.aion_premium_share)");
  });
});
