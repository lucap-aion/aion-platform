// sync-storefront: ingest a brand's FULL public catalogue from its e-commerce
// (Shopify /products.json) into storefront_products — name, category, collection
// (from tags), description, price and a CDN image — then embed each image with
// Voyage multimodal for visual search. Idempotent + resumable: product fields
// are refreshed every run; image embedding is (re)done only when missing or the
// image changed, at most MAX_EMBED_PER_RUN per call (returns `remaining`).
//
// Auth: x-batch-secret (cron) / service-role / admin.
// Body: { brand_id?, max? }
// Returns: { results: [{ brand_id, products, upserted, embedded, remaining, done }] }

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractProducts } from "../_shared/product-extract.ts";
import { mapShopifyProducts } from "../_shared/shopify-feed.ts";
import type { FeedVariant, RawShopifyProduct } from "../_shared/shopify-feed.ts";
import { parseProductFeed } from "../_shared/product-feed.ts";
import { AION_UA } from "../_shared/robots.ts";
import { rankCatalogueUrls, preferredLocale, inLocale, localeOf } from "../_shared/catalogue-urls.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") ?? "";
const UA = AION_UA;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";

const EMBED_MODEL = "voyage-multimodal-3.5";
const EMBED_DIMS = 1024;
const EMBED_BATCH = 8;
const MAX_EMBED_PER_RUN = 150;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Brand storefronts we can ingest (Shopify stores expose /products.json) come
// from the storefront_sources table, not from code: onboarding a new brand is an
// INSERT, not a deploy. onboard-brand detects the feed and writes the row.
// `platform` is part of this, and its absence is why no non-Shopify brand ever got a
// catalogue. syncBrand branches on `store.platform === "structured"`, loadStorefronts built
// the object without it, so the check was always false and every brand went down the
// Shopify path — which 404s on a site that has no /products.json. The Deno functions are not
// covered by `tsc` (tsconfig includes only src/), so reading a property the type does not
// have compiled and shipped in silence.
type Storefront = { base: string; currency: string; keepUntyped: boolean; platform: string; cursor: number };

async function loadStorefronts(
  admin: ReturnType<typeof createClient>, only: number | null,
): Promise<Map<number, Storefront>> {
  let q = admin.from("storefront_sources")
    .select("brand_id, base_url, currency, keep_untyped, platform, enabled, structured_cursor")
    .eq("enabled", true).in("platform", ["shopify", "structured", "feed"]);
  if (only) q = q.eq("brand_id", only);
  const { data, error } = await q;
  if (error) throw new Error(`storefront_sources: ${error.message}`);
  const out = new Map<number, Storefront>();
  for (const r of data ?? []) {
    out.set(Number(r.brand_id), {
      base: String(r.base_url).replace(/\/+$/, ""),
      currency: String(r.currency ?? "EUR"),
      keepUntyped: Boolean(r.keep_untyped),
      platform: String(r.platform ?? "shopify"),
      cursor: Number(r.structured_cursor ?? 0),
    });
  }
  return out;
}

// product_type values that aren't real sellable jewelry.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const batchSecret = req.headers.get("x-batch-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const isBatch = KNOWLEDGE_BATCH_SECRET.length > 0 && batchSecret === KNOWLEDGE_BATCH_SECRET;
  const isServiceRole = token !== "" && (token === SUPABASE_SERVICE_ROLE_KEY || jwtRole(token) === "service_role");
  if (!isBatch && !isServiceRole) {
    if (!token) return jsonError("missing bearer token", 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonError("invalid session", 401);
    const { data: adminRow } = await userClient
      .from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return jsonError("admin required", 403);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const only = Number(body.brand_id ?? 0) || null;
  const max = Math.min(Number(body.max ?? MAX_EMBED_PER_RUN) || MAX_EMBED_PER_RUN, MAX_EMBED_PER_RUN);
  try {
    const stores = await loadStorefronts(admin, only);
    if (stores.size === 0) {
      return json({ results: [], note: only
        ? `brand ${only} has no enabled Shopify storefront_sources row`
        : "no enabled storefronts configured" });
    }
    const results = [];
    for (const [brandId, store] of stores) results.push(await syncBrand(admin, brandId, store, max));
    return json({ results });
  } catch (err) {
    console.error("[sync-storefront]", err);
    return jsonError(err instanceof Error ? err.message : "internal error", 500);
  }
});

async function syncBrand(
  admin: ReturnType<typeof createClient>, brandId: number, store: Storefront, maxEmbed: number,
) {
  // Shopify hands over the whole catalogue in one feed. Everything else
  // publishes it as schema.org JSON-LD for Google, which is most of the market
  // and includes every house that blocks a plain fetch.
  // One timestamp for the whole run: the mark in mark-and-sweep below.
  const runStart = new Date().toISOString();
  const structured = store.platform === "structured"
    ? await fetchStructured(admin, brandId, store.base, store.cursor)
    : null;
  const products = structured
    ? structured.products
    : store.platform === "feed"
    // A feed the house publishes: one request, the whole catalogue, maintained by them.
    ? await fetchFeed(store.base, store.currency)
    : await fetchStorefront(store.base, store.keepUntyped);

  // 1. Upsert product fields for the whole range (cheap, every run).
  const rows = products.map((p) => ({
    brand_id: brandId,
    handle: p.handle,
    sku: p.sku,
    name: p.name,
    category: p.category,
    collection: p.collection,
    description: p.description,
    price: p.price,
    compare_at_price: p.compareAt,
    // The currency the page published, not the one configured on the source. A house that
    // sells in nine markets publishes nine prices for the same ring, and storing a dollar
    // figure as euros overstates the value covered by whatever the pair is worth that week.
    price_currency: p.currency || store.currency,
    available: p.available,
    image_url: p.imageUrl,
    product_url: p.productUrl ?? `${store.base}/products/${p.handle}`,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin
      .from("storefront_products")
      .upsert(rows.slice(i, i + 200), { onConflict: "brand_id,handle", ignoreDuplicates: false });
    if (error) throw new Error(`upsert: ${error.message}`);
  }

  // 2. Which rows need an image embedding (missing, or image changed)?
  // PAGINATE. PostgREST caps an unbounded select at 1000 rows, and Luisa
  // Beccaria has 1013 products: the last 13 were invisible to this check, so
  // they looked permanently unembedded, were retried on every single run, and
  // kept `remaining` above zero forever. Harmless when the sync was fire-and-
  // forget; with a stage that re-queues until remaining hits zero, it would
  // loop for good.
  const cur: { id: number; handle: string; image_url: string | null; image_embedding: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: curErr } = await admin
      .from("storefront_products")
      .select("id, handle, image_url, image_embedding")
      .eq("brand_id", brandId)
      .order("id")
      .range(from, from + 999);
    if (curErr) throw new Error(`select: ${curErr.message}`);
    if (!page?.length) break;
    cur.push(...(page as typeof cur));
    if (page.length < 1000) break;
  }
  const byHandle = new Map<string, string | null>(); // handle -> current image_url used for embedding
  const hasEmbedding = new Set<string>();
  for (const r of (cur ?? []) as { handle: string; image_url: string | null; image_embedding: unknown }[]) {
    byHandle.set(r.handle, r.image_url);
    if (r.image_embedding != null) hasEmbedding.add(r.handle);
  }
  const idByHandle = new Map<string, number>();
  for (const r of (cur ?? []) as { id: number; handle: string }[]) idByHandle.set(r.handle, r.id);

  // 3. Sizes. Per-variant price and availability, kept whole: a sold-out 38
  // beside an available 40 is precisely what the associate needs to see, and
  // the product-level `available` flattens it away.
  //
  // Mark and sweep — everything seen this run carries runStart, then anything
  // older for this brand is a variant the shop has removed. Shopify path only:
  // the structured reader sees a slice of the site per run and a sweep would
  // delete every variant it didn't happen to visit.
  let variantsUpserted = 0;
  if (!structured) {
    const vRows = products.flatMap((p) => {
      const productId = idByHandle.get(p.handle);
      if (!productId) return [];
      return (p.variants ?? []).map((v) => ({
        brand_id: brandId,
        product_id: productId,
        variant_id: v.variantId,
        title: v.title,
        option_name: p.optionName ?? null,
        sku: v.sku,
        price: v.price,
        compare_at_price: v.compareAt,
        available: v.available,
        position: v.position,
        updated_at: runStart,
      }));
    });
    for (let i = 0; i < vRows.length; i += 500) {
      const { error } = await admin
        .from("storefront_variants")
        .upsert(vRows.slice(i, i + 500), { onConflict: "product_id,title", ignoreDuplicates: false });
      if (error) throw new Error(`variant upsert: ${error.message}`);
    }
    variantsUpserted = vRows.length;
    const { error: sweepErr } = await admin
      .from("storefront_variants")
      .delete().eq("brand_id", brandId).lt("updated_at", runStart);
    if (sweepErr) throw new Error(`variant sweep: ${sweepErr.message}`);
  }

  const todo = products.filter((p) => p.imageUrl && !hasEmbedding.has(p.handle));
  const remainingBefore = todo.length;
  const slice = todo.slice(0, maxEmbed);

  let embedded = 0;
  let lastEmbedError: string | null = null;
  for (let i = 0; i < slice.length; i += EMBED_BATCH) {
    const batch = slice.slice(i, i + EMBED_BATCH);
    let embs: number[][];
    try {
      embs = await voyageEmbedImages(batch.map((b) => b.imageUrl!));
    } catch (e) {
      // Fall back to one at a time, but REMEMBER why it failed. Swallowing this
      // is how 223 products sat unembedded while the run reported success with
      // "embedded: 0" and no error to chase.
      lastEmbedError = e instanceof Error ? e.message : String(e);
      embs = [];
      for (const b of batch) {
        try { embs.push((await voyageEmbedImages([b.imageUrl!]))[0]); }
        catch (inner) {
          lastEmbedError = inner instanceof Error ? inner.message : String(inner);
          embs.push([]);
        }
      }
    }
    await Promise.all(batch.map(async (b, j) => {
      const emb = embs[j];
      if (Array.isArray(emb) && emb.length === EMBED_DIMS) {
        const id = idByHandle.get(b.handle);
        if (id) {
          const { error } = await admin.from("storefront_products")
            .update({ image_embedding: emb }).eq("id", id);
          if (!error) embedded++;
        }
      }
    }));
  }

  const remaining = Math.max(0, remainingBefore - embedded);
  return {
    brand_id: brandId, products: products.length, upserted: rows.length,
    variants: variantsUpserted,
    embedded, remaining,
    // Pages of the site still to read. Separate from `remaining`, which counts images left
    // to embed: a run can have embedded everything it fetched and still have most of the
    // catalogue ahead of it.
    ...(structured
      ? {
        pages_read: structured.pagesRead, pages_remaining: structured.pagesRemaining,
        pages_done: structured.pagesDone, pages_total: structured.pagesTotal,
      }
      : {}),
    done: remaining === 0 && (structured ? structured.pagesRemaining === 0 : true),
    // Present only when something went wrong, so a run that embeds nothing says
    // why instead of looking like there was nothing to do.
    ...(lastEmbedError && embedded < slice.length ? { embed_error: lastEmbedError.slice(0, 300) } : {}),
  };
}

type SProduct = {
  productUrl?: string | null;
  handle: string; sku: string | null; name: string; category: string | null;
  collection: string | null; description: string | null; price: number | null;
  compareAt: number | null; available: boolean; imageUrl: string | null;
  // What the PAGE said the price was in. Only the structured path knows it; the Shopify
  // feed is single-currency and the source row carries that.
  currency?: string | null;
  // Only the Shopify feed carries these; the structured path leaves them empty.
  optionName?: string | null;
  variants?: FeedVariant[];
};

/**
 * One page's HTML, the cheap way first.
 *
 * This used to go straight to the renderer whenever a JINA key was configured, and never
 * try anything else. It is the right order for Ferragamo, which 403s a plain fetch — and it
 * is why Pomellato reported "0 products so far" run after run over a catalogue that a plain
 * `fetch` hands over on the first try: the renderer returns nothing usable for that site,
 * and nothing behind it ever looked. A page a cheap request can read should never cost a
 * render, and a house should never be recorded as having no catalogue because one fetch
 * strategy failed.
 *
 * A raw read is only trusted when the site answers 2xx AND keeps us in the locale we asked
 * for. These sites geo-redirect: ask for /at_de and be sent to /gb_en, and the prices come
 * back in a different currency for a row keyed on a locale-independent handle.
 */
async function readPage(url: string): Promise<string> {
  let raw = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    // An error page is not a product page. Pomellato's /404 publishes og:image and a title,
    // which the extractor's OpenGraph fallback read as a product called
    // "Pomellato Online-Boutique | Schmuck — Ringe, Ohrringe…".
    if (res.ok) {
      const body = await res.text();
      if (localeOf(res.url) === localeOf(url)) raw = body;
    }
  } catch { /* fall through to the renderer */ }

  if (raw && extractProducts(raw, url).length > 0) return raw;
  if (!JINA_API_KEY) return raw;
  try {
    return await jinaHtml(url);
  } catch {
    return raw;
  }
}

// Read the catalogue out of the pages the crawler has already visited.
//
// The crawl queue is the list of the site's own URLs, so there is no second
// discovery pass: fetch each page (through the renderer, because the houses that
// need this are the ones that block plain fetches) and read the schema.org
// Product data it publishes. A single category page routinely carries sixty
// products, so this converges in a handful of fetches rather than one per item.
async function fetchStructured(
  admin: ReturnType<typeof createClient>, brandId: number, base: string, cursor: number,
): Promise<{
  products: SProduct[]; pagesRead: number; pagesRemaining: number;
  pagesDone: number; pagesTotal: number;
}> {
  // Discovered, not fetched: the reader reads these pages itself, and waiting for the
  // knowledge crawl to reach page 300 of 520 before the catalogue can be read is hours of
  // nothing. See the same change in onboard-brand's detectStructured.
  const { data: queued } = await admin.from("knowledge_crawl_queue")
    .select("url").eq("brand_id", brandId).limit(400);

  // Deterministic order, because the cursor indexes into it. Sorting by score alone leaves
  // ties in whatever order PostgREST returned them, and a list that reshuffles between runs
  // makes a cursor meaningless.
  const ranked = rankCatalogueUrls([base, ...((queued ?? []) as { url: string }[]).map((r) => r.url)]);

  // One locale, so the catalogue is priced in one currency. Ferragamo's 135 products were
  // all read off /shop/us/en — dollar prices, stored as euros, straight into the demo book
  // and the value covered.
  const locale = preferredLocale(ranked);
  const urls = inLocale(ranked, locale);

  // A BATCH, from where the last run stopped. Rendering the whole list in one call is what
  // killed the worker: a luxury listing page takes ten to forty seconds, and the onboarding
  // stage waits on this call.
  const from = cursor >= urls.length ? 0 : cursor;
  const window = urls.slice(from, from + STRUCTURED_MAX_PAGES);

  // Render the window CONCURRENTLY. One page takes three or four seconds, so five of them
  // read in sequence used sixteen seconds of the seventy the stage is given and handed the
  // rest back — a hundred-and-thirty-page site therefore took half an hour of once-a-minute
  // ticks to read, and for most of that half hour the panel had nothing to show but a clock.
  // A few at a time fills the budget instead of the minute.
  const html: string[] = [];
  for (let i = 0; i < window.length; i += STRUCTURED_CONCURRENCY) {
    html.push(...await Promise.all(window.slice(i, i + STRUCTURED_CONCURRENCY).map(readPage)));
  }

  const seen = new Set<string>();
  const out: SProduct[] = [];
  let fetched = 0;

  for (let i = 0; i < window.length; i++) {
    // Leave the rest of the window for the next run rather than advancing the cursor past
    // pages nothing was read out of.
    if (out.length >= STRUCTURED_MAX_PRODUCTS) break;
    const url = window[i];
    fetched++;

    for (const p of extractProducts(html[i], url)) {
      const key = (p.product_url ?? p.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        // handle is the upsert key, and these sites have no Shopify handle — the
        // product URL's last segment is the stable per-product identifier.
        handle: handleFrom(p.product_url, p.name),
        sku: p.sku, name: p.name, category: p.category, collection: null,
        description: null, price: p.price, compareAt: null,
        available: p.available ?? true, imageUrl: p.image_url,
        productUrl: p.product_url, currency: p.price_currency,
      } as SProduct);
    }
  }

  // Wrap at the end rather than stopping: a catalogue read once still changes, and a cursor
  // parked past the last URL would never look at the site again.
  const next = from + fetched;
  const wrapped = next >= urls.length ? 0 : next;
  await admin.from("storefront_sources")
    .update({ structured_cursor: wrapped }).eq("brand_id", brandId);

  return {
    products: out, pagesRead: fetched,
    pagesRemaining: Math.max(0, urls.length - next),
    // Where this pass has got to, for a screen that would otherwise have to say either
    // "waiting" or nothing at all for the twenty minutes a full read takes.
    pagesDone: Math.min(next, urls.length), pagesTotal: urls.length,
  };
}

// Small enough that a run of them finishes inside one worker — but read a few at a time
// (below), so the limit is the stage's time budget rather than one renderer call after
// another.
const STRUCTURED_MAX_PAGES = 12;
const STRUCTURED_CONCURRENCY = 4;
const STRUCTURED_MAX_PRODUCTS = 600;



function handleFrom(productUrl: string | null, name: string): string {
  const fromUrl = productUrl
    ? decodeURIComponent(new URL(productUrl).pathname).split("/").filter(Boolean).pop() ?? ""
    : "";
  const base = fromUrl || name;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "item";
}

// The renderer returns rendered HTML rather than markdown, because the structured
// data lives in <script> tags that a markdown conversion throws away.
async function jinaHtml(url: string): Promise<string> {
  const res = await fetch("https://r.jina.ai/" + url, {
    headers: {
      "Authorization": `Bearer ${JINA_API_KEY}`,
      "X-Return-Format": "html",
      "Accept": "text/plain",
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`jina HTTP ${res.status}`);
  return await res.text();
}

/**
 * A product feed, read whole.
 *
 * One request against a file the house maintains for Google anyway. No pagination, no
 * cursor, no renderer: this is the cheapest and most current catalogue there is, and the
 * only one that stays right without us doing anything.
 */
async function fetchFeed(url: string, fallbackCurrency: string): Promise<SProduct[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/xml,text/xml,text/csv,text/plain,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const text = await res.text();
  return parseProductFeed(text).map((p) => ({
    productUrl: p.productUrl,
    handle: p.handle,
    sku: p.sku,
    name: p.name,
    category: p.category,
    collection: null,
    description: p.description,
    price: p.price,
    compareAt: null,
    available: p.available,
    imageUrl: p.imageUrl,
    // What the feed said, not what the source was configured with — a feed states its own
    // currency per row and a house publishes one per market.
    currency: p.currency ?? fallbackCurrency,
  }));
}

async function fetchStorefront(base: string, keepUntyped = false): Promise<SProduct[]> {
  const raw: RawShopifyProduct[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${base}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`storefront ${res.status} on page ${page}`);
    const products = (await res.json())?.products ?? [];
    if (!products.length) break;
    raw.push(...(products as RawShopifyProduct[]));
  }
  // The mapping lives in _shared/shopify-feed.ts so it can be tested against a
  // recorded feed without fetching anything.
  return mapShopifyProducts(raw, keepUntyped);
}

// Ask the CDN for a display-sized image before handing it to Voyage.
//
// Product photography is shipped at full resolution — Pasquale Bruni's PNGs run
// to 6.6MB each. Eight of those in one multimodal request blows the payload
// limit, the batch fails, the per-image retry fails too, and 223 products end up
// with no visual-search embedding at all. A 1024px render is far more than the
// model needs and cuts the payload by an order of magnitude. The stored
// image_url is untouched — this only affects what we send for embedding.
function embeddableUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)shopify\.com$/.test(u.hostname) && !u.hostname.includes("cdn.shopify")) return url;
    u.searchParams.set("width", "1024");
    return u.toString();
  } catch { return url; }
}

async function voyageEmbedImages(urls: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: urls.map((u) => ({ content: [{ type: "image_url", image_url: embeddableUrl(u) }] })),
      model: EMBED_MODEL, input_type: "document", output_dimension: EMBED_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`Voyage multimodal ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = ((await res.json())?.data ?? []) as { embedding?: number[]; index?: number }[];
  const out: number[][] = urls.map(() => []);
  data.forEach((d, i) => {
    const idx = Number.isInteger(d.index) ? (d.index as number) : i;
    if (Array.isArray(d.embedding)) out[idx] = d.embedding;
  });
  return out;
}

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.role === "string" ? json.role : null;
  } catch { return null; }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}
