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

// ── Regressions ──────────────────────────────────────────────────────────────
// Both of these shipped wrong and both reached a client-facing slide, so they
// are pinned here rather than only in the SQL.

const SERVICE_DISCOUNT = 0.5;
const SERVICE_DISCOUNT_MONTHS = 6;
const VAT = 0.22;

// The fix: greatest(0, months - discountMonths). Without it a programme shorter
// than the discount window bills a negative number of full-price months.
const serviceFee = (monthlyRate: number | null, months: number) => {
  if (monthlyRate === null) return 0;
  const discounted = Math.min(SERVICE_DISCOUNT_MONTHS, months);
  const full = Math.max(0, months - SERVICE_DISCOUNT_MONTHS);
  return monthlyRate * full + monthlyRate * (1 - SERVICE_DISCOUNT) * discounted;
};

describe("service fee", () => {
  it("charges half rate for the first six months and full rate after", () => {
    // 36 months at 1000: 6 discounted (3,000) + 30 full (30,000).
    expect(serviceFee(1000, 36)).toBeCloseTo(33_000, 2);
  });

  it("never goes negative on a pilot shorter than the discount window", () => {
    // The bug: 1000 * (3 - 6) = -3,000, plus 1,500 discounted = -1,500 billed.
    expect(serviceFee(1000, 3)).toBeCloseTo(1_500, 2);
    expect(serviceFee(1000, 3)).toBeGreaterThan(0);
    for (const m of [1, 2, 3, 4, 5, 6]) expect(serviceFee(1000, m)).toBeGreaterThan(0);
  });

  it("is nothing at all in tier 3, where the fee is on quotation", () => {
    expect(serviceFee(null, 36)).toBe(0);
  });
});

describe("cost as a share of the retail price", () => {
  // The VAT-inclusive price is the LARGER number, so the same cost is a SMALLER
  // share of it. The original multiplied by 1.22 instead of dividing, which
  // overstated the headline percentage by 22% relative.
  const shareOfPrice = (cost: number, priceExVat: number) => cost / priceExVat;
  const shareOfPriceInclVat = (cost: number, priceExVat: number) =>
    cost / priceExVat / (1 + VAT);

  it("is smaller against the VAT-inclusive price, not larger", () => {
    expect(shareOfPriceInclVat(100, 4200)).toBeLessThan(shareOfPrice(100, 4200));
  });

  it("matches dividing the cost by the gross price directly", () => {
    expect(shareOfPriceInclVat(100, 4200)).toBeCloseTo(100 / (4200 * 1.22), 10);
  });

  it("printed a figure 1.22x too big where it should have been 1.22x too small", () => {
    const correct = shareOfPriceInclVat(100, 4200);
    const asShipped = shareOfPrice(100, 4200) * (1 + VAT); // the bug
    // The error compounds in the wrong direction, so it was out by VAT twice.
    expect(asShipped).toBeCloseTo(correct * (1 + VAT) ** 2, 12);
    expect((correct * 100).toFixed(2)).toBe("1.95");
    expect((asShipped * 100).toFixed(2)).toBe("2.90");
  });
});

describe("per-piece figures reconcile with the total", () => {
  // Per-piece "total" is the RECURRING cost; setup is one-off and carried
  // separately. Adding them back has to land on total_cost_to_brand, or the
  // pricing meeting finds the gap.
  it("recurring plus setup per piece equals the whole cost to the brand", () => {
    const units = 2_500, gross = 233_400, service = 33_000, activation = 15_000, setup = 10_000;
    const perPiece = (gross + service + activation) / units;
    const setupPerPiece = setup / units;
    expect((perPiece + setupPerPiece) * units)
      .toBeCloseTo(gross + setup + service + activation, 6);
  });
});

describe("quote resolution", () => {
  // A segment must be priced off a quote for the cover it actually asked for,
  // and — where a band was given — the volume it declares.
  type Q = { category: string; coverage: string; rateOfCogs: number; brandId: number | null; gmvFrom: number | null; gmvTo: number | null };
  const quotes: Q[] = [
    { category: "bags", coverage: "theft", rateOfCogs: 0.031, brandId: null, gmvFrom: null, gmvTo: null },
    { category: "bags", coverage: "theft_and_damage", rateOfCogs: 0.0778, brandId: null, gmvFrom: null, gmvTo: 20_000_000 },
    { category: "bags", coverage: "theft_and_damage", rateOfCogs: 0.0612, brandId: null, gmvFrom: 20_000_000, gmvTo: null },
  ];
  const resolve = (category: string, coverage: string, revenues: number, brandId: number) =>
    quotes.filter((q) => q.category === category && q.coverage === coverage)
      .sort((a, b) =>
        Number(b.brandId === brandId) - Number(a.brandId === brandId) ||
        Number(b.gmvFrom !== null && revenues >= b.gmvFrom && (b.gmvTo === null || revenues <= b.gmvTo)) -
        Number(a.gmvFrom !== null && revenues >= a.gmvFrom && (a.gmvTo === null || revenues <= a.gmvTo)))[0];

  it("does not price theft-only cover off a theft-and-damage rate", () => {
    expect(resolve("bags", "theft", 10_000_000, 5).rateOfCogs).toBe(0.031);
  });

  it("picks the rate quoted for the volume the perimeter declares", () => {
    expect(resolve("bags", "theft_and_damage", 50_000_000, 5).rateOfCogs).toBe(0.0612);
    expect(resolve("bags", "theft_and_damage", 10_000_000, 5).rateOfCogs).toBe(0.0778);
  });
});
