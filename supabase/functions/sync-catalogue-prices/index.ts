// sync-catalogue-prices: pull live online prices from a brand's public Shopify
// storefront (/products.json exposes name, SKU and price) and match them onto
// catalogue items by exact SKU. Only exact SKU matches are trusted — for luxury
// jewelry a size-approximate price is worse than none, so unmatched items keep a
// null price ("not listed online / price on request").
//
// Auth: x-batch-secret (cron) / service-role / admin.
// Body: { brand_id? }  (defaults to every brand we have a storefront for)
// Returns: { results: [{ brand_id, matched, updated, cleared, site_skus }] }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Brand storefronts we can price from. Shopify stores expose /products.json.
const STOREFRONTS: Record<number, { base: string; currency: string }> = {
  2: { base: "https://www.robertocoin.com", currency: "EUR" }, // Roberto Coin
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Authorize: batch secret (cron) / service-role / signed-in admin.
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
  const brandIds = Object.keys(STOREFRONTS).map(Number).filter((b) => !only || b === only);

  try {
    const results = [];
    for (const brandId of brandIds) {
      results.push(await syncBrand(admin, brandId));
    }
    return json({ results });
  } catch (err) {
    console.error("[sync-catalogue-prices]", err);
    return jsonError(err instanceof Error ? err.message : "internal error", 500);
  }
});

async function syncBrand(admin: ReturnType<typeof createClient>, brandId: number) {
  const store = STOREFRONTS[brandId];
  const priceBySku = await fetchStorefrontPrices(store.base);

  // Match onto catalogue items by exact SKU, in one bulk update per item that
  // changed. Also clear a stale price if the item vanished from the store.
  const { data: catRows, error } = await admin
    .from("catalogues")
    .select("id, sku, price")
    .eq("brand_id", brandId)
    .not("sku", "is", null);
  if (error) throw new Error(`catalogues: ${error.message}`);

  const now = new Date().toISOString();
  let matched = 0, updated = 0, cleared = 0;
  const updates: { id: number; price: number | null; price_currency: string | null; price_source: string | null; price_updated_at: string }[] = [];

  for (const row of (catRows ?? []) as { id: number; sku: string; price: number | null }[]) {
    const hit = priceBySku.get(row.sku.trim());
    if (hit != null) {
      matched++;
      if (row.price == null || Number(row.price) !== hit) {
        updated++;
        updates.push({ id: row.id, price: hit, price_currency: store.currency, price_source: "website", price_updated_at: now });
      }
    } else if (row.price != null) {
      // Was priced from the site before but is gone now — clear it so we don't
      // quote a stale price.
      cleared++;
      updates.push({ id: row.id, price: null, price_currency: null, price_source: null, price_updated_at: now });
    }
  }

  // Apply updates in chunks.
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map((u) =>
      admin.from("catalogues").update({
        price: u.price, price_currency: u.price_currency,
        price_source: u.price_source, price_updated_at: u.price_updated_at,
      }).eq("id", u.id)
    ));
  }

  return { brand_id: brandId, site_skus: priceBySku.size, matched, updated, cleared };
}

// Page through a Shopify storefront's /products.json and return sku → price
// (numeric, store currency). Later pages stop when empty.
async function fetchStorefrontPrices(base: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${base}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0 (AION price sync)" },
    });
    if (!res.ok) throw new Error(`storefront ${res.status} on page ${page}`);
    const products = (await res.json())?.products ?? [];
    if (!products.length) break;
    for (const p of products as { variants?: { sku?: string; price?: string }[] }[]) {
      for (const v of p.variants ?? []) {
        const sku = (v.sku ?? "").trim();
        const price = Number(v.price);
        if (sku && Number.isFinite(price) && price > 0 && !out.has(sku)) out.set(sku, price);
      }
    }
  }
  return out;
}

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}
