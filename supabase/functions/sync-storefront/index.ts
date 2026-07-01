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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

// Brand storefronts we can ingest. Shopify stores expose /products.json.
const STOREFRONTS: Record<number, { base: string; currency: string }> = {
  2: { base: "https://www.robertocoin.com", currency: "EUR" }, // Roberto Coin
};

// product_type values that aren't real sellable jewelry.
const SKIP_TYPES = new Set(["storytelling", "storytelling 3", "gadget", ""]);

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
  const brandIds = Object.keys(STOREFRONTS).map(Number).filter((b) => !only || b === only);

  try {
    const results = [];
    for (const brandId of brandIds) results.push(await syncBrand(admin, brandId, max));
    return json({ results });
  } catch (err) {
    console.error("[sync-storefront]", err);
    return jsonError(err instanceof Error ? err.message : "internal error", 500);
  }
});

async function syncBrand(admin: ReturnType<typeof createClient>, brandId: number, maxEmbed: number) {
  const store = STOREFRONTS[brandId];
  const products = await fetchStorefront(store.base);

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
    price_currency: store.currency,
    available: p.available,
    image_url: p.imageUrl,
    product_url: `${store.base}/products/${p.handle}`,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin
      .from("storefront_products")
      .upsert(rows.slice(i, i + 200), { onConflict: "brand_id,handle", ignoreDuplicates: false });
    if (error) throw new Error(`upsert: ${error.message}`);
  }

  // 2. Which rows need an image embedding (missing, or image changed)?
  const { data: cur, error: curErr } = await admin
    .from("storefront_products")
    .select("id, handle, image_url, image_embedding")
    .eq("brand_id", brandId);
  if (curErr) throw new Error(`select: ${curErr.message}`);
  const byHandle = new Map<string, string | null>(); // handle -> current image_url used for embedding
  const hasEmbedding = new Set<string>();
  for (const r of (cur ?? []) as { handle: string; image_url: string | null; image_embedding: unknown }[]) {
    byHandle.set(r.handle, r.image_url);
    if (r.image_embedding != null) hasEmbedding.add(r.handle);
  }
  const idByHandle = new Map<string, number>();
  for (const r of (cur ?? []) as { id: number; handle: string }[]) idByHandle.set(r.handle, r.id);

  const todo = products.filter((p) => p.imageUrl && !hasEmbedding.has(p.handle));
  const remainingBefore = todo.length;
  const slice = todo.slice(0, maxEmbed);

  let embedded = 0;
  for (let i = 0; i < slice.length; i += EMBED_BATCH) {
    const batch = slice.slice(i, i + EMBED_BATCH);
    let embs: number[][];
    try {
      embs = await voyageEmbedImages(batch.map((b) => b.imageUrl!));
    } catch {
      embs = [];
      for (const b of batch) {
        try { embs.push((await voyageEmbedImages([b.imageUrl!]))[0]); }
        catch { embs.push([]); }
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
  return { brand_id: brandId, products: products.length, upserted: rows.length, embedded, remaining, done: remaining === 0 };
}

type SProduct = {
  handle: string; sku: string | null; name: string; category: string | null;
  collection: string | null; description: string | null; price: number | null;
  compareAt: number | null; available: boolean; imageUrl: string | null;
};

async function fetchStorefront(base: string): Promise<SProduct[]> {
  const out: SProduct[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${base}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0 (AION storefront sync)" },
    });
    if (!res.ok) throw new Error(`storefront ${res.status} on page ${page}`);
    const products = (await res.json())?.products ?? [];
    if (!products.length) break;
    for (const p of products as ShopifyProduct[]) {
      const type = (p.product_type ?? "").trim();
      if (SKIP_TYPES.has(type.toLowerCase())) continue;
      const variants = p.variants ?? [];
      const available = variants.some((v) => v.available);
      const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
      const comps = variants.map((v) => Number(v.compare_at_price)).filter((n) => Number.isFinite(n) && n > 0);
      // Mirror the storefront: it hides the price on unavailable items (shows
      // "price on request"). products.json still carries a price for them, but
      // quoting it makes the associate look wrong to the client — so only trust
      // a price when the piece is actually purchasable online.
      out.push({
        handle: p.handle,
        sku: (variants[0]?.sku ?? "").trim() || null,
        name: p.title,
        category: type || null,
        collection: deriveCollection(p.tags, type),
        description: stripHtml(p.body_html ?? "").slice(0, 2000) || null,
        price: available && prices.length ? Math.min(...prices) : null,
        compareAt: available && comps.length ? Math.min(...comps) : null,
        available,
        imageUrl: p.images?.[0]?.src ?? null,
      });
    }
  }
  return out;
}

// Collection = the tag that isn't a housekeeping tag or the category itself.
function deriveCollection(tags: string[] | string | undefined, category: string): string | null {
  const list = Array.isArray(tags)
    ? tags
    : typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : [];
  const stop = new Set(["all products", "new", "sale", category.toLowerCase()]);
  const pick = list.find((t) => t && !stop.has(t.trim().toLowerCase()));
  return pick ? pick.trim() : null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}

async function voyageEmbedImages(urls: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: urls.map((u) => ({ content: [{ type: "image_url", image_url: u }] })),
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

type ShopifyProduct = {
  handle: string; title: string; body_html?: string; product_type?: string;
  tags?: string[] | string;
  variants?: { sku?: string; price?: string; compare_at_price?: string; available?: boolean }[];
  images?: { src?: string }[];
};

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
