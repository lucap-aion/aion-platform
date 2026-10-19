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
//
// Ordered, and the order is load-bearing twice over: the first match wins the singular/plural
// forms used in the FAQ, and a product that matches two categories is counted under the first
// of them, so a diamond watch is a watch only if nothing above it claimed it first.
//
// The patterns have to read SHELF LABELS, not just English product names. These catalogues
// are scraped in the house's own market: prada.com files 82 pieces under "Accessori" and 62
// under "Abbigliamento", and an Accessories pattern that knew every word for a scarf but not
// the word "accessori" scored those 82 pieces at zero.
const CATEGORY_WORDS: { focus: string; en: string; enSingular: string; it: string; itSingular: string; match: RegExp }[] = [
  { focus: "High jewellery", en: "jewellery", enSingular: "piece of jewellery", it: "gioielli", itSingular: "gioiello",
    match: /jewel|jewellery|jewelry|gioiell|anello|ring|necklace|bracelet|earring|collana|bracciale|orecchin|pendant|charm|high jewel|joaillerie|bijou/i },
  { focus: "Watches", en: "watches", enSingular: "watch", it: "orologi", itSingular: "orologio",
    match: /watch|orolog|timepiece|chronograph|horlogerie|\bmontres?\b/i },
  { focus: "Bags and leather goods", en: "bags and leather goods", enSingular: "bag", it: "borse e pelletteria", itSingular: "borsa",
    match: /\bbag|handbag|borsa|borse|borsett|leather good|pellett|maroquinerie|tote|clutch|backpack|wallet|portafogl/i },
  { focus: "Ready-to-wear", en: "garments", enSingular: "garment", it: "capi", itSingular: "capo",
    match: /ready.?to.?wear|\brtw\b|apparel|abbigliament|pr[eê]t.?[àa].?porter|dress|abito|coat|cappotto|knitwear|maglieria/i },
  { focus: "Shoes", en: "shoes", enSingular: "pair of shoes", it: "calzature", itSingular: "paio di scarpe",
    match: /\bshoe|sneaker|loafer|pump|sandal|scarp|calzatur|chaussure|boot|stivale/i },
  { focus: "Eyewear", en: "eyewear", enSingular: "pair of glasses", it: "occhiali", itSingular: "paio di occhiali",
    match: /eyewear|sunglass|occhial|\bframes?\b/i },
  // Beyond the five obvious ones. A silversmith is not a hypothetical: one of the houses
  // onboarded here sells table silver next to its jewellery, and with no match at all the
  // focus stayed blank and the FAQ said "pieces".
  { focus: "Silver and tableware", en: "silver pieces", enSingular: "piece", it: "argenti", itSingular: "pezzo",
    match: /\bsilver\b|silverware|argenteria|argenti\b|tableware|\btavola\b|porcellana|centrepiece|centerpiece|candelab|posate|vassoi|tray\b/i },
  { focus: "Accessories", en: "accessories", enSingular: "accessory", it: "accessori", itSingular: "accessorio",
    match: /accessor(?:y|ies|i|io)\b|accessoire|\bscarf|scarves|foulard|\btie\b|cravatt|\bbelt|cintur|\bglove|guanti|\bhat\b|cappell|cufflink|gemell/i },
  { focus: "Fragrance and beauty", en: "fragrances", enSingular: "fragrance", it: "profumi", itSingular: "profumo",
    match: /fragrance|perfume|profum|eau de (?:parfum|toilette)|cologne|\bbeauty\b|skincare|cosmetic/i },
  { focus: "Writing instruments", en: "writing instruments", enSingular: "pen", it: "strumenti di scrittura", itSingular: "penna",
    match: /fountain pen|ballpoint|rollerball|writing instrument|stilografic|\bpenne?\b/i },
];

/** The neutral wording, for a house whose catalogue says nothing recognisable. */
const GENERIC_CATEGORY = { en: "pieces", enSingular: "piece", it: "articoli", itSingular: "articolo" };

/** One row of the catalogue, as the focus reads it. */
export type FocusProduct = {
  name?: string | null;
  /** storefront_products.category — the house's own shelf label. */
  category?: string | null;
  collection?: string | null;
  /** Retail price, for the value column of the breakdown. Never for the ranking — see below. */
  price?: number | null;
};

export type FocusEvidence = {
  /** The catalogue, a row per piece. The evidence that counts. */
  products?: FocusProduct[];
  /** Flat forms, for callers with no per-product rows: each entry counts as one piece. */
  categories?: (string | null)[];
  names?: (string | null)[];
  /** The brand's own description, as a last resort. */
  description?: string | null;
};

/** What share of the catalogue each category is, biggest first. */
export type FocusShare = {
  focus: string;
  /** Pieces counted under this category. */
  products: number;
  /** Its share of the whole catalogue, 0–1. */
  share: number;
  /** Their retail value, where the catalogue carries prices. Reported, never ranked on. */
  value: number;
  /** How many of them were placed by their shelf label rather than by their name. */
  fromShelf: number;
};

// A share this small is a long tail, not a focus — but only once there are enough pieces for
// a share to mean anything. Below that, everything the catalogue says is worth saying.
const MIN_SHARE = 0.08;
const ENOUGH_TO_HAVE_A_TAIL = 25;

/**
 * Which categories this house actually sells, for the "product focus" on the record, the
 * category wording in the FAQ, and the pieces the intro deck puts on a slide.
 *
 * Read from the catalogue, because that is evidence rather than marketing. Two categories at
 * most — a data request naming six categories is not a focus.
 *
 * Counted PER PIECE, which is the whole of the fix here. It used to count regex hits across
 * the catalogue mashed into one string, and that is not the same question: Prada files 21
 * pieces under the collection "Profumi e beauty", a label that matches the fragrance pattern
 * twice, so 21 lipsticks and candles outscored every handbag in the catalogue and the house
 * came out as "Eyewear, Fragrance and beauty". A piece now votes once, for the first category
 * that claims it, and the ranking is the number of pieces — which is a sentence somebody can
 * check ("82 of 260 are accessories") rather than a number nobody can.
 *
 * Ranked on pieces, NOT on value, deliberately. Value is the more flattering number and the
 * less honest one: a catalogue read is a sample of a website, prices are missing on a third
 * of the rows on some houses, and one €400,000 necklace would decide the focus on its own.
 * The value is carried in the breakdown so a person can see it and overrule this.
 */
export function productFocus(evidence: FocusEvidence): string | null {
  const found = focusBreakdown(evidence);
  return found.length ? found.slice(0, 2).map((c) => c.focus).join(", ") : null;
}

/**
 * The same reading, with its workings — which categories, how many pieces each, what share
 * of the catalogue and what they are worth.
 *
 * This is what the screen shows next to the field. A focus nobody can check is a focus nobody
 * corrects, and this one goes out on a data request telling a client which categories the
 * pilot covers.
 */
export function focusBreakdown(evidence: FocusEvidence): FocusShare[] {
  const rows = catalogueRows(evidence);

  if (rows.length) {
    const tally = new Map<string, FocusShare>();
    for (const row of rows) {
      const placed = placeProduct(row);
      if (!placed) continue;
      const t = tally.get(placed.category.focus)
        ?? { focus: placed.category.focus, products: 0, share: 0, value: 0, fromShelf: 0 };
      t.products += 1;
      t.value += Number(row.price) > 0 ? Number(row.price) : 0;
      if (placed.byShelf) t.fromShelf += 1;
      tally.set(placed.category.focus, t);
    }
    if (tally.size) {
      const floor = rows.length >= ENOUGH_TO_HAVE_A_TAIL ? MIN_SHARE : 0;
      return [...tally.values()]
        .map((t) => ({ ...t, share: t.products / rows.length }))
        .filter((t) => t.share >= floor)
        .sort((a, b) => b.products - a.products || b.value - a.value);
    }
  }

  // No catalogue yet, or nothing in it recognisable: fall back to the description, which is
  // at least the house's own words about itself. No shares — there is nothing to be a share
  // of — and the order is the vocabulary's own.
  return CATEGORY_WORDS
    .filter((c) => c.match.test(evidence.description ?? ""))
    .map((c) => ({ focus: c.focus, products: 0, share: 0, value: 0, fromShelf: 0 }));
}

/**
 * The pattern that recognises one named category, for a caller that wants only that part of
 * a catalogue — "for Prada they have to be images of bags".
 *
 * Takes what a person would actually type or what the record already holds: the full focus
 * label ("Bags and leather goods"), a word from it ("bags"), or the house's own shelf word
 * ("borse"). Returns null for something it does not recognise rather than a pattern that
 * matches everything, because a filter nobody understands is worse than no filter.
 */
export function focusMatcher(wanted: string): RegExp | null {
  const q = (wanted ?? "").trim().toLowerCase();
  if (!q) return null;
  const exact = CATEGORY_WORDS.find((c) => c.focus.toLowerCase() === q);
  if (exact) return new RegExp(exact.match.source, "i");
  // A word from the label: "bags" → "Bags and leather goods", "jewellery" → "High jewellery".
  const named = CATEGORY_WORDS.find((c) => {
    const label = c.focus.toLowerCase();
    return label.split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => q.includes(w) || w.includes(q));
  });
  if (named) return new RegExp(named.match.source, "i");
  // Last: the vocabulary itself, so a shelf word typed straight in still resolves.
  const byWord = CATEGORY_WORDS.find((c) => c.match.test(q));
  return byWord ? new RegExp(byWord.match.source, "i") : null;
}

/** The words for this house's pieces, in both languages, for the FAQ. */
export function categoryWords(evidence: FocusEvidence): typeof GENERIC_CATEGORY {
  const [top] = focusBreakdown(evidence);
  const first = top && CATEGORY_WORDS.find((c) => c.focus === top.focus);
  return first
    ? { en: first.en, enSingular: first.enSingular, it: first.it, itSingular: first.itSingular }
    : GENERIC_CATEGORY;
}

/**
 * The catalogue as a list of pieces, however the caller happened to supply it.
 *
 * `products` is the real shape. The flat `categories` / `names` arrays are what callers with
 * no per-product rows pass, and each entry stands in for one piece — which is the honest
 * reading of a bare list and keeps the unit tests speaking in product names.
 */
function catalogueRows(evidence: FocusEvidence): FocusProduct[] {
  if (evidence.products?.length) return evidence.products;
  return [
    ...(evidence.categories ?? []).filter(Boolean).map((c) => ({ category: c })),
    ...(evidence.names ?? []).filter(Boolean).map((n) => ({ name: n })),
  ] as FocusProduct[];
}

/**
 * The one category a piece counts under.
 *
 * The house's own shelf label first, and only then the product name. A label is a
 * classification somebody made on purpose; a name is prose, and prose about a handbag says
 * "in pelle" while prose about a loafer says it too. Where the label places a piece, the name
 * does not get a vote.
 */
function placeProduct(row: FocusProduct): { category: typeof CATEGORY_WORDS[number]; byShelf: boolean } | null {
  const shelf = [row.category, row.collection].filter(Boolean).join(" ");
  const onShelf = shelf ? CATEGORY_WORDS.find((c) => c.match.test(shelf)) : undefined;
  if (onShelf) return { category: onShelf, byShelf: true };
  const byName = row.name ? CATEGORY_WORDS.find((c) => c.match.test(row.name!)) : undefined;
  return byName ? { category: byName, byShelf: false } : null;
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

// ── The address a customer should write to ──────────────────────────────────────────────── //

// Role addresses, best first. An exact prefix match ONLY, which is the whole point: a
// jeweller's site publishes info@, its boutiques publish aspen@ and beverlyhills@, and its
// sales people publish firstname.lastname@. Putting a named individual's address in a brand
// record — and from there into a customer-facing FAQ — is the failure this avoids, and no
// amount of pattern-matching on names is as reliable as refusing everything unlisted.
const ROLE_PREFIXES = [
  // Client care, in the languages these houses actually write in. The list was English and
  // Italian only, which quietly blanked the field for a French, German or Spanish brand and
  // sent its FAQ to "the brand's customer service" instead of to an address.
  "clientservice", "client.service", "client-service", "clientservices", "clientcare", "client.care",
  "customercare", "customer.care", "customerservice", "customer.service", "customerservices",
  "servizioclienti", "servizio.clienti", "clienti",
  "serviceclient", "service.client", "serviceclients", "relationclient", "relation.client",
  "kundenservice", "kundendienst", "kundenbetreuung",
  "servicioclientes", "servicio.clientes", "atencionalcliente", "atencioncliente",
  "clientadvisor", "concierge", "conciergerie", "conciergeservice", "clientele", "clientelling",
  "boutiqueservice", "sav", "assistenzaclienti", "assistenza.clienti", "servizioclientela",
  "info", "informazioni", "contact", "contacts", "contacto", "contatti", "kontakt",
  "enquiries", "inquiries", "service", "care", "support", "help", "hello", "assistenza",
  "cs", "care.team",
  // Last, and only because an address is better than none: these reach a shop rather than a
  // client-care desk, but they reach the house.
  "eshop", "e-shop", "ecommerce", "e-commerce", "onlineshop", "onlineboutique", "webshop",
  "shop", "boutiqueonline",
];

/**
 * A role address, possibly with the region bolted on the end.
 *
 * A house that runs one client-care desk per market says so in the mailbox:
 * `client.service.eu@prada.com`, published in plain sight on its own Contact us page, beside
 * the phone number and the opening hours. Matching ROLE_PREFIXES exactly threw it away —
 * "client.service" was in the list and "client.service.eu" was not — and the brand record
 * kept an empty email while two hundred and thirty-six indexed chunks held the address.
 *
 * Adding every region to the list is the wrong shape: it multiplies a sixty-entry list by
 * every market a house might split by. Strip the region and ask the same question instead.
 *
 * Only ONE trailing region is stripped, and only when what remains is a role prefix in its
 * own right — so `client.service.eu` resolves and `marco.rossi.it`, which is a person, does
 * not, because "marco.rossi" is not a role.
 */
const REGION_SUFFIX = /^(?:eu|us|usa|uk|gb|it|fr|de|es|pt|nl|be|ch|at|se|dk|no|fi|pl|gr|tr|ru|jp|cn|hk|tw|kr|sg|au|nz|ca|mx|br|ae|sa|in|apac|emea|amer|latam|na|intl|international|global|world|ww|row|online)$/;

export function isRolePrefix(prefix: string): boolean {
  if (ROLE_PREFIXES.includes(prefix)) return true;
  const cut = prefix.lastIndexOf(".") > prefix.lastIndexOf("-") ? prefix.lastIndexOf(".") : prefix.lastIndexOf("-");
  if (cut <= 0) return false;
  return REGION_SUFFIX.test(prefix.slice(cut + 1)) && ROLE_PREFIXES.includes(prefix.slice(0, cut));
}

/**
 * Addresses that are on the house's own domain and still wrong to publish to a client.
 *
 * A blocklist as well as the allowlist above, because the allowlist is edited by people and
 * "legal" or "press" reads plausible enough to be added to it one day. A client with a
 * damaged ring must not be sent to a data-protection officer, a press office or a mailbox
 * that discards what it receives.
 */
const NEVER_PUBLISHED = new Set([
  "privacy", "privacidad", "privacybeleid", "dpo", "gdpr", "rgpd", "datenschutz",
  "legal", "legale", "compliance", "complaints", "abuse", "security", "postmaster",
  "webmaster", "hostmaster", "admin", "administrator", "root",
  "noreply", "no-reply", "no.reply", "donotreply", "do-not-reply", "bounce", "mailer-daemon",
  "unsubscribe", "newsletter", "marketing", "press", "pressoffice", "ufficiostampa", "media",
  "jobs", "careers", "recruitment", "recruiting", "hr", "cv",
  "invoice", "invoices", "billing", "accounts", "accounting", "fatturazione",
  "amministrazione", "supplier", "suppliers", "vendor", "procurement", "test", "example",
]);

/**
 * The brand's own customer-service address, from text crawled off its site.
 *
 * The identity harvester only reads the homepage, and these houses put no address there —
 * they have a contact form. The address is on the client-service page, which the crawl has
 * indexed along with the rest of the site.
 *
 * Only on the brand's own domain, and only a role prefix.
 */
export function customerServiceEmail(text: string, website: string): string | null {
  // The HOUSE, not the exact hostname. A brand's site is luisabeccaria.com and its mailbox is
  // info@luisabeccaria.it; another's client-care address is on sf.ferragamo.com. Matching the
  // full domain rejected both, and matching anything at all would take an agency's address
  // out of a footer. So: the label to the left of the public suffix has to be the same.
  const label = (hostname: string): string | null => {
    const parts = hostname.replace(/^www\./, "").toLowerCase().split(".").filter(Boolean);
    if (parts.length < 2) return null;
    // "co.uk", "com.au" and friends: the registrable label is one further left.
    const suffixish = /^(co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]);
    return parts[parts.length - (suffixish ? 3 : 2)] ?? null;
  };

  // The same house under a group domain. messika.com publishes its client address as
  // conciergerie@MESSIKAGROUP.com, and an exact-label rule threw away the one address on the
  // site that a client is actually meant to write to. Accepted only when the difference is
  // a corporate or geographic word — so "messikagroup" is Messika and "coinbase" is not
  // Roberto Coin.
  const AFFIX = /^(?:group|gruppo|groupe|holding|holdings|spa|srl|sa|sas|intl|international|worldwide|global|italia|italy|france|paris|milano|maison|official|store|shop|boutique|corp|co)$/;
  const sameHouse = (mailLabel: string | null, brand: string): boolean => {
    if (!mailLabel) return false;
    if (mailLabel === brand) return true;
    const [longer, shorter] = mailLabel.length >= brand.length ? [mailLabel, brand] : [brand, mailLabel];
    if (shorter.length < 5 || !longer.startsWith(shorter)) return false;
    return AFFIX.test(longer.slice(shorter.length));
  };

  let brandLabel: string | null;
  try {
    brandLabel = label(new URL(website.startsWith("http") ? website : `https://${website}`).hostname);
  } catch {
    return null;
  }
  if (!brandLabel || brandLabel.length < 3) return null;

  const found = new Set<string>();
  // The lookbehind is not decoration: without it this scan is QUADRATIC, and on a
  // real homepage that means it never returns.
  //
  // `[A-Za-z0-9._%+-]+@` has no nested quantifier, so it reads as safe. It is not.
  // Inside a long run of those characters with no `@` in it — a minified bundle, a
  // base64 data: URI, the kind of thing a luxury homepage inlines by the hundred
  // kilobyte — the engine consumes the whole run from position i, fails to find
  // `@`, advances to i+1 and consumes it all again. Measured on prada.com's
  // homepage: 120KB takes 2ms, 200KB does not finish. The full 1.1MB page hung the
  // branding stage until the platform killed the worker, which is invisible from
  // the outside because the stage row is claimed 'running' before the work starts.
  //
  // The lookbehind refuses to start a match in the middle of such a run, so each
  // character is visited once: the same 1.1MB page scans in 5ms and finds the same
  // addresses.
  for (const m of text.matchAll(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g)) {
    const address = m[0].toLowerCase().replace(/[.,;:)\]]+$/, "");
    const [prefix, host] = address.split("@");
    if (!host || !sameHouse(label(host), brandLabel)) continue;
    // PEC is Italy's certified mail: legally binding, monitored by the company's lawyers and
    // administrators, and the wrong place to send a client with a damaged ring. It sits on
    // the house's own domain — pasqualebrunispa@pec.pasqualebruni.com — so the domain test
    // lets it through and only this stops it.
    if (/(^|\.)pec\./i.test(host)) continue;
    if (NEVER_PUBLISHED.has(prefix)) continue;
    if (!isRolePrefix(prefix)) continue;
    found.add(address);
  }
  if (!found.size) return null;

  // A prefix that is the TAIL of another on the same domain is a text-extraction artefact,
  // not an address: crawling messika.com turned up "rie@messikagroup.com" beside
  // "conciergerie@messikagroup.com", because a line break fell inside the word.
  for (const a of [...found]) {
    const [pa, ha] = a.split("@");
    for (const b of found) {
      const [pb, hb] = b.split("@");
      if (ha === hb && pb.length > pa.length && pb.endsWith(pa)) { found.delete(a); break; }
    }
  }
  if (!found.size) return null;

  // Whichever listed prefix ranks highest, so "clientservice@" beats "info@" when a house
  // publishes both.
  return [...found].sort((a, b) =>
    ROLE_PREFIXES.indexOf(a.split("@")[0]) - ROLE_PREFIXES.indexOf(b.split("@")[0])
    || a.localeCompare(b))[0];
}
