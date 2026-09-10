// A catalogue from any storefront, not just Shopify.
//
// Storefront ingestion only ever spoke Shopify: ask /products.json, and if that
// is not there, record platform 'none' and give up. That is most of the market.
// Ferragamo 403s a plain fetch and is not Shopify; Buccellati answers 406;
// Damiani 403. Each of those is a brand with no catalogue — which is not a
// cosmetic gap, because the intro deck is built from the brand's own pieces and
// the demo book of business is priced from them. No catalogue, no deck, no demo.
//
// But e-commerce sites publish their catalogue in a standard format whether they
// want to be scraped or not, because Google requires it: schema.org Product, as
// JSON-LD. One Ferragamo category page carries an ItemList of SIXTY products,
// each with name, url, image, price and currency — everything storefront_products
// stores, in a single fetch, on a site that blocks everything else.
//
// So this is a parser, not a scraper: it reads the structured data the site
// already publishes for search engines. Pure and synchronous, so it can be
// tested against real captured pages rather than mocked ones.

export type ExtractedProduct = {
  name: string;
  product_url: string | null;
  image_url: string | null;
  price: number | null;
  price_currency: string | null;
  sku: string | null;
  available: boolean | null;
  category: string | null;
};

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

const typesOf = (node: Record<string, unknown>): string[] =>
  asArray(node["@type"]).map((t) => String(t));

function absolute(url: unknown, base: string): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try { return new URL(url, base).href; } catch { return null; }
}

// Prices arrive as 850, "850.00", "$850.00" and "1.234,56" depending on the
// locale the page was rendered in. A wrong price is worse than none: it lands in
// the demo's book of business and on the value covered.
function toPrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let n: number;
  if (lastComma > lastDot) {
    // 1.234,56 — comma is the decimal separator.
    n = Number(cleaned.replace(/\./g, "").replace(",", "."));
  } else {
    n = Number(cleaned.replace(/,/g, ""));
  }
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function firstImage(v: unknown, base: string): string | null {
  for (const candidate of asArray(v as unknown)) {
    if (typeof candidate === "string") {
      const abs = absolute(candidate, base);
      if (abs) return abs;
    } else if (candidate && typeof candidate === "object") {
      // schema.org allows an ImageObject rather than a bare URL.
      const abs = absolute((candidate as Record<string, unknown>).url ?? (candidate as Record<string, unknown>).contentUrl, base);
      if (abs) return abs;
    }
  }
  return null;
}

function productFrom(node: Record<string, unknown>, base: string): ExtractedProduct | null {
  const name = typeof node.name === "string" ? node.name.trim() : "";
  if (!name) return null;

  const offers = asArray(node.offers as unknown)[0] as Record<string, unknown> | undefined;
  const availability = String(offers?.availability ?? "").toLowerCase();

  return {
    name: name.slice(0, 300),
    product_url: absolute(node.url ?? offers?.url, base),
    image_url: firstImage(node.image, base),
    price: toPrice(offers?.price ?? (offers?.priceSpecification as Record<string, unknown> | undefined)?.price),
    price_currency: typeof offers?.priceCurrency === "string" ? offers.priceCurrency.toUpperCase().slice(0, 3) : null,
    sku: typeof node.sku === "string" ? node.sku : typeof node.productID === "string" ? node.productID : null,
    // Absent availability means unknown, not out of stock — most listing pages
    // omit it entirely and marking everything unavailable would empty the deck.
    available: availability ? /instock|limitedavailability|preorder|backorder/.test(availability) : null,
    category: typeof node.category === "string" ? node.category.slice(0, 120) : null,
  };
}

// Walks anything: a bare Product, an array, an @graph, an ItemList of ListItems,
// an ItemList of Products directly. Sites disagree about which, and a parser
// that only handles one shape works on one site.
function collect(node: unknown, base: string, out: ExtractedProduct[], depth = 0): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, base, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  if (typesOf(obj).includes("Product")) {
    const p = productFrom(obj, base);
    if (p) out.push(p);
    // A Product can still nest variants under its offers; keep walking.
  }
  for (const key of ["@graph", "itemListElement", "item", "mainEntity", "hasPart"]) {
    if (key in obj) collect(obj[key], base, out, depth + 1);
  }
}

// og: tags, for a product page that carries no JSON-LD. One product, not sixty,
// but a brand whose whole site is like that still gets a catalogue.
function fromOpenGraph(html: string, base: string): ExtractedProduct | null {
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];

  const type = (meta("og:type") ?? "").toLowerCase();
  const name = meta("og:title");
  const image = meta("og:image");
  if (!name || !image || (type && !type.includes("product"))) return null;

  return {
    name: name.trim().slice(0, 300),
    product_url: absolute(meta("og:url") ?? base, base),
    image_url: absolute(image, base),
    price: toPrice(meta("product:price:amount") ?? meta("og:price:amount")),
    price_currency: (meta("product:price:currency") ?? meta("og:price:currency") ?? "").toUpperCase().slice(0, 3) || null,
    sku: null,
    available: null,
    category: null,
  };
}

/**
 * Every product this page publishes, deduped.
 *
 * Deduped on product_url first, because a listing page repeats the same product
 * once per colourway — the Ferragamo page that returned sixty entries has the
 * same loafer three times over. Falling back to name+image catches sites that
 * omit the url.
 */
export function extractProducts(html: string, baseUrl: string): ExtractedProduct[] {
  const found: ExtractedProduct[] = [];

  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      collect(JSON.parse(raw), baseUrl, found);
    } catch {
      // One malformed block must not lose the rest of the page — sites embed
      // JSON-LD with trailing commas and unescaped newlines more often than not.
    }
  }

  if (found.length === 0) {
    const og = fromOpenGraph(html, baseUrl);
    if (og) found.push(og);
  }

  const seen = new Set<string>();
  const unique: ExtractedProduct[] = [];
  for (const p of found) {
    const key = (p.product_url ?? `${p.name}|${p.image_url ?? ""}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  // A row with neither a picture nor a price is not worth storing: the deck
  // needs the image and the demo book needs the price.
  return unique.filter((p) => p.image_url || p.price != null);
}
