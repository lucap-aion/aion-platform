// ==============================|| A FEED THE HOUSE ALREADY PUBLISHES ||============================== //
//
// Almost every brand that sells online already produces a product feed — for Google
// Shopping, for a marketplace, for its own retargeting. It is the same catalogue, maintained
// by them, in a format built to be read by a machine. Asking for that URL is one line in an
// email and it is the least work a client will ever be asked to do; after that it syncs on
// the tick with nobody involved.
//
// It is also the honest answer to a site we cannot read. A house behind a bot wall has not
// decided we may not have its catalogue — its firewall decided that. The feed is the house
// actually answering.
//
// Three shapes cover the field: Google Merchant RSS 2.0 (by far the most common), the Atom
// variant of the same thing, and the CSV/TSV that the same spec defines. All three use the
// same field names, so the reading is shared and only the framing differs.

export type FeedProduct = {
  handle: string;
  sku: string | null;
  name: string;
  category: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  available: boolean;
  imageUrl: string | null;
  productUrl: string | null;
};

const strip = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    // Last, or an &amp;lt; in the source decodes twice.
    .replace(/&amp;/g, "&")
    .trim();

/**
 * "12.00 EUR", "EUR 12,00", "1.234,56", "$1,234.56" -> amount and currency.
 *
 * The separator is decided by which of . and , comes LAST, because that is the decimal one
 * in every convention either is used in. Guessing by position — assuming a dot is always
 * decimal — turns €1.234 into €1.23 on a German feed, which is the kind of error that ends
 * up in a covered value.
 */
export function parseFeedPrice(raw: string): { amount: number | null; currency: string | null } {
  const text = strip(raw ?? "");
  if (!text) return { amount: null, currency: null };

  const code = text.match(/\b([A-Z]{3})\b/)?.[1]
    ?? (/€/.test(text) ? "EUR" : /£/.test(text) ? "GBP" : /\$/.test(text) ? "USD" : null);

  const digits = text.match(/\d[\d.,\s']*\d|\d/)?.[0]?.replace(/[\s']/g, "");
  if (!digits) return { amount: null, currency: code };

  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let normalised: string;
  if (lastDot < 0 && lastComma < 0) normalised = digits;
  else {
    const decimalAt = Math.max(lastDot, lastComma);
    const tail = digits.length - decimalAt - 1;
    // Three digits after the last separator is a thousands group, not a decimal: "1.234".
    normalised = tail === 3
      ? digits.replace(/[.,]/g, "")
      : digits.slice(0, decimalAt).replace(/[.,]/g, "") + "." + digits.slice(decimalAt + 1);
  }
  const amount = Number(normalised);
  return { amount: Number.isFinite(amount) && amount >= 0 ? amount : null, currency: code };
}

/** One field out of an item, by any of the names the spec and its dialects use. */
function field(block: string, ...names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<(?:[a-z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${name}>`, "i");
    const m = re.exec(block);
    if (m) {
      const v = strip(m[1]);
      if (v) return v;
    }
    // <link href="…"/>, which is how Atom writes it.
    const attr = new RegExp(`<(?:[a-z0-9]+:)?${name}\\b[^>]*\\bhref=["']([^"']+)["']`, "i").exec(block);
    if (attr) return strip(attr[1]);
  }
  return null;
}

/** An attribute on a tag — Shopify states the currency as one: <s:price currency="EUR">. */
function attrOf(block: string, tag: string, attr: string): string | null {
  const m = new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*\\b${attr}=["']([^"']+)["']`, "i").exec(block);
  return m ? strip(m[1]) : null;
}

/**
 * The first picture in the block.
 *
 * Shopify's Atom feed has no image field at all; it renders a little HTML card into the
 * summary and the packshot is an <img> inside it. Falling back to that is the difference
 * between a feed that furnishes a deck and one that furnishes a spreadsheet.
 */
function imageInHtml(block: string): string | null {
  const m = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(block);
  return m ? strip(m[1]) : null;
}

const lastPathSegment = (url: string): string => {
  try { return new URL(url, "https://x.invalid").pathname.split("/").filter(Boolean).pop() ?? ""; }
  catch { return ""; }
};

/**
 * The upsert key for a product.
 *
 * Google Merchant's `g:id` is the house's own SKU and is the right answer. Atom's `<id>` is
 * a URL — "https://b.com/products/10550123561307" — which is both unreadable and, worse,
 * would not match the rows the Shopify reader already stores for the same house under its
 * slug: the same catalogue read two ways would become two catalogues.
 */
const handleOf = (url: string | null, id: string | null, name: string): string => {
  const idLooksLikeUrl = /^https?:\/\//i.test(id ?? "");
  const fromUrl = url ? lastPathSegment(url) : "";
  const chosen = (idLooksLikeUrl ? (fromUrl || lastPathSegment(id!)) : id) || fromUrl || name;
  return chosen.toLowerCase().replace(/\s+/g, "-").slice(0, 200);
};

const availableFrom = (v: string | null): boolean =>
  !v || !/out\s*of\s*stock|out_of_stock|discontinued|sold\s*out/i.test(v);

function fromBlock(block: string): FeedProduct | null {
  const name = field(block, "title", "name");
  if (!name) return null;
  const rawId = field(block, "id", "item_group_id", "mpn", "sku");
  // A SKU column holding a URL is not a SKU.
  const id = /^https?:\/\//i.test(rawId ?? "") ? null : rawId;
  const productUrl = field(block, "link", "url", "product_link");
  const { amount, currency } = parseFeedPrice(field(block, "sale_price", "price") ?? "");
  return {
    handle: handleOf(productUrl, rawId, name),
    sku: id,
    name,
    // "Rings > Diamond" is a Google taxonomy path; the leaf is the useful half. `type` is
    // Shopify's spelling of the same field.
    category: (field(block, "product_type", "google_product_category", "category", "type") ?? "")
      .split(">").pop()?.trim() || null,
    description: field(block, "description", "summary"),
    price: amount,
    // The text, then the attribute Shopify puts it in, and only then nothing.
    currency: currency ?? attrOf(block, "price", "currency") ?? attrOf(block, "sale_price", "currency"),
    available: availableFrom(field(block, "availability")),
    imageUrl: field(block, "image_link", "image", "additional_image_link") ?? imageInHtml(block),
    productUrl,
  };
}

/** Split a delimited line, honouring quotes — a product title contains commas constantly. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(cell); cell = ""; }
    else cell += c;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

function fromDelimited(text: string): FeedProduct[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  // Whichever separator the header uses most. A feed is as often tab-separated as comma.
  const delimiter = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const header = splitDelimited(lines[0], delimiter).map((h) => h.toLowerCase().replace(/^g:/, ""));
  const at = (...names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const cols = {
    id: at("id", "sku", "mpn"), title: at("title", "name"), link: at("link", "url"),
    price: at("price"), sale: at("sale_price"), image: at("image_link", "image"),
    type: at("product_type", "category", "google_product_category"),
    availability: at("availability"), description: at("description"),
  };
  if (cols.title < 0) return [];

  const out: FeedProduct[] = [];
  for (const line of lines.slice(1)) {
    const cell = splitDelimited(line, delimiter);
    const get = (i: number) => (i >= 0 ? (cell[i] ?? "") : "");
    const name = get(cols.title);
    if (!name) continue;
    const { amount, currency } = parseFeedPrice(get(cols.sale) || get(cols.price));
    const productUrl = get(cols.link) || null;
    const id = get(cols.id) || null;
    out.push({
      handle: handleOf(productUrl, id, name),
      sku: id,
      name,
      category: get(cols.type).split(">").pop()?.trim() || null,
      description: get(cols.description) || null,
      price: amount,
      currency,
      available: availableFrom(get(cols.availability) || null),
      imageUrl: get(cols.image) || null,
      productUrl,
    });
  }
  return out;
}

/**
 * Read whatever a house gave us the URL of.
 *
 * Format is decided by the CONTENT, not the extension or the content-type header: a feed is
 * served as text/plain, application/octet-stream and text/xml by different hosts for the
 * same file, and a ".xml" that turns out to be CSV is a support call nobody needs.
 */
export function parseProductFeed(text: string): FeedProduct[] {
  const head = text.slice(0, 4000);
  if (/<(?:rss|feed|channel|item|entry)\b/i.test(head)) {
    const blocks = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
    const out: FeedProduct[] = [];
    const seen = new Set<string>();
    for (const b of blocks) {
      const p = fromBlock(b);
      // One row per handle: a feed lists every variant of a ring separately, and the
      // catalogue is keyed on the handle — a duplicate takes the whole batch down with it.
      if (p && p.handle && !seen.has(p.handle)) { seen.add(p.handle); out.push(p); }
    }
    return out;
  }
  const rows = fromDelimited(text);
  const seen = new Set<string>();
  return rows.filter((p) => p.handle && !seen.has(p.handle) && seen.add(p.handle));
}
