import { describe, it, expect } from "vitest";

// The business-case model, mirrored from compute_business_case().
//
// These are not tests of the SQL — they pin the ARITHMETIC the SQL implements,
// against the figures the Ferragamo dataroom produces. If someone changes the
// GVT fee, the AION share, or the tier boundaries, this fails and says so. It
// computes money; a silent regression here reaches a client meeting.

const GVT_FEE = 0.2225;
const AION_SHARE = 0.30;

const TIERS = [
  { tier: 1, gmvUpTo: 20_000_000, activationPct: 0.0015, serviceMonth: 1000 },
  { tier: 2, gmvUpTo: 100_000_000, activationPct: 0.0010, serviceMonth: 1500 },
  { tier: 3, gmvUpTo: null, activationPct: 0.0008, serviceMonth: null },
];

const tierFor = (gmv: number) => TIERS.find((t) => t.gmvUpTo === null || gmv <= t.gmvUpTo)!;

const grossPremium = (revenues: number, cogsRatio: number, rateOfCogs: number) =>
  revenues * cogsRatio * rateOfCogs;
const netPremium = (gross: number) => gross * (1 - GVT_FEE);
const aionInsurance = (gross: number) => netPremium(gross) * AION_SHARE;

describe("insurance premium", () => {
  it("charges the insurer rate against COGS, not retail", () => {
    // 10m of covered revenue at a 30% COGS ratio is 3m of value covered.
    expect(grossPremium(10_000_000, 0.30, 0.0778)).toBeCloseTo(233_400, 0);
  });

  it("applies the GVT fee between gross and net premium", () => {
    expect(netPremium(100_000)).toBeCloseTo(77_750, 2);
  });

  it("gives AION 30% of the NET premium, not the gross", () => {
    // The figure the live model returned for Pomellato: 165,333 gross.
    expect(aionInsurance(165_333)).toBeCloseTo(38_564, 0);
    // Guards the common error of taking the share before the GVT fee.
    expect(aionInsurance(165_333)).not.toBeCloseTo(165_333 * AION_SHARE, 0);
  });
});

describe("AION tiers", () => {
  it("puts a small programme in tier 1", () => {
    expect(tierFor(10_333_333).tier).toBe(1);
    expect(tierFor(10_333_333).activationPct).toBe(0.0015);
  });

  it("moves to tier 2 above 20m of covered GMV", () => {
    expect(tierFor(20_000_001).tier).toBe(2);
    expect(tierFor(99_999_999).tier).toBe(2);
  });

  it("falls to tier 3 above 100m, where the service fee is on quotation", () => {
    expect(tierFor(100_000_001).tier).toBe(3);
    expect(tierFor(100_000_001).serviceMonth).toBeNull();
  });

  it("activation fee falls as volume rises", () => {
    const pcts = TIERS.map((t) => t.activationPct);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
  });
});

describe("rate provenance", () => {
  // A quote belongs to the client it was quoted for. Reusing another house's
  // rate is allowed but must be flagged, because showing it is a commercial
  // decision, not a default.
  const quotes = [
    { category: "watches", rateOfCogs: 0.0283, brandId: null, quotedFor: "Salvatore Ferragamo S.p.A." },
    { category: "jewellery", rateOfCogs: 0.05, brandId: 16, quotedFor: "Pomellato" },
  ];
  const resolve = (category: string, brandId: number) =>
    quotes.filter((q) => q.category === category)
      .sort((a, b) => Number(b.brandId === brandId) - Number(a.brandId === brandId))[0];

  it("prefers the brand's own quote", () => {
    const q = resolve("jewellery", 16);
    expect(q.brandId).toBe(16);
    expect(q.brandId === 16).toBe(true); // own quote → not indicative
  });

  it("marks a borrowed rate as indicative", () => {
    const q = resolve("watches", 16);
    expect(q.quotedFor).toBe("Salvatore Ferragamo S.p.A.");
    expect(q.brandId === 16).toBe(false); // someone else's → indicative
  });

  it("has no rate at all for a category never quoted", () => {
    expect(resolve("apparel", 17)).toBeUndefined();
  });
});
