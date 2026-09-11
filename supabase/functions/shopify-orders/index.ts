// shopify-orders: connect a brand's Shopify Admin API and pull its orders.
//
// The catalogue we already read from the PUBLIC feed — no credentials. This is
// the other half: orders and the customers behind them, which need a token the
// house creates for us (a custom app, scopes read_orders + read_customers).
//
// Written before we had any Shopify account, so the shape of it is deliberate:
//   • the transform lives in _shared/shopify-orders.ts and is unit-tested
//     against a fixture, because that part needs no shop;
//   • everything that DOES need a shop — the token, the scopes, pagination,
//     rate limits — happens here, behind a connection that starts disabled and
//     will not sync until someone has run `test` and switched it on;
//   • `dry_run` fetches and transforms but writes nothing, so the first run
//     against a real shop can be read before it is trusted.
//
// Auth: an AION admin, the service role, or x-batch-secret (a future cron).
// Body: { action: "test" | "sync" | "disconnect", brand_id, shop_domain?,
//         token?, orders_since?, dry_run?, max_pages? }

import { createClient } from "npm:@supabase/supabase-js@2";
import { mapOrder, nextPageInfo, missingScopes, type AdminOrder } from "../_shared/shopify-orders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";

const DEFAULT_API_VERSION = "2025-07";
const PAGE_SIZE = 250;
const MAX_PAGES_PER_RUN = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}
function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null;
  } catch { return null; }
}

// "house.myshopify.com" — accept a pasted URL or a bare handle and normalise.
// Anything else is refused rather than guessed at: a typo here is a request to
// somebody else's shop.
function normaliseShopDomain(input: string): string | null {
  const raw = (input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw)) return raw;
  if (/^[a-z0-9][a-z0-9-]*$/.test(raw)) return `${raw}.myshopify.com`;
  return null;
}

type Conn = {
  brand_id: number; shop_domain: string; api_version: string; token_secret_name: string | null;
  status: string; enabled: boolean; orders_since: string | null; next_cursor: string | null;
  last_sync_at: string | null; orders_synced: number;
};

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function shopifyGet(
  shop: string, apiVersion: string, token: string, path: string, params: Record<string, string> = {},
): Promise<{ status: number; body: unknown; link: string | null; retryAfter: number | null }> {
  const url = new URL(`https://${shop}/admin/api/${apiVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "X-Shopify-Access-Token": token, "Accept": "application/json" },
  });
  const retryAfter = res.headers.get("Retry-After");
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return {
    status: res.status,
    body,
    link: res.headers.get("Link") ?? res.headers.get("link"),
    retryAfter: retryAfter ? Number(retryAfter) : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shopify's REST limit is a leaky bucket (2 calls/second on a standard plan).
// One retry on 429, honouring Retry-After, is enough for a paged read; a second
// 429 means something else is hammering the shop and we should stop rather than
// queue up behind it.
async function getWithRetry(
  shop: string, apiVersion: string, token: string, path: string, params: Record<string, string>,
) {
  let res = await shopifyGet(shop, apiVersion, token, path, params);
  if (res.status === 429) {
    await sleep(Math.max(1, res.retryAfter ?? 2) * 1000);
    res = await shopifyGet(shop, apiVersion, token, path, params);
  }
  return res;
}

function apiError(status: number, body: unknown): string {
  const msg = (body as { errors?: unknown })?.errors;
  const asText = typeof msg === "string" ? msg : msg ? JSON.stringify(msg) : "";
  if (status === 401) return "Shopify rejected the token (401). Check it was pasted whole and belongs to this shop.";
  if (status === 403) return `Shopify refused the call (403)${asText ? `: ${asText}` : ""}. Usually a missing scope.`;
  if (status === 404) return "Shopify has no such shop or endpoint (404). Check the shop domain.";
  return `Shopify ${status}${asText ? `: ${asText}` : ""}`;
}

// ── test: does this token work, and does it grant what we need? ──────────────
async function testConnection(brandId: number, shopDomain: string | null, token: string | null) {
  const { data: existing } = await admin
    .from("storefront_connections").select("*").eq("brand_id", brandId).maybeSingle();

  const shop = shopDomain ? normaliseShopDomain(shopDomain) : (existing as Conn | null)?.shop_domain ?? null;
  if (!shop) return jsonError("a shop domain like house.myshopify.com is required", 400);
  const apiVersion = (existing as Conn | null)?.api_version ?? DEFAULT_API_VERSION;

  // The row has to exist before the token can be attached to it.
  const { error: upErr } = await admin.from("storefront_connections").upsert({
    brand_id: brandId, shop_domain: shop, api_version: apiVersion,
    status: "untested", updated_at: new Date().toISOString(),
  }, { onConflict: "brand_id" });
  if (upErr) return jsonError(`could not save the connection: ${upErr.message}`, 500);

  if (token) {
    const { error } = await admin.rpc("shopify_set_token", { p_brand_id: brandId, p_token: token });
    if (error) return jsonError(`could not store the token: ${error.message}`, 500);
  }
  const { data: secret } = await admin.rpc("shopify_get_token", { p_brand_id: brandId });
  const live = typeof secret === "string" ? secret : "";
  if (!live) return jsonError("no token stored for this brand yet", 400);

  const fail = async (message: string) => {
    await admin.from("storefront_connections").update({
      status: "error", last_error: message.slice(0, 500), last_test_at: new Date().toISOString(),
      enabled: false, updated_at: new Date().toISOString(),
    }).eq("brand_id", brandId);
    return json({ ok: false, shop_domain: shop, error: message });
  };

  const shopRes = await getWithRetry(shop, apiVersion, live, "shop.json", {});
  if (shopRes.status !== 200) return await fail(apiError(shopRes.status, shopRes.body));

  // Scopes live on their own endpoint, and asking beats discovering a missing
  // one halfway through a sync as an unexplained 403.
  const scopeRes = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": live, "Accept": "application/json" },
  });
  const scopeBody = await scopeRes.json().catch(() => null) as { access_scopes?: { handle?: string }[] } | null;
  const granted = (scopeBody?.access_scopes ?? []).map((s) => String(s.handle ?? "")).filter(Boolean);
  const missing = missingScopes(granted);
  const shopName = ((shopRes.body as { shop?: { name?: string } })?.shop?.name) ?? null;

  await admin.from("storefront_connections").update({
    status: missing.length ? "error" : "ok",
    scopes: granted, missing_scopes: missing,
    last_error: missing.length ? `token is missing: ${missing.join(", ")}` : null,
    last_test_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("brand_id", brandId);

  return json({
    ok: missing.length === 0, shop_domain: shop, shop_name: shopName,
    scopes: granted, missing_scopes: missing,
    note: missing.length
      ? `The token works but is missing ${missing.join(" and ")}. Add the scope in the shop's custom app and test again.`
      : "Connected. Switch the sync on to start pulling orders.",
  });
}

// ── sync: pull orders, page by page ─────────────────────────────────────────
async function syncOrders(brandId: number, opts: { dryRun: boolean; maxPages: number; since?: string | null }) {
  const { data: row } = await admin
    .from("storefront_connections").select("*").eq("brand_id", brandId).maybeSingle();
  const conn = row as Conn | null;
  if (!conn) return jsonError("this brand has no Shopify connection", 400);
  if (conn.status !== "ok") return jsonError(`connection is ${conn.status}; run a test first`, 409);
  // A dry run is how you look before switching on, so it does not need the switch.
  if (!conn.enabled && !opts.dryRun) return jsonError("the sync is switched off for this brand", 409);

  const { data: secret } = await admin.rpc("shopify_get_token", { p_brand_id: brandId });
  const token = typeof secret === "string" ? secret : "";
  if (!token) return jsonError("no token stored for this brand", 400);

  // Where to start: an explicit date, then the stored floor, then the last
  // successful sync. Without any of those we'd pull the shop's whole history on
  // a first run, which is both slow and rarely what anyone wants.
  const since = opts.since ?? conn.orders_since ?? conn.last_sync_at ?? null;

  let cursor = conn.next_cursor;
  let pages = 0, fetched = 0, written = 0, matched = 0;
  const sample: { order_number: string | null; placed_at: string | null; total: number | null; email: string | null }[] = [];

  while (pages < opts.maxPages) {
    // A cursor carries its own filters: Shopify rejects page_info sent together
    // with status/updated_at_min, so the first call sets the filters and every
    // later one sends the cursor alone.
    const params = cursor
      ? { limit: String(PAGE_SIZE), page_info: cursor }
      : {
        limit: String(PAGE_SIZE),
        status: "any",
        ...(since ? { updated_at_min: new Date(since).toISOString() } : {}),
      };
    const res = await getWithRetry(conn.shop_domain, conn.api_version, token, "orders.json", params);
    if (res.status !== 200) {
      const message = apiError(res.status, res.body);
      await admin.from("storefront_connections").update({
        status: "error", last_error: message.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("brand_id", brandId);
      return jsonError(message, 502);
    }
    const orders = ((res.body as { orders?: AdminOrder[] })?.orders ?? []);
    pages++;
    fetched += orders.length;

    for (const o of orders) {
      const { order, items } = mapOrder(o, brandId);
      if (sample.length < 5) {
        sample.push({ order_number: order.order_number, placed_at: order.placed_at, total: order.total, email: order.customer_email });
      }
      if (opts.dryRun) continue;

      // Match the shopper to an AION client by email. Deliberately email-only:
      // a name match would silently merge two clients, and that is a far worse
      // outcome than an order that stays unattributed until someone links it.
      let profileId: string | null = null;
      if (order.customer_email) {
        const { data: p } = await admin
          .from("profiles").select("id")
          .eq("brand_id", brandId).ilike("email", order.customer_email)
          .limit(1).maybeSingle();
        profileId = (p?.id as string) ?? null;
      }
      if (profileId) matched++;

      const { data: saved, error: oErr } = await admin
        .from("storefront_orders")
        .upsert({
          ...order, profile_id: profileId, matched_by: profileId ? "email" : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "brand_id,shopify_order_id" })
        .select("id").single();
      if (oErr) throw new Error(`order ${order.shopify_order_id}: ${oErr.message}`);
      written++;

      if (items.length) {
        const lines = items.map((i) => ({ ...i, order_id: saved!.id as number }));
        const { error: iErr } = await admin
          .from("storefront_order_items")
          .upsert(lines, { onConflict: "order_id,shopify_line_id" });
        if (iErr) throw new Error(`order ${order.shopify_order_id} lines: ${iErr.message}`);
      }
    }

    cursor = nextPageInfo(res.link);
    if (!cursor) break;
    // Stay well inside the leaky bucket on a long backfill.
    await sleep(600);
  }

  if (!opts.dryRun) {
    await admin.from("storefront_connections").update({
      last_sync_at: new Date().toISOString(),
      next_cursor: cursor,               // null = caught up; a value = resume here
      orders_synced: (conn.orders_synced ?? 0) + written,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("brand_id", brandId);
  }

  return json({
    dry_run: opts.dryRun, pages, fetched, written, matched_to_clients: matched,
    more: Boolean(cursor),
    since: since ?? null,
    sample,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError("POST only", 405);

  const batchSecret = req.headers.get("x-batch-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const isBatch = KNOWLEDGE_BATCH_SECRET.length > 0 && batchSecret === KNOWLEDGE_BATCH_SECRET;
  const isServiceRole = bearer !== "" && (bearer === SUPABASE_SERVICE_ROLE_KEY || jwtRole(bearer) === "service_role");
  if (!isBatch && !isServiceRole) {
    if (!bearer) return jsonError("missing bearer token", 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonError("invalid session", 401);
    const { data: adminRow } = await userClient
      .from("admins").select("id").eq("user_id", user.id).maybeSingle();
    // Connecting a shop is AION's job: the credential comes from the house over
    // a call, and a brand user must never be able to point this at another shop.
    if (!adminRow) return jsonError("admin required", 403);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const brandId = Number(body.brand_id ?? 0) || null;
  const action = String(body.action ?? "").trim();
  if (!brandId) return jsonError("brand_id is required", 400);

  try {
    if (action === "test") {
      return await testConnection(brandId, body.shop_domain ? String(body.shop_domain) : null,
        body.token ? String(body.token) : null);
    }
    if (action === "sync") {
      return await syncOrders(brandId, {
        dryRun: Boolean(body.dry_run),
        maxPages: Math.min(Number(body.max_pages ?? MAX_PAGES_PER_RUN) || MAX_PAGES_PER_RUN, MAX_PAGES_PER_RUN),
        since: body.orders_since ? String(body.orders_since) : null,
      });
    }
    if (action === "disconnect") {
      const { error } = await admin.rpc("shopify_clear_token", { p_brand_id: brandId });
      if (error) return jsonError(error.message, 500);
      return json({ ok: true, note: "Token deleted and the sync switched off. Orders already pulled are kept." });
    }
    return jsonError('action must be "test", "sync" or "disconnect"', 400);
  } catch (err) {
    console.error("[shopify-orders]", err);
    return jsonError(err instanceof Error ? err.message : "internal error", 500);
  }
});
