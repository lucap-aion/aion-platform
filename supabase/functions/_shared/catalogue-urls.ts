// ==============================|| WHICH PAGE CARRIES THE CATALOGUE ||============================== //
// Ordering a site's crawled URLs by how likely each is to yield products.
//
// It matters because a run reads a handful of pages, not the whole site: the ordering
// decides whether the first batch returns sixty products or none.
//
// The rule used to be "a path that says collection/shop/category carries many products, a
// path that says product carries one, so try the listings first". That is right for a
// Shopify store and exactly wrong for the houses this code exists for. Ferragamo's whole
// site lives under /shop/, so every URL scored as a listing and they sorted alphabetically;
// the first five were category pages, and Ferragamo's category pages publish a breadcrumb
// and nothing else — the product grid arrives from a later client-side call that no
// renderer waits for. Meanwhile its PRODUCT pages carry the lot:
//
//   "@type":"Product" … "price":"2500.00" … "priceCurrency":"USD" … "availability":"InStock"
//
// So an item code in the path is the strongest signal there is, and it is the one the old
// rule ranked LAST. A run of five category pages returned zero products from a site with a
// full catalogue, which is what "it doesn't scrape the products despite being there" was.

/**
 * Higher is more likely to carry product data.
 *
 * Deliberately ordered for sites that are NOT Shopify — a Shopify store never reaches this,
 * because its feed is taken whole from /products.json.
 */
// A file, not a page. These carry digits constantly — apple-icon-114x114.png,
// montserrat_n4.8194….woff2 — so the item-code rule scored them as products and a reader
// with a budget of twelve pages a run would spend it on a favicon and a font. Found by
// pointing the ranking at three sites it had never seen.
const NOT_A_PAGE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|css|m?js|map|json|xml|txt|pdf|zip|gz|mp4|webm|mp3|wav|avi|mov)(?:[?#]|$)/i;

export function productUrlScore(url: string): number {
  if (NOT_A_PAGE.test(url)) return 0;
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  // A trailing extension is part of the routing, not of the name: Cartier's
  // "love-ring-b4084600.html" carries its item code in front of a suffix, and matching on
  // the raw segment misses it.
  const last = (path.split("/").filter(Boolean).pop() ?? "").replace(/\.(html?|php|aspx?|jsp)$/, "");

  // Editorial and service pages live under the same prefix as the shop on these sites and
  // never have a price in them. Worth actively ranking below everything else rather than
  // merely not boosting. Whole segments only — a word that merely appears inside a product
  // slug must not sink it.
  if (/\/(stories|news|journal|about|world|heritage|magazine|faq|help|customer|customer-service|client-service|legal|privacy|cookie|cookies|terms|terms-and-conditions|terms-and-conditions-of-sale|terms-and-conditions-of-use|care|care-and-repairing|repairs|boutique|boutiques|store|stores|store-locator|storelocator|contact|contact-us|careers|sustainability|shipping|returns|sitemap|accessibility)(\/|$)/.test(path)) {
    return 0;
  }

  // Terms of sale, published per market and per year, one page each. "cgv" is the French
  // abbreviation and the segment these sites actually use; there are dozens of them on a
  // house that runs promotions, and they carry a year in the slug — see YEARLIKE below.
  if (/\/(cgv|cgu|cga|conditions|conditions-generales|conditions-de-vente|terms-of-sale|mentions-legales|note-legali|aviso-legal|impressum)[^/]*(\/|$)/.test(path)) {
    return 0;
  }

  // An error or search page. Worth naming: a renderer answers 200 for a site's own 404, and
  // Pomellato's carries og:image and a title, which came back as a product called
  // "Pomellato Online-Boutique | Schmuck — Ringe, Ohrringe, Armbänder, Halsketten".
  if (/\/(404|403|500|error|errors|not-found|notfound|search|search-results)(\/|$)/.test(path)) {
    return 0;
  }

  // An item code — "hug-sh-ew-798503", "yasmin-95-797084". One page, one product, and the
  // product's full structured data.
  if (hasItemCode(last)) return 5;

  // A path that names itself a product.
  if (/\/(products?|item|pd|dp)\//.test(path)) return 4;

  // A listing. Rich on a site that renders server-side, empty on one that does not, so it
  // sits above the unknowns and below anything that looks like an actual item.
  if (/\/(collections?|category|categories|catalog(ue)?)\//.test(path)) return 3;

  return 2;
}

/**
 * Does this slug carry a manufacturer's item code?
 *
 * The two rules above only see a code that is either the whole last token or preceded by a
 * hyphen — "…/hug-sh-ew-798503". Pomellato writes its references as letters and digits run
 * together: "nudo-classic-ring-pab9040-o6bkr-zaltl". Every one of those pages publishes a
 * complete Product record — name, image, sku, price, currency, availability — and every one
 * of them scored 2, the same as a press release, so they sorted alphabetically among four
 * hundred pages and a reader with a budget of twelve pages a run found nothing. Pomellato
 * read as a house with no catalogue for six weeks, which cost it its intro deck and its
 * demo book.
 *
 * A code is a token with at least three digits in it, whatever letters surround them —
 * "pab9040", "b4084600", "jauring014744".
 *
 * A YEAR is not one, and that exception is not academic. Messika publishes the terms of its
 * Barcelona boutique promotion once per year per language — cgv-barcelona-2021-ca,
 * -2021-en, -2021-es, -2022-ca … — and "2021" satisfied the rule exactly. Ties break
 * alphabetically, so "cgv-…" sorted to the top of four hundred URLs, and the eight pages
 * detection sampled were eight sets of terms and conditions. A house whose product pages
 * publish a complete Product record, readable with a plain fetch, was recorded as having no
 * catalogue at all.
 *
 * Only when the year is the token's ONLY run of digits: "gatsby-05446-pg" keeps its code,
 * and a reference that genuinely reads 2021 among other digits — "ring-20210044" — is still
 * a code.
 */
const YEARLIKE = /^(?:19|20)\d{2}$/;

export function hasItemCode(segment: string): boolean {
  return segment.split(/[-_.]/).some((token) => {
    if (!/^[a-z]*\d{3,}[a-z0-9]*$/.test(token)) return false;
    if ((token.match(/\d/g) ?? []).length < 3) return false;
    const runs = token.match(/\d+/g) ?? [];
    return !(runs.length === 1 && YEARLIKE.test(runs[0]));
  });
}

// ── One locale, not nine ────────────────────────────────────────────────────────────────── //
// These sites publish the same catalogue under a locale per market: pomellato.com/ae_en,
// /gb_en, /va_it, ferragamo.com/shop/us/en. The crawl indexes whatever it finds, so a
// reader that takes pages in rank order reads the same ring in three currencies, and which
// price ends up stored is down to which page happened to be read last. The handle is the
// product's own slug, so the rows collapse into one — with a price from an arbitrary market.
//
// So the catalogue is read from ONE locale, and a European one where the site offers it:
// AION's programmes, Chubb's quotes and every business case are in euros.

const EUROZONE = new Set([
  "it", "de", "fr", "es", "nl", "be", "at", "ie", "pt", "fi", "gr", "sk", "si", "lt", "lv",
  "ee", "lu", "cy", "mt", "hr", "va", "eu",
]);

/**
 * The locale-ish prefix of a URL, or null.
 *
 * Handles the three shapes these sites use: one segment carrying both halves ("ae_en",
 * "en-us"), two adjacent two-letter segments ("/shop/us/en/"), and a bare country or
 * language segment ("/it/"). Looks only at the first few segments, so an item code made of
 * two-letter tokens cannot be mistaken for a locale.
 */
export function localeOf(url: string): string | null {
  let segments: string[];
  try {
    segments = new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return null;
  }
  const head = segments.slice(0, 3);
  for (let i = 0; i < head.length; i++) {
    if (/^[a-z]{2}[_-][a-z]{2}$/.test(head[i])) return head[i];
    if (/^[a-z]{2}$/.test(head[i])) {
      return /^[a-z]{2}$/.test(head[i + 1] ?? "") ? `${head[i]}/${head[i + 1]}` : head[i];
    }
  }
  return null;
}

/** The country/language halves of a locale, lowercase, in whatever order the site wrote them. */
const localeParts = (locale: string): string[] => locale.split(/[_\-/]/);

/**
 * Which locale to read a catalogue from. Null when the site has no locale prefixes at all,
 * which is most single-market sites and needs no filtering.
 *
 * Counted over pages that actually look like products, because a locale can be present in
 * the crawl only as a homepage.
 *
 * A eurozone locale wins — but only if it carries a catalogue worth reading. The preference
 * used to be absolute, and on messika.com that was fatal: 166 product pages under /en, none
 * at all under /fr, and /fr won because French is a eurozone language. The reader then spent
 * every run on a hundred and fifty-three French editorial pages and reported "0 products so
 * far" for as long as anyone cared to watch, about a house whose product pages hand over a
 * complete Product record to a plain fetch.
 *
 * The test is "does this locale have a catalogue at all", NOT "does it have the biggest one".
 * A crawl is a sample, and a eurozone market legitimately turns up with fewer pages than
 * another — Pomellato's /va_it against its /ae_en — and should still win. What it cannot do
 * is win with a share so small the locale plainly has no catalogue in it: Messika's French
 * side offered one product page against English's hundred and sixty-six.
 *
 * Prices are stored with the currency the page states, so reading a non-euro market records
 * pounds as pounds rather than as euros. The reason to prefer the eurozone is that
 * everything downstream is quoted in it, not that a foreign price would be mislabelled.
 */
const EUROZONE_SHARE = 0.25;

export function preferredLocale(urls: string[]): string | null {
  const counts = new Map<string, number>();
  for (const url of urls) {
    if (productUrlScore(url) < 4) continue;
    const locale = localeOf(url);
    if (!locale) continue;
    counts.set(locale, (counts.get(locale) ?? 0) + 1);
  }
  if (!counts.size) return null;

  const isEuro = (locale: string) => localeParts(locale).some((p) => EUROZONE.has(p));
  // Stable: count, then eurozone, then alphabetical — never insertion order, because the
  // caller keeps a cursor into the list this decides.
  const byCount = [...counts.entries()].sort((a, b) =>
    b[1] - a[1] || Number(isEuro(b[0])) - Number(isEuro(a[0])) || a[0].localeCompare(b[0]));

  const richest = byCount[0];
  const euro = byCount.find(([locale]) => isEuro(locale));
  return euro && euro[1] >= richest[1] * EUROZONE_SHARE ? euro[0] : richest[0];
}

/** URLs in one locale, or all of them when narrowing would leave too little to read. */
export function inLocale(urls: string[], locale: string | null, keepAtLeast = 5): string[] {
  if (!locale) return urls;
  const kept = urls.filter((u) => localeOf(u) === locale);
  return kept.length >= keepAtLeast ? kept : urls;
}

/**
 * Crawled URLs, best first, stable.
 *
 * The tie-break is not decoration: the caller reads a window of this list and stores an
 * index into it, so a list that reshuffles between runs makes that cursor meaningless.
 */
/**
 * A sample to TRY, out of a ranked list that may be thousands long.
 *
 * `ranked.slice(0, n)` takes a contiguous alphabetical run, which on a real site is n
 * variants of the same page: eight sets of Barcelona terms, or eight boutique addresses.
 * Detection then reports "this site publishes no catalogue" on the strength of having looked
 * at the same page eight times.
 *
 * So: the best few, which is where a well-ranked list really does have the answer, and the
 * rest spread evenly across the whole list. Order is preserved and the result is
 * deterministic, because the cursor into these lists has to mean something between runs.
 */
export function catalogueSample(ranked: string[], n: number, best = 3): string[] {
  if (ranked.length <= n) return [...ranked];
  const out = ranked.slice(0, Math.min(best, n));
  const spread = n - out.length;
  for (let i = 0; i < spread; i++) {
    const at = out.length + Math.floor((i * (ranked.length - out.length)) / spread);
    const pick = ranked[Math.min(at, ranked.length - 1)];
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}

export function rankCatalogueUrls(urls: string[]): string[] {
  return [...new Set(urls)]
    // Score 0 is not "unlikely to carry a product", it is "never": a FAQ, a privacy notice
    // and a heritage story publish no Product data on any site. Ranking them last still
    // cost a renderer call each at the end of every pass, and — worse — padded the
    // "pages remaining" the panel reports with pages the run could learn nothing from.
    .filter((u) => productUrlScore(u) > 0)
    .sort((a, b) => productUrlScore(b) - productUrlScore(a) || a.localeCompare(b));
}
