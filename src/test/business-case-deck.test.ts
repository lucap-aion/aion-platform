import { describe, it, expect } from "vitest";
import {
  businessCaseSlides, borrowedForReview, rateSource, isIndicativeRate, eur, eurPiece, pct,
  type BusinessCase,
} from "../../supabase/functions/_shared/business-case-deck.ts";
import { slideXml, MARK, type DeckSlide } from "../../supabase/functions/_shared/pptx-slides.ts";
import { FIXTURE_CASE, BORROWED_FROM, SIX_SEGMENT_CASE } from "./fixtures/business-case";

const page = { brand: "EXAMPLE MAISON" };
const unescape = (t: string) =>
  t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** Every paragraph a reader sees on a slide, its runs joined. */
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) =>
    unescape([...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join("")));
const deckText = (slides: DeckSlide[]) => slides.map((s) => paragraphs(slideXml(s, "rId2", page)).join("\n")).join("\n");

const clone = (patch: (c: BusinessCase) => void): BusinessCase => {
  const c = structuredClone(FIXTURE_CASE);
  patch(c);
  return c;
};

describe("the business case deck", () => {
  const slides = businessCaseSlides("Example Maison", FIXTURE_CASE);
  const text = deckText(slides);

  it("carries every figure the bullet deck carried", () => {
    const c = FIXTURE_CASE;
    const f = c.aion_fees!;
    const pp = c.per_product!;
    const want = [
      // perimeter
      `${c.months} months`, eur(c.revenues_covered), "2,828", eur(c.average_price!),
      ...c.segments.flatMap((s) => [s.segment, eur(s.revenues_covered), Number(s.units).toLocaleString("en-US")]),
      // insurance
      ...c.segments.flatMap((s) => [pct(s.rate_of_cogs), eur(s.gross_premium)]),
      eur(c.gross_premium), eur(c.net_premium),
      // AION fees
      `Tier ${f.tier}`, eur(f.setup!), eur(f.service!), eur(f.activation!), eur(f.total!),
      `${eur(f.service_fee_month!)}/month`, "the first 12 months at 50% off", "then 24 at full rate",
      // per piece
      eurPiece(pp.insurer_fee), eurPiece(pp.aion_fee), `${eurPiece(pp.total)} per piece`,
      pct(pp.total_pct_of_price), pct(pp.total_pct_of_price_incl_vat), "VAT at 22%",
      eurPiece(pp.setup), eurPiece(pp.total_with_setup),
      // summary
      eur(c.total_cost_to_brand),
      "Figures are a model, not an offer — the formal insurer quotation governs.",
      "Rates were quoted at a different volume than this perimeter declares.",
      // provenance
      ...c.notes!,
    ];
    for (const w of want) expect(text, w).toContain(w);
  });

  it("draws the figures, not bullets: tiles, a table, bars and cards", () => {
    expect(slides.map((s) => s.kind)).toEqual(["section", "metrics", "bars", "metrics", "stack", "stack", "sources"]);
    const xml = slides.map((s) => slideXml(s, null, page)).join("");
    expect(xml).toContain("<a:tbl>");
    expect(xml).toContain(`prst="mathEqual"`);
    expect(xml).not.toContain(`<a:buChar char="—"/>`);
  });

  it("says INDICATIVE loudly when the case is indicative", () => {
    // A pill on every content slide, a warning block on the provenance slide, the cover says it.
    for (const s of slides.slice(1)) expect(paragraphs(slideXml(s, null, page)), s.kind).toContain("INDICATIVE");
    const sources = paragraphs(slideXml(slides[6], null, page)).join("\n");
    expect(sources).toMatch(/One rate below was quoted for a comparable house in the same category, not for Example Maison/);
    expect(paragraphs(slideXml(slides[0], null, page)).join(" ")).toContain("Indicative");
    expect(text).toContain("Rates are INDICATIVE — quoted for another house, pending formal quotation.");
  });

  it("says nothing indicative when every rate is the house's own", () => {
    const own = clone((c) => {
      c.indicative = false;
      c.rates_used = c.rates_used!.map((r) => ({ ...r, rate_source: "own_quote", own_quote: true, quoted_for: null }));
      c.segments = c.segments.map((s) => ({ ...s, rate_source: "own_quote" }));
    });
    const t = deckText(businessCaseSlides("Example Maison", own));
    expect(t).not.toMatch(/indicative/i);
    expect(t).toContain("Insurer quote for Example Maison");
    expect(t).toContain("Rates as quoted for this house.");
  });

  it("labels a record-sourced rate as the brand record's, and never calls it a quote", () => {
    const sources = paragraphs(slideXml(slides[6], null, page));
    expect(sources).toContain("Agreed rate on the brand record");
    expect(sources).toContain("Specific to bags");
    expect(paragraphs(slideXml(slides[2], null, page))).toContain("Brand record · category");
    // The record rate has no insurer and no date; nothing reads "null".
    expect(text).not.toMatch(/null|undefined|NaN/);
  });

  it("treats the record's house-wide default as indicative, like the SQL does", () => {
    expect(isIndicativeRate({ rate_source: "record_brand" })).toBe(true);
    expect(isIndicativeRate({ rate_source: "record_category", own_quote: true })).toBe(false);
    const houseWide = clone((c) => {
      c.rates_used = [{ ...c.rates_used![0], rate_source: "record_brand", own_quote: false }];
      c.segments = [{ ...c.segments[0], rate_source: "record_brand" }];
      c.notes = [];
    });
    const s = businessCaseSlides("Example Maison", houseWide);
    const t = deckText(s);
    expect(t).toContain("House-wide default — no rate agreed for this category yet");
    expect(t).toContain("the house-wide default on Example Maison's record");
    expect(t).toContain("Brand record · house-wide · indicative");
    expect(t).toContain("Rates are INDICATIVE — the house-wide default on the brand record, pending formal quotation.");
  });

  it("falls back to own_quote when a case predates rate_source", () => {
    expect(rateSource({ own_quote: true })).toBe("own_quote");
    expect(rateSource({ own_quote: false })).toBe("borrowed_quote");
    expect(rateSource({ rate_source: "nonsense", own_quote: true })).toBe("own_quote");
  });

  it("never names the house a borrowed rate was quoted for — that is for the review notes", () => {
    expect(text).not.toContain(BORROWED_FROM);
    expect(text).toContain("Insurer quote for a comparable house in the same category");
    expect(borrowedForReview(FIXTURE_CASE)).toContain(BORROWED_FROM);
    // Nor the record's internal note.
    expect(text).not.toContain("finance team");
  });

  it("never shows AION's share of the net premium, or what AION earns — the deck goes to the house", () => {
    expect(text).not.toContain(eur(FIXTURE_CASE.aion_total_revenue));
    expect(text).not.toContain(eur(FIXTURE_CASE.aion_insurance_revenue!));
    expect(text).not.toMatch(/share of the net premium|AION revenue|AION earns|\(25%\)/i);
  });

  it("says what the service discount is, not only that there is one", () => {
    const disc = clone((c) => { c.aion_fees = { ...c.aion_fees!, service_discount: 0.5, setup_discount: 0.5 }; });
    const t = deckText(businessCaseSlides("X", disc));
    const svc = disc.aion_fees!.service_fee_month!;
    expect(t).toContain(`the first 12 months at 50% off (${eur(svc / 2)}/month) — AION's launch discount — then 24 at full rate.`);
    expect(t).toContain("One-off, 50% launch discount");
  });

  it("says so when a case sets no service discount, or one for the whole period", () => {
    const none = clone((c) => {
      c.aion_fees = { ...c.aion_fees!, service_discount: 0, service_months_discounted: 0, service_months_full: 36, setup_discount: 0 };
    });
    const t = deckText(businessCaseSlides("X", none));
    expect(t).toContain("all 36 months at full rate, no launch discount.");
    expect(t).not.toContain("launch discount — then");
    expect(t).not.toContain("One-off, 0%");
    const whole = clone((c) => {
      c.aion_fees = { ...c.aion_fees!, service_discount: 0.3, service_months_discounted: 36, service_months_full: 0 };
    });
    expect(deckText(businessCaseSlides("X", whole))).toContain("all 36 months at 30% off");
  });

  it("shows the activation rate per segment when the segments differ", () => {
    expect(text).toContain("Bags and leather goods 0.08% · Shoes at the tier's rate");
    const uniform = clone((c) => { c.segments = c.segments.map((s) => ({ ...s, activation_fee_pct: 0.001 })); });
    expect(deckText(businessCaseSlides("X", uniform))).toContain("0.1% of covered revenues");
    // Absent altogether: nothing claimed.
    const none = clone((c) => { c.segments = c.segments.map(({ activation_fee_pct, aion_premium_share, ...s }) => s); });
    const t = deckText(businessCaseSlides("X", none));
    expect(t).toContain("A share of the covered revenues set by the tier");
  });

  it("says the service fee is on quotation when the tier has none", () => {
    const quoted = clone((c) => {
      c.aion_fees = { ...c.aion_fees!, service_fee_month: null, service: 0, service_note: "tier 3 service fee is on quotation" };
    });
    const t = deckText(businessCaseSlides("X", quoted));
    expect(t).toContain("On quotation");
    expect(t).toContain("Service fee: tier 3 service fee is on quotation");
  });

  it("asks for an average price when there are no per-piece figures", () => {
    const noPrice = clone((c) => { c.per_product = null; c.products_covered = null; c.average_price = null; });
    const t = deckText(businessCaseSlides("X", noPrice));
    expect(t).toContain("Average price not supplied — add an average price per segment for per-piece figures.");
  });
});

describe("the business case deck's drawing", () => {
  const FLOOR = MARK.y - 260000;
  const variants: Record<string, BusinessCase> = {
    fixture: FIXTURE_CASE,
    sixSegments: SIX_SEGMENT_CASE,
    noPerPiece: clone((c) => { c.per_product = null; }),
    onQuotation: clone((c) => { c.aion_fees = { ...c.aion_fees!, service_fee_month: null, service: 0, service_note: "tier 3 service fee is on quotation" }; }),
    ownQuotes: clone((c) => { c.indicative = false; c.notes = []; c.volume_band_mismatch = false; }),
    longHouse: FIXTURE_CASE,
  };

  for (const [name, c] of Object.entries(variants)) {
    const house = name === "longHouse" ? "Maison Exemplaire de Haute Joaillerie et Maroquinerie" : "Example Maison";
    const slides = businessCaseSlides(house, c);

    it(`${name}: unique shape ids and well-formed XML`, () => {
      for (const s of slides) {
        const xml = slideXml(s, "rId2", page);
        const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
        expect(new Set(ids).size, s.kind).toBe(ids.length);
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        expect(doc.getElementsByTagName("parsererror").length, s.kind).toBe(0);
      }
    });

    it(`${name}: nothing drawn below the floor, and no page number of its own`, () => {
      // The template's master draws the wordmark and the slide number at the foot; content
      // that reaches down there collides with them in the real deck.
      for (const [i, s] of slides.entries()) {
        const xml = slideXml(s, "rId2", page);
        for (const m of xml.matchAll(/<p:cNvPr id="(\d+)"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/g)) {
          if (m[1] === "990" || m[1] === "991") continue;
          expect(Number(m[3]) + Number(m[5]), `${name} slide ${i + 1} shape ${m[1]}`).toBeLessThanOrEqual(FLOOR);
        }
        expect(xml).not.toMatch(/type="slidenum"/);
      }
    });
  }
});
