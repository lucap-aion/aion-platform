// ==============================|| WHAT A BRAND RECORD SHOULD ARRIVE WITH ||============================== //
// Onboarding filled the visual identity — logo, colours, imagery — and left the rest of the
// record empty: no product focus, no FAQ, no fee rates, no Chubb policy prefix. Every one of
// those is either derivable from what we already know or a house-standard default, and every
// one of them was being typed in by hand for each new brand.
//
// Nothing here invents a commercial fact. The fee rates are the programme's own standard
// terms, the FAQ is the approved text with this brand's name in it, and both are drafts on a
// record a person still reviews. Where a value genuinely cannot be known — a launch date, the
// boutiques in scope — the wording stays general rather than guessing.
//
// Pure functions, so the frontend suite tests them.

import { FAQ_TEMPLATE_EN, FAQ_TEMPLATE_IT, type FaqTemplateEntry } from "./faq-template.ts";

// ── Chubb policy prefix ─────────────────────────────────────────────────────────────────── //

/** ISO-ish two-letter code for the country names these records actually carry. */
const COUNTRY_CODES: Record<string, string> = {
  italy: "IT", italia: "IT", france: "FR", francia: "FR", spain: "ES", spagna: "ES",
  germany: "DE", germania: "DE", switzerland: "CH", svizzera: "CH", austria: "AT",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB",
  "united states": "US", usa: "US", "united states of america": "US",
  netherlands: "NL", belgium: "BE", portugal: "PT", ireland: "IE", greece: "GR",
  denmark: "DK", sweden: "SE", norway: "NO", finland: "FI", poland: "PL",
  japan: "JP", giappone: "JP", china: "CN", "hong kong": "HK", singapore: "SG",
  "united arab emirates": "AE", uae: "AE", canada: "CA", australia: "AU", brazil: "BR",
};

/**
 * The prefix every policy number for this brand starts with.
 *
 * Three letters from the name and two for the country, which is the shape the two live
 * programmes already use — ROCIT for the house in production, POMIT for the one behind it.
 * Two letters from the first word and one from each word after it, so a two-word name keeps
 * evidence of both halves; a single word gives its first three.
 *
 *   Roberto Coin    → ROC + IT
 *   Pomellato       → POM + IT
 *   Pasquale Bruni  → PAB + IT
 *
 * Uniqueness is the caller's job: pass the prefixes already in use and a digit is appended
 * rather than two brands sharing one, which would make a policy number ambiguous in a Chubb
 * bordereau — the one place it has to be unambiguous.
 */
export function policyPrefix(name: string, country?: string | null, taken: readonly string[] = []): string {
  const words = (name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")      // drop accents: Hermès → Hermes
    .replace(/&/g, " ").split(/[^A-Za-z]+/).filter(Boolean);

  let letters = "";
  if (words.length === 1) letters = words[0].slice(0, 3);
  else {
    letters = words[0].slice(0, 2);
    for (const w of words.slice(1)) {
      if (letters.length >= 3) break;
      letters += w[0];
    }
  }
  // A one- or two-letter name still has to produce three characters.
  letters = (letters + "XXX").slice(0, 3).toUpperCase();

  const key = (country ?? "").trim().toLowerCase();
  const code = COUNTRY_CODES[key] ?? (/^[a-z]{2}$/.test(key) ? key.toUpperCase() : key.slice(0, 2).toUpperCase());
  const base = `${letters}${code || "XX"}`;

  const used = new Set(taken.filter(Boolean).map((p) => p.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

// ── Fee rates ───────────────────────────────────────────────────────────────────────────── //

/**
 * The programme's standard terms, as they stand on the house in production.
 *
 * A new brand arrived with all four blank, so nothing could be priced, no activation fee was
 * charged and the covered-value band was unbounded until somebody remembered. These are a
 * starting point on a prospect's record — the formal quotation replaces the insurance rate,
 * and the record is editable — not a commitment.
 */
export const STANDARD_FEE_RATES = {
  activation_fee: 0.0015,
  insurance_premium: 0.06,
  aion_premium_fee: 0.3,
  min_covered_value: 999,
  max_covered_value: 100000,
} as const;

// ── Product focus ───────────────────────────────────────────────────────────────────────── //

// What a house sells, in the words the pricing model and the data request already use.
// Ordered: the first match wins the singular/plural forms used in the FAQ.
const CATEGORY_WORDS: { focus: string; en: string; enSingular: string; it: string; itSingular: string; match: RegExp }[] = [
  { focus: "High jewellery", en: "jewellery", enSingular: "piece of jewellery", it: "gioielli", itSingular: "gioiello",
    match: /jewel|jewellery|jewelry|gioiell|anello|ring|necklace|bracelet|earring|collana|bracciale|orecchin|pendant|charm|high jewel/i },
  { focus: "Watches", en: "watches", enSingular: "watch", it: "orologi", itSingular: "orologio",
    match: /watch|orolog|timepiece|chronograph/i },
  { focus: "Bags and leather goods", en: "bags and leather goods", enSingular: "bag", it: "borse e pelletteria", itSingular: "borsa",
    match: /\bbag|handbag|borsa|borse|leather good|pellett|tote|clutch|backpack|wallet|portafogl/i },
  { focus: "Ready-to-wear", en: "garments", enSingular: "garment", it: "capi", itSingular: "capo",
    match: /ready.?to.?wear|\brtw\b|apparel|abbigliament|dress|abito|coat|cappotto|knitwear|maglieria/i },
  { focus: "Shoes", en: "shoes", enSingular: "pair of shoes", it: "calzature", itSingular: "paio di scarpe",
    match: /\bshoe|sneaker|loafer|pump|sandal|scarp|calzatur|boot|stivale/i },
  { focus: "Eyewear", en: "eyewear", enSingular: "pair of glasses", it: "occhiali", itSingular: "paio di occhiali",
    match: /eyewear|sunglass|occhial|\bframes?\b/i },
];

/** The neutral wording, for a house whose catalogue says nothing recognisable. */
const GENERIC_CATEGORY = { en: "pieces", enSingular: "piece", it: "articoli", itSingular: "articolo" };

export type FocusEvidence = {
  /** storefront_products.category and .collection, and product names. */
  categories?: (string | null)[];
  names?: (string | null)[];
  /** The brand's own description, as a last resort. */
  description?: string | null;
};

/**
 * Which categories this house actually sells, for the "product focus" on the record and the
 * category wording in the FAQ.
 *
 * Read from the catalogue first, because it is evidence rather than marketing: a hundred
 * product names carry the word "ring" far more reliably than a description written for
 * search results. Two matches at most — a data request naming six categories is not a focus.
 */
export function productFocus(evidence: FocusEvidence): string | null {
  const found = matchedCategories(evidence);
  return found.length ? found.slice(0, 2).map((c) => c.focus).join(", ") : null;
}

/** The words for this house's pieces, in both languages, for the FAQ. */
export function categoryWords(evidence: FocusEvidence): typeof GENERIC_CATEGORY {
  const [first] = matchedCategories(evidence);
  return first
    ? { en: first.en, enSingular: first.enSingular, it: first.it, itSingular: first.itSingular }
    : GENERIC_CATEGORY;
}

function matchedCategories(evidence: FocusEvidence): typeof CATEGORY_WORDS {
  const haystacks = [
    ...(evidence.categories ?? []).filter(Boolean) as string[],
    ...(evidence.names ?? []).filter(Boolean) as string[],
  ];
  const catalogue = haystacks.join(" \n");

  // Score by how many rows mention it, so a house with three bags and four hundred rings
  // reads as a jeweller.
  const scored = CATEGORY_WORDS
    .map((c) => ({ c, hits: (catalogue.match(new RegExp(c.match.source, "gi")) ?? []).length }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (scored.length) return scored.map((s) => s.c);

  // No catalogue yet: fall back to the description, which is at least the house's own words.
  const described = CATEGORY_WORDS.filter((c) => c.match.test(evidence.description ?? ""));
  return described;
}

// ── The customer FAQ ────────────────────────────────────────────────────────────────────── //

export type FaqParams = {
  brand: string;
  /** What the programme is called to customers. Defaults to "<Brand> Prestige Service". */
  programme?: string;
  minCoveredValue?: number | null;
  maxCoveredValue?: number | null;
  /** The address a customer should write to, when the brand publishes one. */
  supportEmail?: string | null;
  evidence?: FocusEvidence;
};

export type FaqEntry = {
  title: string;
  content: { type: "blocks"; blocks: ({ type: "p"; text: string } | { type: "ul"; items: string[] })[] };
  sort_order: number;
};

/**
 * A price band the way the approved text writes it: "1,000" and "100,000" in English,
 * "1.000" and "100.000" in Italian.
 *
 * Not Intl.NumberFormat: Italian's CLDR rule is not to group four-digit numbers, so it
 * renders 1000 as "1000" while the FAQ that has been in front of customers for a year says
 * "euro 1.000". Grouping every three digits is what a person reading the tab expects.
 */
function money(locale: "en" | "it", n: number): string {
  const separator = locale === "it" ? "." : ",";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * The approved FAQ with this brand's details in it, English and Italian.
 *
 * The two things nobody can know at onboarding are left general on purpose: a launch date
 * ("from the launch of the programme") and which boutiques take part ("the official
 * boutiques taking part in the programme"). A guessed date in a customer-facing FAQ is a
 * commitment the brand never made.
 */
export function renderFaqs(params: FaqParams): { en: FaqEntry[]; it: FaqEntry[] } {
  const words = categoryWords(params.evidence ?? {});
  const min = params.minCoveredValue ?? STANDARD_FEE_RATES.min_covered_value;
  const max = params.maxCoveredValue ?? STANDARD_FEE_RATES.max_covered_value;
  const programme = params.programme?.trim() || `${params.brand} Prestige Service`;

  const values = (locale: "en" | "it"): Record<string, string> => ({
    "{{BRAND}}": params.brand,
    "{{PROGRAMME}}": programme,
    "{{PROGRAMME_SHORT}}": "Prestige Service",
    // The FAQ quotes the band a customer sees, which starts one euro above the floor the
    // platform refuses to activate at.
    "{{MIN}}": money(locale, min + 1),
    "{{MAX}}": money(locale, max),
    "{{CATEGORY}}": locale === "it" ? words.it : words.en,
    "{{CATEGORY_SG}}": locale === "it" ? words.itSingular : words.enSingular,
    "{{DURATION}}": locale === "it" ? "due anni" : "two years",
    "{{DURATION_ADJ}}": locale === "it" ? "di due anni" : "two-year",
    "{{LAUNCH}}": locale === "it" ? "dall’avvio del programma" : "from the launch of the programme",
    "{{BOUTIQUES}}": locale === "it"
      ? "nelle boutique ufficiali che partecipano al programma"
      : "in the official boutiques taking part in the programme",
    "{{SUPPORT}}": params.supportEmail?.trim()
      || (locale === "it" ? "il servizio clienti del brand" : "the brand’s customer service"),
  });

  const render = (template: readonly FaqTemplateEntry[], locale: "en" | "it"): FaqEntry[] => {
    const map = values(locale);
    const fill = (s: string) => Object.entries(map).reduce((acc, [token, value]) => acc.split(token).join(value), s);
    return template.map((entry) => ({
      title: fill(entry.title),
      content: {
        type: "blocks" as const,
        blocks: entry.blocks.map((b) =>
          b.type === "ul"
            ? { type: "ul" as const, items: b.items.map(fill) }
            : { type: "p" as const, text: fill(b.text) }),
      },
      sort_order: entry.sort_order,
    }));
  };

  return { en: render(FAQ_TEMPLATE_EN, "en"), it: render(FAQ_TEMPLATE_IT, "it") };
}
