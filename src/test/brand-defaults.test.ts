import { describe, it, expect } from "vitest";
import {
  policyPrefix, productFocus, categoryWords, renderFaqs, customerServiceEmail,
  STANDARD_FEE_RATES,
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

// ── The address a customer writes to ─────────────────────────────────────────────────────
describe("finding a customer-service address", () => {
  const site = "https://www.buccellati.com";

  it("takes a role address on the brand's own domain", () => {
    const text = "For assistance contact info@buccellati.com or visit a boutique.";
    expect(customerServiceEmail(text, site)).toBe("info@buccellati.com");
  });

  it("refuses a named individual, which is what these pages are full of", () => {
    // The real crawl of one house yielded arabella-xy.zhang@, douglas.lim@, aspen@,
    // beverlyhills@ and info@. Only the last is an address a client should be given, and
    // putting a salesperson's into a customer-facing FAQ is the failure to avoid.
    const text = "arabella-xy.zhang@buccellati.com douglas.lim@buccellati.com aspen@buccellati.com beverlyhills@buccellati.com";
    expect(customerServiceEmail(text, site)).toBe(null);
  });

  it("prefers client service over a generic inbox", () => {
    const text = "info@buccellati.com and clientservice@buccellati.com";
    expect(customerServiceEmail(text, site)).toBe("clientservice@buccellati.com");
  });

  it("ignores another company's address", () => {
    expect(customerServiceEmail("info@some-agency.com support@shopify.com", site)).toBe(null);
  });

  it("accepts a subdomain of the brand's own site", () => {
    expect(customerServiceEmail("care@help.buccellati.com", site)).toBe("care@help.buccellati.com");
    // One house's client-care address really is on a subdomain like this.
    expect(customerServiceEmail("customercare@sf.ferragamo.com", "https://www.ferragamo.com"))
      .toBe("customercare@sf.ferragamo.com");
  });

  it("accepts the same house on another TLD", () => {
    // The site is .com and the mailbox is .it, which is how one of these brands publishes it.
    expect(customerServiceEmail("info@luisabeccaria.it", "https://www.luisabeccaria.com"))
      .toBe("info@luisabeccaria.it");
  });

  it("still refuses a boutique address, which is not where a claim should go", () => {
    expect(customerServiceEmail("boutique.milano@pasqualebruni.com", "https://www.pasqualebruni.com")).toBe(null);
  });

  it("strips the punctuation a sentence leaves behind", () => {
    expect(customerServiceEmail("write to info@buccellati.com.", site)).toBe("info@buccellati.com");
  });

  it("puts the address it finds into the FAQ", () => {
    const { en } = renderFaqs({ brand: "Buccellati", supportEmail: "info@buccellati.com" });
    expect(JSON.stringify(en)).toContain("info@buccellati.com");
    expect(JSON.stringify(en)).not.toContain("the brand’s customer service");
  });
});

// ── Does this generalise past the houses it was built against? ───────────────────────────
describe("brands other than the ones this was tested on", () => {
  it("finds a role address in French, German, Spanish and Italian", () => {
    const cases: [string, string, string][] = [
      ["serviceclient@chanel.com", "https://www.chanel.com", "serviceclient@chanel.com"],
      ["kundenservice@montblanc.com", "https://www.montblanc.com", "kundenservice@montblanc.com"],
      ["servicioclientes@loewe.com", "https://www.loewe.com", "servicioclientes@loewe.com"],
      ["servizioclienti@damiani.com", "https://www.damiani.com", "servizioclienti@damiani.com"],
    ];
    for (const [text, site, expected] of cases) {
      expect(customerServiceEmail(text, site)).toBe(expected);
    }
  });

  it("names a category outside jewellery, watches and bags", () => {
    // A silversmith, a perfumer and a pen maker were all "pieces" before.
    expect(productFocus({ names: ["Silver centrepiece", "Silver tray", "Candelabra"] }))
      .toContain("Silver and tableware");
    expect(productFocus({ names: ["Eau de Parfum 100ml", "Cologne intense"] }))
      .toContain("Fragrance and beauty");
    expect(productFocus({ names: ["Meisterstück fountain pen", "Rollerball"] }))
      .toContain("Writing instruments");
    expect(productFocus({ names: ["Silk scarf", "Cashmere gloves"] })).toContain("Accessories");
  });

  it("still refuses to name one it cannot recognise", () => {
    // The point of the vocabulary is that an unknown category reads as unknown, not as a
    // guess: the focus goes on a data request and into a customer FAQ.
    expect(productFocus({ names: ["Model 42", "Series B"] })).toBe(null);
    expect(categoryWords({ names: ["Model 42"] })).toMatchObject({ en: "pieces" });
  });

  it("builds a prefix for a house in any country the record names", () => {
    expect(policyPrefix("Chanel", "France")).toBe("CHAFR");
    expect(policyPrefix("Montblanc", "Germany")).toBe("MONDE");
    expect(policyPrefix("Loewe", "Spain")).toBe("LOEES");
    expect(policyPrefix("Van Cleef & Arpels", "France")).toBe("VACFR");
  });
});

// ── The one address a client is meant to write to ────────────────────────────────────────
describe("taking the best address a house actually publishes", () => {
  const messika = "https://www.messika.com";

  it("accepts the group domain a house publishes its client address on", () => {
    // messika.com's own pages give conciergerie@MESSIKAGROUP.com 219 times over. An
    // exact-label rule threw away the one address on the site a client is meant to use, and
    // the field went to the data request for a person to fill in by hand.
    expect(customerServiceEmail("write to conciergerie@messikagroup.com", messika))
      .toBe("conciergerie@messikagroup.com");
  });

  it("still refuses a different company whose name merely starts the same way", () => {
    // "coinbase" is not Roberto Coin, and "messikaland" is nobody.
    expect(customerServiceEmail("info@coinbase.com", "https://www.robertocoin.com")).toBe(null);
    expect(customerServiceEmail("info@messikaland.com", messika)).toBe(null);
  });

  it("refuses an address that reaches the wrong desk, even on the right domain", () => {
    // A client with a damaged ring must not be sent to a data-protection officer, a press
    // office, or a mailbox that discards what it receives.
    for (const bad of ["privacy", "dpo", "legal", "press", "jobs", "noreply", "billing", "webmaster"]) {
      expect(customerServiceEmail(`${bad}@messika.com`, messika), bad).toBe(null);
    }
  });

  it("drops a fragment a line break made of a real address", () => {
    // Crawling messika.com turned up "rie@messikagroup.com" beside the real one, because a
    // line break fell inside the word.
    expect(customerServiceEmail("rie@messikagroup.com conciergerie@messikagroup.com", messika))
      .toBe("conciergerie@messikagroup.com");
  });

  it("prefers client care over a shop address, and a shop address over nothing", () => {
    expect(customerServiceEmail("eshop@messika.com conciergerie@messika.com", messika))
      .toBe("conciergerie@messika.com");
    expect(customerServiceEmail("eshop@messika.com", messika)).toBe("eshop@messika.com");
  });

  it("takes the e-commerce desk when that is the only one published", () => {
    // pasqualebruni.com publishes three boutique addresses, a whistleblowing line on a law
    // firm's domain, a PEC address — and ecommerce@, which is the only one a customer
    // should be given.
    const site = "https://www.pasqualebruni.com";
    const text = "whistleblowing@noverim.it boutique.newyork@pasqualebruni.com " +
      "ecommerce@pasqualebruni.com pasqualebrunispa@pec.pasqualebruni.com";
    expect(customerServiceEmail(text, site)).toBe("ecommerce@pasqualebruni.com");
  });

  it("never gives a client a PEC address", () => {
    // Italy's certified mail: legally binding, read by lawyers and administrators, and on
    // the house's own domain — so only a rule about the subdomain stops it.
    expect(customerServiceEmail("info@pec.pasqualebruni.com", "https://www.pasqualebruni.com")).toBe(null);
  });

  it("keeps refusing a person and a single boutique", () => {
    // The rule this widening must not undo.
    expect(customerServiceEmail("douglas.lim@messika.com aspen@messika.com", messika)).toBe(null);
    expect(customerServiceEmail("boutique.milano@pasqualebruni.com", "https://www.pasqualebruni.com")).toBe(null);
  });
});
