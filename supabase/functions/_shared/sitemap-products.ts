// ==============================|| A CATALOGUE FROM A SITEMAP ALONE ||============================== //
//
// The last resort for a house we cannot read a single page of.
//
// damiani.com answers 403 to every plain request and hands the renderer a Cloudflare
// interstitial, so neither the schema.org reader nor the renderer gets one product. Its own
// robots.txt permits those pages; it is the firewall that cannot tell us from a scraper. But
// the sitemap it does serve carries 1,243 page URLs and 1,314 packshots, and every one of
// both carries the item code — so the catalogue is sitting in plain view in the one file the
// house lets through.
//
// What this recovers: name, item code, category, product URL, photography. What it cannot:
// the PRICE, which lives only on the page. That is exactly what step 2's data request asks
// the client for, so the gap closes in the conversation the pipeline is already having.
//
// This is never preferred over reading the pages. A page states its price, its availability
// and its real name; a slug is an inference. It runs when the alternative is nothing at all.

import { productUrlScore } from "./catalogue-urls.ts";

export type SitemapProduct = {
  handle: string;
  sku: string | null;
  name: string;
  category: string | null;
  productUrl: string;
  imageUrl: string | null;
  /** Every packshot the sitemap lists for this piece, best first. */
  images: string[];
};

const IMAGE_URL = /\.(?:jpe?g|png|webp|avif|gif)(?:$|[?#])/i;

/**
 * An item code: a run of digits long enough to be a manufacturer's reference.
 *
 * Five is the floor — Messika's "05337" is five — and a year is excluded for the same reason
 * it is excluded from `hasItemCode`: "collection-2024" is not a reference.
 */
const CODE = /\d{5,10}/g;
const YEARLIKE = /^(?:19|20)\d{2}$/;

function codesIn(segment: string): string[] {
  return [...segment.matchAll(CODE)].map((m) => m[0]).filter((c) => !YEARLIKE.test(c));
}

/** The last path segment, with a routing extension stripped. */
function lastSegment(url: string): string {
  let path: string;
  try { path = new URL(url).pathname; } catch { return ""; }
  return (path.split("/").filter(Boolean).pop() ?? "").replace(/\.(?:html?|php|aspx?|jsp)$/i, "");
}

// The plural nouns the catalogue already speaks in — read off what the readable houses
// produced, so a sitemap-derived row files alongside them rather than inventing a vocabulary.
const CATEGORY_BY_WORD: [RegExp, string][] = [
  [/\b(?:ring|anello|anelli|bague|solitaire|solitari|sortija)\b/i, "rings"],
  [/\b(?:earring|earrings|orecchino|orecchini|boucle|boucles|pendiente)\b/i, "earrings"],
  [/\b(?:necklace|necklaces|collana|collane|collier|collar)\b/i, "necklaces"],
  [/\b(?:bracelet|bracelets|bracciale|bracciali|pulsera)\b/i, "bracelets"],
  [/\b(?:bangle|bangles|rigido)\b/i, "bangles"],
  [/\b(?:pendant|pendants|pendente|ciondolo|pendentif)\b/i, "pendants"],
  [/\b(?:cufflink|cufflinks|gemello|gemelli|boutons?-de-manchette)\b/i, "cufflinks"],
  [/\b(?:watch|watches|orologio|orologi|montre)\b/i, "watches"],
  [/\b(?:bag|bags|borsa|borse|sac|tote|clutch)\b/i, "bags"],
  [/\b(?:brooch|brooches|spilla|broche)\b/i, "brooches"],
  [/\b(?:tiara|diadema)\b/i, "tiaras"],
  [/\b(?:charm|charms|ciondoli)\b/i, "charms"],
  // Not every house is a jeweller. Ferragamo's catalogue is eyewear, leather and fragrance,
  // and a vocabulary of rings and necklaces left three quarters of it uncategorised — which
  // means three quarters of it costed at zero.
  [/\b(?:handbag|handbags|bag|bags|tote|clutch|satchel|shopper|borsa|borse|sac)\b/i, "bags"],
  [/\b(?:wallet|wallets|cardholder|card\s?holder|portafoglio|purse)\b/i, "wallets"],
  [/\b(?:belt|belts|cintura|ceinture)\b/i, "belts"],
  [/\b(?:scarf|scarves|foulard|sciarpa|stole|shawl)\b/i, "scarves"],
  [/\b(?:sunglasses|eyewear|glasses|occhiali|lunettes)\b/i, "eyewear"],
  [/\b(?:shoe|shoes|sneaker|sneakers|pump|pumps|loafer|loafers|sandal|sandals|boot|boots|mocassin|scarpe)\b/i, "shoes"],
  // "EDT 3.4 fl. oz." and "EDP" are how a fragrance is named on a product page.
  [/\b(?:fragrance|perfume|parfum|profumo|cologne|eau\s+de\s+(?:parfum|toilette|cologne)|edt|edp|edc)\b/i, "fragrance"],
  [/\b(?:cufflink|cufflinks)\b/i, "cufflinks"],
  [/\b(?:tie|ties|cravatta|necktie|bow\s?tie)\b/i, "ties"],
  [/\b(?:keyring|key\s?ring|keychain|portachiavi)\b/i, "keyrings"],
];

/** The category a slug names, in the plural form the rest of the catalogue uses. */
export function categoryFromSlug(slug: string): string | null {
  const words = slug.replace(/[-_]+/g, " ");
  for (const [re, name] of CATEGORY_BY_WORD) if (re.test(words)) return name;
  return null;
}

/**
 * "white-gold-and-diamonds-necklace-20059783-c" -> "White gold and diamonds necklace".
 *
 * The code and whatever single letters trail it are routing, not the name. Capitalised as a
 * sentence rather than title-cased: these slugs are descriptions, and "White Gold And
 * Diamonds Necklace" reads like a spreadsheet.
 */
export function nameFromSlug(slug: string): string {
  const words = slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{5,10}\b/g, " ")
    // A trailing variant letter left behind by the code it belonged to.
    .replace(/\s+[a-z]\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Build what catalogue we can out of a sitemap's own contents.
 *
 * Pages and images are joined on the item code both carry — Damiani's
 * `…/white-gold-and-diamonds-earrings-20061332` and `…/20061332_1.jpg` — which recovers a
 * packshot for 82% of its coded pages without one page ever being fetched.
 *
 * Deterministic: sorted by item code, images in the order the sitemap listed them. The
 * caller stores a cursor against this, and a list that reshuffles makes it meaningless.
 */
export function productsFromSitemap(
  input: { pages: string[]; images: string[] },
): SitemapProduct[] {
  // One page per code, the shortest URL winning — a code appearing in two paths is usually
  // the piece and a listing that mentions it.
  const pageByCode = new Map<string, string>();
  for (const url of input.pages) {
    if (IMAGE_URL.test(url)) continue;
    // Editorial, store locators, terms: scored 0 and never a product, whatever digits the
    // slug happens to carry.
    if (productUrlScore(url) === 0) continue;
    const slug = lastSegment(url);
    for (const code of codesIn(slug)) {
      const held = pageByCode.get(code);
      if (!held || url.length < held.length) pageByCode.set(code, url);
    }
  }

  const imagesByCode = new Map<string, string[]>();
  for (const img of input.images) {
    for (const code of codesIn(lastSegment(img))) {
      if (!pageByCode.has(code)) continue;
      const held = imagesByCode.get(code) ?? [];
      if (!held.includes(img)) held.push(img);
      imagesByCode.set(code, held);
    }
  }

  // Invert to one entry per PAGE. A slug can carry more than one code — a pair sold as a
  // set, a size in the name — and emitting a row per code gave two rows with the same
  // handle, which Postgres refuses outright: "ON CONFLICT DO UPDATE command cannot affect
  // row a second time". The whole batch was rejected, so a catalogue that had been read
  // perfectly well was stored as nothing.
  const codesByPage = new Map<string, string[]>();
  for (const [code, url] of pageByCode) {
    const held = codesByPage.get(url) ?? [];
    held.push(code);
    codesByPage.set(url, held);
  }

  const out: SitemapProduct[] = [];
  for (const url of [...codesByPage.keys()].sort()) {
    const codes = codesByPage.get(url)!.sort();
    const slug = lastSegment(url);
    const name = nameFromSlug(slug);
    // A slug that is nothing but its code names nothing a person could read on a slide.
    if (name.length < 3) continue;
    // Every picture any of this page's codes matched, in sitemap order, without repeats.
    const images: string[] = [];
    for (const code of codes) {
      for (const img of imagesByCode.get(code) ?? []) if (!images.includes(img)) images.push(img);
    }
    out.push({
      handle: slug.toLowerCase(),
      sku: codes[0],
      name,
      category: categoryFromSlug(slug),
      productUrl: url,
      imageUrl: images[0] ?? null,
      images,
    });
  }
  return out;
}
