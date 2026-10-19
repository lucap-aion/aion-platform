// Reading a Shopify catalogue feed (/products.json) into the shape we store.
//
// Lifted out of sync-storefront so a test can exercise the code that actually
// runs, the way product-extract.ts is tested against a real Ferragamo page.
// Nothing here fetches: give it the parsed feed, get rows back.
//
// The reason it now returns variants: the feed has always carried them — a
// Luisa Beccaria cardigan comes back as five variants (38, 40, 42, 44, 46),
// each with its own price and its own `available` — and we were collapsing all
// of it into one price and one boolean. "Ce l'abbiamo in 42?" is the question an
// associate is asked most often on the floor, and the answer was already in the
// response we parse every Monday.

// Product types that are not products. Kept as data, not code: a shop's own
// junk types ("storytelling 3") are noise to an associate.
const SKIP_TYPES = new Set(["storytelling", "storytelling 3", "gadget", ""]);

export type RawShopifyProduct = {
  handle: string;
  title: string;
  body_html?: string;
  product_type?: string;
  tags?: string[] | string;
  options?: { name?: string }[];
  variants?: {
    id?: number;
    title?: string;
    sku?: string;
    price?: string;
    compare_at_price?: string;
    available?: boolean;
    position?: number;
  }[];
  images?: { src?: string }[];
};

export type FeedVariant = {
  variantId: number | null;
  title: string;
  sku: string | null;
  price: number | null;
  compareAt: number | null;
  available: boolean;
  position: number | null;
};

export type FeedProduct = {
  handle: string;
  sku: string | null;
  name: string;
  category: string | null;
  collection: string | null;
  description: string | null;
  price: number | null;
  compareAt: number | null;
  available: boolean;
  imageUrl: string | null;
  // "Size", or "Size / Colour" on a two-option product. Null when the shop
  // ships a single unnamed variant, which Shopify calls "Default Title".
  optionName: string | null;
  variants: FeedVariant[];
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Shopify's name for "this product has no real options".
const isDefaultVariant = (title: string) => title.trim().toLowerCase() === "default title";

export function mapShopifyProducts(products: RawShopifyProduct[], keepUntyped = false): FeedProduct[] {
  const out: FeedProduct[] = [];
  for (const p of products) {
    const type = (p.product_type ?? "").trim();
    // Some stores leave product_type empty on real products (keepUntyped);
    // only apply the junk-type skip list to non-empty types there.
    if (SKIP_TYPES.has(type.toLowerCase()) && !(keepUntyped && type === "")) continue;

    const rawVariants = p.variants ?? [];
    const available = rawVariants.some((v) => v.available);
    const prices = rawVariants.map((v) => num(v.price)).filter((n): n is number => n != null);
    const comps = rawVariants.map((v) => num(v.compare_at_price)).filter((n): n is number => n != null);

    const variants: FeedVariant[] = rawVariants
      .map((v, i) => ({
        variantId: Number.isFinite(Number(v.id)) ? Number(v.id) : null,
        title: (v.title ?? "").trim(),
        sku: (v.sku ?? "").trim() || null,
        // Per size, the shop's own price — NOT gated on availability the way the
        // product-level price is. A sold-out 38 beside an available 40 is
        // exactly the case an associate needs to see whole.
        price: num(v.price),
        compareAt: num(v.compare_at_price),
        available: Boolean(v.available),
        position: Number.isFinite(Number(v.position)) ? Number(v.position) : i + 1,
      }))
      .filter((v) => v.title && !isDefaultVariant(v.title));

    const optionNames = (p.options ?? [])
      .map((o) => (o?.name ?? "").trim())
      .filter((n) => n && n.toLowerCase() !== "title");

    out.push({
      handle: p.handle,
      sku: (rawVariants[0]?.sku ?? "").trim() || null,
      name: p.title,
      category: type || null,
      collection: deriveCollection(p.tags, type),
      description: stripHtml(p.body_html ?? "").slice(0, 2000) || null,
      // Mirror the storefront: it hides the price on unavailable items (shows
      // "price on request"). products.json still carries a price for them, but
      // quoting it makes the associate look wrong to the client — so only trust
      // a price when the piece is actually purchasable online.
      price: available && prices.length ? Math.min(...prices) : null,
      compareAt: available && comps.length ? Math.min(...comps) : null,
      available,
      imageUrl: p.images?.[0]?.src ?? null,
      optionName: optionNames.length ? optionNames.join(" / ") : null,
      variants,
    });
  }
  return out;
}

// Collection = the tag that isn't a housekeeping tag, an internal code, or the
// category itself. Shops tag products with ERP codes too ("SAPG::9370 ~ Color");
// those are noise to a sales associate, so skip them and take the next tag —
// the DB trigger normalises whatever still gets through.
export function deriveCollection(tags: string[] | string | undefined, category: string): string | null {
  const list = Array.isArray(tags)
    ? tags
    : typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : [];
  const stop = new Set(["all products", "new", "sale", category.toLowerCase()]);
  const isCode = (t: string) => /^SAPG::/i.test(t) || /~\s*Color$/i.test(t);
  const pick = list.find((t) => t && !stop.has(t.trim().toLowerCase()) && !isCode(t.trim()));
  return pick ? pick.trim() : null;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}
