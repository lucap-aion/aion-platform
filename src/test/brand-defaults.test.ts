import { describe, it, expect } from "vitest";
import {
  policyPrefix, productFocus, categoryWords, renderFaqs, STANDARD_FEE_RATES,
} from "../../supabase/functions/_shared/brand-defaults.ts";
import { FAQ_TEMPLATE_EN, FAQ_TEMPLATE_IT } from "../../supabase/functions/_shared/faq-template.ts";

// What a brand record should arrive with, rather than being typed in per house.

describe("the Chubb policy prefix", () => {
  it("reproduces the shape the live programmes already use", () => {
    // ROCIT and POMIT are on the two brands that have one. A new brand's prefix has to look
    // like a sibling of those, not like a different scheme.
    expect(policyPrefix("Roberto Coin", "Italy")).toBe("ROCIT");
    expect(policyPrefix("Pomellato", "Italy")).toBe("POMIT");
    expect(policyPrefix("Pasquale Bruni", "Italy")).toBe("PABIT");
    expect(policyPrefix("Buccellati", "Italy")).toBe("BUCIT");
  });

  it("handles accents, punctuation and a name too short to give three letters", () => {
    expect(policyPrefix("Hermès", "France")).toBe("HERFR");
    expect(policyPrefix("Dolce & Gabbana", "Italy")).toBe("DOGIT");
    expect(policyPrefix("Y", "Italy")).toBe("YXXIT");
  });

  it("takes a country code as given, and falls back rather than inventing one", () => {
    expect(policyPrefix("Cartier", "fr")).toBe("CARFR");
    expect(policyPrefix("Cartier", null)).toBe("CARXX");
  });

  it("never hands two brands the same prefix", () => {
    // A policy number has to be unambiguous in a Chubb bordereau, which is the one place it
    // absolutely must be.
    expect(policyPrefix("Bulgari", "Italy", ["BULIT"])).toBe("BULIT2");
    expect(policyPrefix("Bulgari", "Italy", ["BULIT", "BULIT2"])).toBe("BULIT3");
  });
});

describe("product focus", () => {
  it("reads what a house sells out of its catalogue, not its marketing", () => {
    expect(productFocus({
      names: ["Nudo Classic Ring", "Iconica Bracelet", "Sabbia Earrings", "Catene Necklace"],
      categories: [null, null],
      description: "A Milanese house with a story to tell",
    })).toBe("High jewellery");
  });

  it("orders by how much of the catalogue each category is", () => {
    // Three bags against four hundred rings is a jeweller who also sells bags.
    const focus = productFocus({
      names: [...Array(20).fill("Diamond Ring"), "Leather tote bag", "Leather clutch bag"],
    });
    expect(focus).toBe("High jewellery, Bags and leather goods");
  });

  it("falls back to the description when there is no catalogue yet", () => {
    expect(productFocus({ description: "Florentine leather goods and shoes since 1927" }))
      .toContain("Bags and leather goods");
  });

  it("says nothing rather than guessing", () => {
    expect(productFocus({ names: ["Gift card", "Special edition"] })).toBe(null);
  });

  it("gives the FAQ the right word for a piece, in both languages", () => {
    expect(categoryWords({ names: ["Nudo Ring"] })).toMatchObject({ en: "jewellery", it: "gioielli" });
    expect(categoryWords({ names: ["Hug tote bag"] })).toMatchObject({ en: "bags and leather goods", itSingular: "borsa" });
    // Nothing recognisable: neutral wording, never a wrong noun.
    expect(categoryWords({})).toMatchObject({ en: "pieces", it: "articoli" });
  });
});

describe("the customer FAQ", () => {
  it("carries no trace of the house it was written for", () => {
    // The template is the live programme's approved text. If any of it survives, a prospect
    // reads another client's name in their own FAQ tab.
    const blob = JSON.stringify([...FAQ_TEMPLATE_EN, ...FAQ_TEMPLATE_IT]);
    for (const trace of [
      "Roberto", "Coin", "robertocoin", "Rome", "Venice", "Roma", "Venezia",
      "December 22", "dicembre 2025", "jewelry", "gioielli", "100,000", "100.000",
    ]) expect(blob).not.toContain(trace);
  });

  it("renders all seventeen questions in both languages", () => {
    const { en, it } = renderFaqs({ brand: "Buccellati", evidence: { names: ["Anello Opera"] } });
    expect(en).toHaveLength(17);
    expect(it).toHaveLength(17);
    expect(en[0].content.type).toBe("blocks");
  });

  it("puts this brand, its band and its category into the text", () => {
    const { en, it } = renderFaqs({
      brand: "Buccellati",
      minCoveredValue: 999,
      maxCoveredValue: 100000,
      supportEmail: "clientservice@buccellati.com",
      evidence: { names: ["Anello Cocktail", "Bracciale Sabbia"] },
    });
    const flat = (entries: typeof en) => JSON.stringify(entries);
    expect(en[0].title).toBe("What is Buccellati Prestige Service?");
    // The customer-facing floor is a euro above the value the platform refuses to activate.
    expect(flat(en)).toContain("euro 1,000");
    expect(flat(en)).toContain("euro 100,000");
    expect(flat(it)).toContain("euro 1.000");
    expect(flat(en)).toContain("jewellery");
    expect(flat(it)).toContain("gioielli");
    expect(flat(en)).toContain("clientservice@buccellati.com");
    expect(flat(en)).not.toContain("{{");
    expect(flat(it)).not.toContain("{{");
  });

  it("stays general about the things nobody can know yet", () => {
    // A guessed launch date in a customer-facing FAQ is a commitment the brand never made.
    const { en, it } = renderFaqs({ brand: "Bulgari" });
    expect(JSON.stringify(en)).toContain("from the launch of the programme");
    expect(JSON.stringify(en)).toContain("in the official boutiques taking part");
    expect(JSON.stringify(it)).toContain("dall’avvio del programma");
    // No email on the record: a phrase, not a broken mailto.
    expect(JSON.stringify(en)).toContain("the brand’s customer service");
  });

  it("keeps the list blocks that carry the exclusions and the claim requirements", () => {
    const { en } = renderFaqs({ brand: "Bulgari" });
    const lists = en.flatMap((e) => e.content.blocks).filter((b) => b.type === "ul");
    expect(lists.length).toBeGreaterThan(2);
  });
});

describe("fee rates", () => {
  it("are the programme's standard terms", () => {
    // Read off the house in production on 2026-09-12.
    expect(STANDARD_FEE_RATES).toEqual({
      activation_fee: 0.0015,
      insurance_premium: 0.06,
      aion_premium_fee: 0.3,
      min_covered_value: 999,
      max_covered_value: 100000,
    });
  });
});
