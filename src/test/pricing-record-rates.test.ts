import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRates, recordRowFor, type RecordCategory } from "@/pages/admin/_components/pricing-model";

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

  it("record category → own quote → borrowed quote → record house-wide", () => {
    // A category rate on the record beats even this house's own quote.
    expect(resolveRates(seg("Bags and leather goods", "bags"), rows, brand, [quote("bags", 21)], 21))
      .toMatchObject({ rate: 0.05, source: "record_category", activation: 0.002, share: 0.25 });
    expect(resolveRates(seg("Watches", "watches"), [], brand, [quote("watches", 99), quote("watches", 21, 0.03)], 21))
      .toMatchObject({ rate: 0.03, source: "own_quote" });
    expect(resolveRates(seg("Watches", "watches"), [], brand, [quote("watches", 99, 0.0283)], 21))
      .toMatchObject({ rate: 0.0283, source: "borrowed_quote" });
    // Nobody quoted shoes: priced at the record, not refused.
    expect(resolveRates(seg("Shoes", "leather"), [], brand, [], 21))
      .toMatchObject({ rate: 0.06, source: "record_brand", activation: 0.0015, share: 0.3 });
    expect(resolveRates(seg("Shoes", "leather"), [], null, [], 21, 0.3))
      .toMatchObject({ rate: null, source: null, share: 0.3 });
  });

  it("is the order the SQL applies", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261014000002_business_case_record_rates.sql"), "utf8");
    const at = (needle: string) => {
      const i = sql.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("v_source := 'record_category'"),
      at("'own_quote' else 'borrowed_quote'"),
      at("v_source := 'record_brand'"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql).toContain("(q.brand_id = p_brand_id) desc");
    expect(sql).toContain("coalesce(case when v_has_cat then v_cat.activation_fee end, b.activation_fee)");
    expect(sql).toContain("coalesce(case when v_has_cat then v_cat.aion_premium_fee end, b.aion_premium_fee, t.aion_premium_share)");
  });
});
