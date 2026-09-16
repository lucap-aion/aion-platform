import { describe, it, expect } from "vitest";
import {
  catalogueDigest, buildPrompt, parseDecision, decideFocus, FOCUS_VOCABULARY,
} from "../../supabase/functions/_shared/focus-ai.ts";

// Ferragamo's real shape, which is the case the counting version gets wrong: 354 accessories
// and 60 watches, so counting says bags + accessories while the house's own commercial answer
// is bags + watches. Everything here is about making sure the model gets the evidence it
// needs to see that, and that a bad answer from it can never reach the record.
const ferragamo = () => {
  const rows = [
    ...Array.from({ length: 374 }, (_, i) => ({ name: `Borsa ${i}`, category: "Bags", price: 1200 })),
    ...Array.from({ length: 354 }, (_, i) => ({ name: `Foulard ${i}`, category: "Accessories", price: 180 })),
    ...Array.from({ length: 60 }, (_, i) => ({ name: `Orologio ${i}`, category: "Watches", price: 4200 })),
  ];
  return catalogueDigest("Ferragamo", "A Florentine house", rows, {
    products: rows.map((r) => ({ name: r.name, category: r.category, price: r.price })),
  });
};

describe("the catalogue, summarised for a decision", () => {
  it("carries value as well as count, which is the whole disagreement", () => {
    // Sixty watches at €4,200 are the point of a pilot in a way three hundred scarves are
    // not, and count alone cannot say so.
    const d = ferragamo();
    const watches = d.shelves.find((s) => s.label === "Watches");
    const accessories = d.shelves.find((s) => s.label === "Accessories");
    expect(watches?.products).toBe(60);
    expect(watches?.averagePrice).toBe(4200);
    expect(accessories!.products).toBeGreaterThan(watches!.products);
    expect(watches!.averagePrice!).toBeGreaterThan(accessories!.averagePrice!);
  });

  it("tells the model what the counting pass thought, so it can disagree on purpose", () => {
    const prompt = buildPrompt(ferragamo());
    expect(prompt).toMatch(/word-matching pass/i);
    expect(prompt).toMatch(/Accessories/);
    // And the vocabulary it must answer in.
    for (const v of ["Watches", "Bags and leather goods"]) expect(prompt).toContain(v);
  });

  it("samples names across the price range rather than off the top", () => {
    // A house should not read as a jeweller because its six dearest pieces are necklaces.
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => ({ name: `Cheap scarf ${i}`, category: "Accessories", price: 100 })),
      ...Array.from({ length: 4 }, (_, i) => ({ name: `Diamond necklace ${i}`, category: "Jewellery", price: 90000 })),
    ];
    const d = catalogueDigest("X", null, rows, { products: rows });
    expect(d.sample.some((n) => n.includes("Cheap scarf"))).toBe(true);
  });
});

describe("the answer, before it is trusted", () => {
  it("takes a clean answer", () => {
    const got = parseDecision('{"focus": ["Bags and leather goods", "Watches"], "reason": "Its two signature categories."}');
    expect(got?.focus).toBe("Bags and leather goods, Watches");
    expect(got?.reason).toBe("Its two signature categories.");
  });

  it("takes one wrapped in a fence, or in a sentence", () => {
    expect(parseDecision('Here you go:\n```json\n{"focus":["Watches"],"reason":"x"}\n```')?.focus).toBe("Watches");
  });

  it("stores OUR spelling, whatever case it comes back in", () => {
    // product_focus is matched back to a pattern to filter the deck's catalogue; the
    // comparison is on this exact string.
    expect(parseDecision('{"focus":["bags AND leather goods"],"reason":""}')?.focus)
      .toBe("Bags and leather goods");
  });

  it("refuses a category nobody has heard of", () => {
    // An invented category reaches a client on a data request and produces a deck with no
    // pieces in it — both silently. Better to fall back to counting.
    expect(parseDecision('{"focus":["Handbags & Small Leather Goods"],"reason":"x"}')).toBe(null);
    expect(parseDecision('{"focus":[],"reason":"x"}')).toBe(null);
    expect(parseDecision("not json at all")).toBe(null);
    expect(parseDecision("")).toBe(null);
  });

  it("keeps at most two, in the order given", () => {
    const got = parseDecision('{"focus":["Watches","Bags and leather goods","Shoes"],"reason":""}');
    expect(got?.focus).toBe("Watches, Bags and leather goods");
  });

  it("only ever answers in the vocabulary the rest of the system speaks", () => {
    for (const v of FOCUS_VOCABULARY) {
      expect(parseDecision(JSON.stringify({ focus: [v], reason: "" }))?.focus).toBe(v);
    }
  });
});

describe("falling back", () => {
  const evidence = {
    products: [
      ...Array.from({ length: 20 }, () => ({ name: "Diamond ring", category: "Jewellery" })),
      ...Array.from({ length: 2 }, () => ({ name: "Leather tote bag", category: "Bags" })),
    ],
  };
  const digest = catalogueDigest("X", null, evidence.products, evidence);

  it("uses the model when it answers", async () => {
    const got = await decideFocus(digest, evidence, async () =>
      '{"focus":["Watches"],"reason":"because"}');
    expect(got).toMatchObject({ focus: "Watches", source: "ai", reason: "because" });
  });

  it("counts when there is no model at all", async () => {
    const got = await decideFocus(digest, evidence, null);
    expect(got?.source).toBe("counted");
    expect(got?.focus).toContain("High jewellery");
  });

  it("counts when the model throws, rather than failing the run", async () => {
    // A branding stage must not fail because an API is down.
    const got = await decideFocus(digest, evidence, async () => { throw new Error("503"); });
    expect(got?.source).toBe("counted");
  });

  it("counts when the model answers with nonsense", async () => {
    const got = await decideFocus(digest, evidence, async () => "¯\\_(ツ)_/¯");
    expect(got?.source).toBe("counted");
  });

  it("says nothing when there is nothing to say", async () => {
    // No catalogue and no recognisable words: blank beats a guess, because this line goes on
    // a document telling a client what their pilot covers.
    expect(await decideFocus(
      catalogueDigest("X", null, [], {}), {}, async () => '{"focus":["Watches"],"reason":""}',
    )).toBe(null);
  });
});
