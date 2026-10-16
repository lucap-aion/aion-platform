// The business case, as a pricing deck.
//
// "Deck UI is too poor." It was six slides of bullets — every figure the model computes, set
// in the middle of a sentence — going to a luxury house as the case for paying for a
// programme. The figures were right; nobody could find them. This builds the same figures
// into the ops deck's visual language: the perimeter as key-figure tiles over a table of its
// segments, the premium as a bar per segment, the cost of one piece as a stacked bar split
// between insurer and AION, and one card per rate saying where it came from.
//
// Same numbers, same honesty. Every figure the bullet deck carried is still here (the tests
// check them one by one), and two rules from that deck hold:
//
//   - a rate quoted for ANOTHER house never names that house. The prospect is told "a
//     comparable house in the same category" and that the figures are indicative; whose
//     rate it is goes to the admin's review notes, not onto a slide
//   - "indicative" is loud: a pill on every page it is true of, and a warning block on the
//     provenance slide that cannot be skimmed past
//
// Pure: a business case in, slides out. The edge function renders them into the teaser; the
// proof script renders them locally; the tests read them. Nothing here touches the network.

import type { DeckSlide, FigureSlide } from "./pptx-slides.ts";

type SourceCard = Extract<FigureSlide, { kind: "sources" }>["cards"][number];

/**
 * Where a rate came from.
 *
 * The model used to know one source — an insurer quote, this house's own or borrowed from a
 * comparable one. It is learning a second: a rate agreed with the house and kept on its
 * record, for one category or for every category. A record-sourced rate may have no insurer,
 * quote or quote date at all, and must not be called a quote.
 */
export type RateSource = "own_quote" | "record_category" | "record_brand" | "borrowed_quote";

/** One rate the model used — `compute_business_case`'s `rates_used[]`. */
export type RateUsed = {
  segment?: string | null;
  category?: string | null;
  coverage?: string | null;
  damage_scope?: string | null;
  rate_of_cogs: number;
  insurer?: string | null;
  quote_id?: number | string | null;
  quoted_for?: string | null;
  quoted_at?: string | null;
  gmv_from?: number | null;
  gmv_to?: number | null;
  own_quote?: boolean | null;
  rate_source?: string | null;
  /**
   * Free text: the record row's note for a record rate, the quote's own source line for a
   * quote. Internal — it can name whoever a borrowed quote came from — so never on a slide.
   */
  source?: string | null;
};

/** One segment of the perimeter, as the model priced it. */
export type SegmentCase = {
  segment: string;
  category?: string | null;
  coverage?: string | null;
  damage_scope?: string | null;
  months_live?: number | null;
  revenues_covered: number;
  value_covered?: number | null;
  rate_of_cogs: number;
  gross_premium: number;
  units?: number | null;
  rate_source?: string | null;
  activation_fee_pct?: number | null;
  aion_premium_share?: number | null;
};

/** What `compute_business_case` returns when it succeeds. Only what the deck reads. */
export type BusinessCase = {
  months: number;
  segments: SegmentCase[];
  revenues_covered: number;
  products_covered?: number | null;
  average_price?: number | null;
  gross_premium: number;
  net_premium: number;
  aion_insurance_revenue?: number | null;
  aion_fees?: {
    setup?: number; service?: number; activation?: number; total?: number; tier?: number | null;
    service_fee_month?: number | null; service_months_full?: number | null;
    service_months_discounted?: number | null; service_note?: string | null;
    /** True when at least one segment's activation rate came from the brand record. */
    activation_from_record?: boolean | null;
    /** The discounts the totals apply. Absent from cases computed before 2026-10-15. */
    service_discount?: number | null;
    setup_discount?: number | null;
  } | null;
  aion_total_revenue: number;
  total_cost_to_brand: number;
  vat?: number | null;
  per_product?: {
    insurer_fee: number; aion_fee: number; total: number; setup: number; total_with_setup: number;
    total_pct_of_price: number; total_pct_of_price_incl_vat: number;
  } | null;
  rates_used?: RateUsed[] | null;
  notes?: string[] | null;
  volume_band_mismatch?: boolean | null;
  indicative?: boolean | null;
};

// ── Sources ─────────────────────────────────────────────────────────────────────────────

// In the order compute_business_case reaches for them (20261015000001).
const SOURCES: RateSource[] = ["own_quote", "record_category", "record_brand", "borrowed_quote"];

/**
 * A rate's source. A case computed before `rate_source` existed says only `own_quote`, and
 * then a rate is either this house's quote or a borrowed one.
 */
export function rateSource(r: { rate_source?: string | null; own_quote?: boolean | null }): RateSource {
  if (r.rate_source && (SOURCES as string[]).includes(r.rate_source)) return r.rate_source as RateSource;
  return r.own_quote ? "own_quote" : "borrowed_quote";
}

/** A rate quoted for another house. Never named on a slide. */
export const isBorrowed = (r: RateUsed) => rateSource(r) === "borrowed_quote";
/**
 * A rate that is not a price for this house: a borrowed quote, or the record's house-wide
 * default standing in for a category nobody priced. Either makes the case indicative — the
 * same rule `compute_business_case` applies.
 */
export const isIndicativeRate = (r: { rate_source?: string | null; own_quote?: boolean | null }) =>
  rateSource(r) === "borrowed_quote" || rateSource(r) === "record_brand";
export const isFromRecord = (r: { rate_source?: string | null; own_quote?: boolean | null }) =>
  rateSource(r).startsWith("record_");

// ── Formatting ──────────────────────────────────────────────────────────────────────────

/** Whole euros, as the bullet deck always set them: "€4,200,000". */
export const eur = (n: number) => `€${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
/** Per-piece money keeps its cents — €38.52 is not €39 when there are 50,000 pieces. */
export const eurPiece = (n: number) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000
    ? eur(v)
    : `€${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
/** A rate, to two places: "6.00%". */
export const pct = (n: number) => `${((Number(n) || 0) * 100).toFixed(2)}%`;
/** A share stated by a contract, without trailing zeros: "22%", "0.08%". */
export const pctShort = (n: number) => `${((Number(n) || 0) * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
const count = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");

const coverOf = (r: { coverage?: string | null; damage_scope?: string | null }) =>
  r.coverage === "theft"
    ? "Theft only"
    : `Theft + accidental damage${r.damage_scope ? ` (${r.damage_scope})` : ""}`;

/**
 * The same, short enough for a table cell — the perimeter table has six columns and up to six
 * segments, and "Theft + accidental damage (partial)" on two lines per row is what pushed it
 * off the slide. The full wording is on the premium and provenance slides.
 */
const coverShort = (r: { coverage?: string | null; damage_scope?: string | null }) =>
  r.coverage === "theft" ? "Theft only" : `Theft + damage${r.damage_scope ? ` (${r.damage_scope})` : ""}`;

/** "bags" → "Bags": categories are stored lower-case and set as headings. */
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * One value for the deck when every segment agrees, one per segment when they do not. A
 * segment with no value of its own is named with `missing` — the activation rate is null for
 * a segment the record gives none to, and the tier's rate applies to it — so a single figure
 * is never shown for a deck it is not true of.
 */
function perSegment(
  segs: SegmentCase[], pick: (s: SegmentCase) => number | null | undefined, missing: string,
): string | null {
  const has = (v: unknown) => v !== null && v !== undefined && Number.isFinite(Number(v));
  const vals = segs.map((s) => ({ s, v: pick(s) }));
  if (!vals.some((x) => has(x.v))) return null;
  const shown = vals.map((x) => (has(x.v) ? pctShort(Number(x.v)) : missing));
  const distinct = [...new Set(shown)];
  return distinct.length === 1 && has(vals[0].v)
    ? distinct[0]
    : vals.map((x, i) => `${x.s.segment} ${shown[i]}`).join(" · ");
}

// ── The deck ────────────────────────────────────────────────────────────────────────────

/** The line every pricing figure is qualified by, in the words the bullet deck used. */
export function ratesLine(c: BusinessCase): string {
  const rates = c.rates_used ?? [];
  if (c.indicative) {
    const why = [
      ...(rates.some(isBorrowed) ? ["quoted for another house"] : []),
      ...(rates.some((r) => rateSource(r) === "record_brand") ? ["the house-wide default on the brand record"] : []),
    ];
    return `Rates are INDICATIVE${why.length ? ` — ${why.join(", or ")}` : ""}, pending formal quotation.`;
  }
  if (rates.length && rates.every(isFromRecord)) return "Rates as agreed for this house, on its record.";
  if (rates.some(isFromRecord)) return "Rates as quoted for and agreed with this house.";
  return "Rates as quoted for this house.";
}

/** The provenance card for one rate. Never names the house a borrowed rate was quoted for. */
function sourceCard(house: string, r: RateUsed): SourceCard {
  const src = rateSource(r);
  const quoteBits = [r.insurer, r.quoted_at ? (src.startsWith("record_") ? `agreed ${r.quoted_at}` : `quoted ${r.quoted_at}`) : null]
    .filter(Boolean).join(", ");
  const band = r.gmv_from != null
    ? `Quoted at ${eur(r.gmv_from)}–${r.gmv_to != null ? eur(r.gmv_to) : "no cap"} volume`
    : null;
  const lines: string[] = [];
  switch (src) {
    case "record_category":
      lines.push("Agreed rate on the brand record", `Specific to ${r.category ? r.category.toLowerCase() : "this category"}`);
      break;
    case "record_brand":
      lines.push("Agreed rate on the brand record", "House-wide default — no rate agreed for this category yet");
      break;
    case "own_quote":
      lines.push(`Insurer quote for ${house}`);
      break;
    case "borrowed_quote":
      lines.push("Insurer quote for a comparable house in the same category");
      break;
  }
  if (quoteBits) lines.push(quoteBits);
  lines.push(coverOf(r));
  if (band) lines.push(band);
  return {
    title: cap(r.category ?? "Rate"),
    sub: r.segment && r.segment.toLowerCase() !== (r.category ?? "").toLowerCase() ? r.segment : undefined,
    figure: pct(r.rate_of_cogs),
    unit: "of COGS",
    lines,
    tag: isIndicativeRate(r) ? "Indicative" : undefined,
  };
}

/** The tag under a segment's rate on the premium slide: where that rate came from, in a word or two. */
function segmentTag(s: SegmentCase, rates: RateUsed[]): string | undefined {
  const own = s.rate_source ? s : rates.find((r) => r.segment === s.segment);
  if (!own) return undefined;
  switch (rateSource(own)) {
    case "record_category": return "Brand record · category";
    case "record_brand": return "Brand record · house-wide · indicative";
    case "own_quote": return "Insurer quote";
    case "borrowed_quote": return "Comparable quote · indicative";
  }
}

/**
 * The business case for one house as slides.
 *
 * `house` is the name the house goes by — it is on the cover and in the footer of every page,
 * and on the provenance card of a rate quoted for it. Only ever this house's own name.
 */
export function businessCaseSlides(house: string, c: BusinessCase): DeckSlide[] {
  const H = house.trim() || "the house";
  const segs = c.segments ?? [];
  const rates = c.rates_used ?? [];
  const fees = c.aion_fees ?? {};
  const pp = c.per_product ?? null;
  const months = Number(c.months) || 0;
  const badge = c.indicative ? "Indicative" : undefined;

  const activationPct = perSegment(segs, (s) => s.activation_fee_pct, "at the tier's rate");
  const actFromRecord = Boolean(fees.activation_from_record);
  const mismatch = c.volume_band_mismatch
    ? "Rates were quoted at a different volume than this perimeter declares."
    : null;
  const model = "Figures are a model, not an offer — the formal insurer quotation governs.";

  const slides: DeckSlide[] = [];

  // ── Cover ─────────────────────────────────────────────────────────────────
  slides.push({
    kind: "section", number: "", title: "Programme business case", sub: H,
    lead: `The coverage programme modelled over ${months} months: the perimeter covered, the insurance ` +
      `premium, AION's fees and what one piece costs.` +
      (c.indicative ? " Indicative — pending the formal insurer quotation." : ""),
  });

  // ── 1. Perimeter ──────────────────────────────────────────────────────────
  const live = (s: SegmentCase) =>
    s.months_live != null && months
      ? `Month ${Math.max(1, Math.round(months - Number(s.months_live) + 1))} · ${Math.round(Number(s.months_live))} mo`
      : "—";
  slides.push({
    kind: "metrics", title: "1. The perimeter — what is covered", key: "The perimeter", badge,
    tiles: [
      { value: eur(c.revenues_covered), label: "Covered revenues", note: `Over the ${months} months modelled` },
      {
        value: c.products_covered ? count(c.products_covered) : "—", label: "Pieces covered",
        note: c.products_covered ? "From each segment's average price" : "Add an average price per segment",
      },
      { value: c.average_price ? eur(c.average_price) : "—", label: "Average price per piece", note: "Retail, excl. VAT" },
      {
        value: String(months), label: "Months modelled",
        note: `${segs.length} segment${segs.length === 1 ? "" : "s"} in the perimeter`, strong: true,
      },
    ],
    table: {
      head: ["Segment", "Category", "Cover", "Covered revenue", "Pieces", "Live from"],
      shares: [0.22, 0.13, 0.23, 0.16, 0.1, 0.16],
      numeric: [false, false, false, true, true, false],
      rows: segs.map((s) => [
        s.segment, cap(s.category ?? "—"), coverShort(s), eur(s.revenues_covered),
        s.units != null ? count(s.units) : "—", live(s),
      ]),
      total: segs.length > 1
        ? ["Total", "", "", eur(c.revenues_covered), c.products_covered ? count(c.products_covered) : "—", `${months} months`]
        : undefined,
    },
  });

  // ── 2. Insurance cost ─────────────────────────────────────────────────────
  slides.push({
    kind: "bars", title: "2. Insurance cost — the premium by segment", key: "Insurance cost", badge,
    lead: `Each segment's premium is its rate applied to the cost of the goods covered (COGS). ${ratesLine(c)}`,
    captions: ["Segment", "Rate of COGS", "Gross premium"],
    rows: segs.map((s) => ({
      label: s.segment,
      sub: [cap(s.category ?? ""), coverOf(s)].filter(Boolean).join(" · "),
      figure: pct(s.rate_of_cogs),
      figureSub: s.value_covered != null ? `of ${eur(s.value_covered)} COGS` : "of COGS",
      tag: segmentTag(s, rates),
      value: Number(s.gross_premium) || 0,
      valueText: eur(s.gross_premium),
    })),
    equation: {
      terms: [
        { label: "Gross premium", value: eur(c.gross_premium) },
        { label: "GVT fee", value: eur(Number(c.gross_premium) - Number(c.net_premium)) },
        { label: "Net premium after GVT fee", value: eur(c.net_premium), strong: true },
      ],
      ops: ["minus", "equal"],
    },
  });

  // ── 3. AION fees ──────────────────────────────────────────────────────────
  const svc = fees.service_fee_month;
  const disc = fees.service_months_discounted ?? 0;
  const full = fees.service_months_full ?? 0;
  const serviceNote = fees.service_note ?? "on quotation";
  slides.push({
    kind: "metrics", title: "3. AION fees — setup, service and activation", key: "AION fees", badge,
    tiles: [
      {
        value: eur(fees.setup ?? 0), label: "Setup",
        note: fees.setup_discount ? `One-off, ${pctShort(fees.setup_discount)} launch discount` : "One-off",
      },
      svc
        ? { value: eur(fees.service ?? 0), label: "Service", note: `${eur(svc)}/month over the period` }
        : { value: "On quotation", label: "Service", note: cap(serviceNote) },
      {
        value: eur(fees.activation ?? 0), label: "Activation",
        note: activationPct && !activationPct.includes(" · ")
          ? `${activationPct} of covered revenues${actFromRecord ? ", from the record" : ""}`
          : actFromRecord ? "On covered revenues, rates from the record" : "On covered revenues",
      },
      { value: eur(fees.total ?? 0), label: "Total AION fees", note: `Over ${months} months`, strong: true },
    ],
    cards: [
      {
        title: `Tier ${fees.tier ?? "—"} on covered GMV`,
        body: `AION's fees follow the covered revenues: ${eur(c.revenues_covered)} over the period places ` +
          `this programme in tier ${fees.tier ?? "—"}.`,
      },
      svc
        ? {
            title: "Service months",
            // Says WHAT the discount is, not only that there is one: "6 months discounted" left
            // the reader to guess by how much and on whose say-so.
            body: `${eur(svc)}/month → ${eur(fees.service ?? 0)} over the period: ` +
              // The discount and its window are the case's since 20261016000001, so either can be
              // zero, or cover the whole period.
              (disc && fees.service_discount
                ? `${full ? `the first ${disc} month${disc === 1 ? "" : "s"}` : `all ${disc} month${disc === 1 ? "" : "s"}`} ` +
                  `at ${pctShort(fees.service_discount)} off (${eur(svc * (1 - fees.service_discount))}/month) — ` +
                  `AION's launch discount${full ? ` — then ${full} at full rate.` : "."}`
                : !disc
                  ? `all ${full} month${full === 1 ? "" : "s"} at full rate, no launch discount.`
                  : `${disc} month${disc === 1 ? "" : "s"} discounted, ${full} at full rate.`),
          }
        : {
            title: "Service fee",
            body: `Service fee: ${serviceNote}. It is not included in the totals in this deck.`,
          },
      {
        title: "Activation",
        body: activationPct
          ? `${activationPct.includes(" · ") ? `By segment: ${activationPct}` : `${activationPct} of the covered revenues`}` +
            ` — ${eur(fees.activation ?? 0)} on ${eur(c.revenues_covered)}.` +
            (actFromRecord
              ? activationPct.includes(" · ") ? " The rates stated by segment are agreed on the brand record." : " Agreed on the brand record."
              : "")
          : `A share of the covered revenues set by the tier — ${eur(fees.activation ?? 0)} on ${eur(c.revenues_covered)}.`,
      },
    ],
  });

  // ── 4. Cost per piece ─────────────────────────────────────────────────────
  // Per piece is the RECURRING cost. Setup is one-off and shown on its own, so this slide
  // reconciles with "total cost to the house" when someone multiplies it out in the meeting.
  if (pp && pp.total) {
    const vat = c.vat != null ? pctShort(c.vat) : null;
    slides.push({
      kind: "stack", title: "4. Cost per piece — recurring, and setup apart", key: "Cost per piece", badge,
      lead: "The recurring cost of one piece: the insurer's premium, plus AION's service and activation. " +
        "Setup is one-off and shown on its own, so these figures reconcile with the total cost.",
      bars: [{
        label: "Recurring cost of one piece",
        sub: c.average_price ? `On an average price of ${eur(c.average_price)}` : undefined,
        total: `${eurPiece(pp.total)} per piece`,
        parts: [
          { label: "Insurer", value: Number(pp.insurer_fee) || 0, text: eurPiece(pp.insurer_fee) },
          { label: "AION (service + activation)", value: Number(pp.aion_fee) || 0, text: eurPiece(pp.aion_fee) },
        ],
      }],
      tiles: [
        { value: pct(pp.total_pct_of_price), label: "Of the retail price", note: "Excl. VAT" },
        {
          value: pct(pp.total_pct_of_price_incl_vat), label: "Of the price incl. VAT",
          note: vat ? `VAT at ${vat}` : "Including VAT",
        },
        { value: eurPiece(pp.setup), label: "Setup per piece", note: "One-off, spread over the perimeter" },
        { value: eurPiece(pp.total_with_setup), label: "All-in per piece", note: "Recurring cost plus setup", strong: true },
      ],
    });
  } else {
    slides.push({
      kind: "callout", title: "Cost per piece", icon: "warning",
      label: "No per-piece figures",
      body: "Average price not supplied — add an average price per segment for per-piece figures.",
    });
  }

  // ── 5. Total cost ─────────────────────────────────────────────────────────
  // What the house pays, and nothing about what AION earns. This deck goes to the house; AION's
  // share of the net premium is AION's business ("hide AION's share of the net premium"), and
  // it stays on the admin panel.
  slides.push({
    kind: "stack", title: `5. Total cost — ${months} months`, key: "Total cost", badge,
    bars: [
      {
        label: `Total cost to ${H}`,
        sub: `Insurance ${eur(c.gross_premium)} and AION ${eur(fees.total ?? 0)}`,
        total: eur(c.total_cost_to_brand),
        parts: [
          { label: "Insurance premium", value: Number(c.gross_premium) || 0, text: eur(c.gross_premium) },
          { label: "AION setup", value: Number(fees.setup) || 0, text: eur(fees.setup ?? 0) },
          { label: "AION service", value: Number(fees.service) || 0, text: eur(fees.service ?? 0) },
          { label: "AION activation", value: Number(fees.activation) || 0, text: eur(fees.activation ?? 0) },
        ],
      },
    ],
    notes: [
      ...(svc ? [] : [`Service fee: ${serviceNote} — not included above.`]),
      ...(mismatch ? [mismatch] : []),
      model,
    ],
  });

  // ── 6. Provenance ─────────────────────────────────────────────────────────
  // What it must NOT do is name the house a borrowed rate was quoted for. This deck goes to a
  // prospect, and "quoted for <client> (2026-07-30): 6.00% of COGS" hands them a live client's
  // name and that client's insurance rate in one line. The admin is told whose rate it is, in
  // the review notes; the prospect is told it is not theirs yet.
  const borrowed = rates.filter(isBorrowed).length;
  const houseWide = rates.filter((r) => rateSource(r) === "record_brand").length;
  const reasons = [
    ...(borrowed
      ? [`${borrowed === 1 ? "One rate" : `${borrowed} rates`} below ${borrowed === 1 ? "was" : "were"} quoted for a ` +
         `comparable house in the same category, not for ${H}.`]
      : []),
    ...(houseWide
      ? [`${houseWide === 1 ? "One rate" : `${houseWide} rates`} below ${houseWide === 1 ? "is" : "are"} the house-wide ` +
         `default on ${H}'s record, standing in for a category with no agreed rate.`]
      : []),
  ];
  const warning = c.indicative
    ? {
        label: "Indicative",
        body: reasons.length
          ? `${reasons.join(" ")} Every premium and total in this deck is indicative until the house's own ` +
            `insurer quotation is issued — that quotation governs.`
          : `The figures in this deck are indicative, pending the formal insurer quotation for ${H} — ` +
            `that quotation governs.`,
      }
    : undefined;
  // The volume-band note already says what the mismatch line says, segment by segment; the
  // generic line stands in only when the model gave no note.
  const notes = [
    ...(c.notes ?? []).filter(Boolean),
    ...(mismatch && !(c.notes ?? []).length ? [mismatch] : []),
    model,
  ];
  // Up to three rates sit as cards over the notes. More — a six-segment perimeter has six
  // rates and, often, a volume-band note for half of them — do not fit on one page at a size
  // anyone can read, so the notes go to a page of their own rather than shrink to nothing.
  const split = rates.length > 3;
  slides.push({
    kind: "sources", title: "6. Where the rates come from", key: "Where the rates come from", badge,
    warning,
    cards: rates.map((r) => sourceCard(H, r)),
    notes: split ? [] : notes,
  });
  if (split) {
    slides.push({
      kind: "sources", title: "6. Where the rates come from — notes on the model", key: "Where the rates come from",
      badge, cards: [], notes,
    });
  }

  return slides;
}

/** The rates that are not this house's own, for the admin's review notes — named there, never on a slide. */
export function borrowedForReview(c: BusinessCase): string {
  return (c.rates_used ?? []).filter(isBorrowed)
    .map((r) => `${r.category} ${pct(r.rate_of_cogs)} from ${r.quoted_for ?? "an unnamed quote"}`)
    .join("; ");
}

