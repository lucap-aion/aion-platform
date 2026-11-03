// shopify-oauth: a brand connects its Shopify shop by installing AION's app.
//
// Three ways in, one function, because Shopify's redirect URL and app URL must
// be fixed addresses in the app's configuration:
//
//   POST { action: "start", shop, brand_id? }   (signed in: admin or brand master)
//     → { url } — the shop's own approval screen. The browser goes there.
//
//   GET ?shop=…&hmac=…&timestamp=…              (Shopify, when a merchant opens
//     a custom-distribution install link) → we look the shop up, check Shopify
//     signed the request, and send the browser on to the approval screen.
//
//   GET ?code=…&shop=…&state=…&hmac=…           (Shopify, after approval)
//     → exchange the code for an offline token, store it in Vault, create the
//     knowledge source, and send the person back to their Knowledge page.
//
//   POST { action: "set_app", brand_id, shop, client_id, client_secret }  (admin)
//     → the credentials of the app made for this house. Until AION has one
//     public app, each house gets a custom-distribution app of its own; see
//     20261103000002 for why.
//
// Deployed with verify_jwt = false: Shopify's redirects carry no Supabase
// session. The GETs are authorised by Shopify's HMAC and our signed state; the
// POSTs check the caller's session themselves.
//
// Why a brand master may start this when the token-paste path was admin-only:
// that path let whoever held a token point the sync at any shop. Here Shopify
// itself only lets someone who administers the shop approve the install — the
// approval screen is the proof of ownership the paste path never had.

import { createClient } from "npm:@supabase/supabase-js@2";
import { originAllowed, originRefused } from "../_shared/origin.ts";
import { isProduction } from "../_shared/environment.ts";
import { missingScopes } from "../_shared/shopify-orders.ts";
import {
  authorizeUrl, normaliseShopDomain, safeReturnTo, signState, verifyShopifyHmac, verifyState,
} from "../_shared/shopify-oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// A public app's credentials, once AION has one. A house with its own app
// overrides these through set_app.
const ENV_CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "";
const ENV_CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";
// Signs our state parameter. Derived from the service-role key so there is no
// new secret to forget on a deploy; it never leaves the server either way.
const STATE_SECRET = `shopify-oauth-state:${SUPABASE_SERVICE_ROLE_KEY}`;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/shopify-oauth`;
const APP_URL = Deno.env.get("APP_URL") ?? (isProduction() ? "https://app.aioncover.com" : "https://dev.app.aioncover.com");
const DEFAULT_API_VERSION = "2025-07";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
const jsonError = (message: string, status: number) => json({ error: message }, status);
const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

// What a merchant sees when something goes wrong before we know where to send
// them back to. Plain, because it is a dead end either way.
const page = (title: string, detail: string, status = 400) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.25rem">${title}</h1><p>${detail}</p></body>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** The app this brand installs: its own custom-distribution app, else the public one. */
async function appCredentials(brandId: number): Promise<{ clientId: string; clientSecret: string } | null> {
  const { data: conn } = await admin.from("storefront_connections").select("client_id").eq("brand_id", brandId).maybeSingle();
  if (conn?.client_id) {
    const { data: secret } = await admin.rpc("shopify_get_client_secret", { p_brand_id: brandId });
    if (typeof secret === "string" && secret) return { clientId: conn.client_id as string, clientSecret: secret };
  }
  if (ENV_CLIENT_ID && ENV_CLIENT_SECRET) return { clientId: ENV_CLIENT_ID, clientSecret: ENV_CLIENT_SECRET };
  return null;
}

// Where the master lands after Shopify's approval screen: the Integrations page they
// started from, which reads ?connected / ?connect_error and kicks off the first sync.
async function integrationsPath(brandId: number): Promise<string> {
  const { data } = await admin.from("brands").select("slug").eq("id", brandId).maybeSingle();
  return data?.slug ? `/${data.slug}/integrations` : "/";
}

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// ── POST: start / set_app ────────────────────────────────────────────────────
type Caller = { kind: "admin" } | { kind: "brand"; brandId: number; profileId: string };

async function resolveCaller(req: Request): Promise<Caller | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("missing bearer token", 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return jsonError("invalid session", 401);
  const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
  if (adminRow) return { kind: "admin" };
  const { data: p } = await userClient
    .from("profiles").select("id, brand_id, role, is_master")
    .eq("user_id", user.id).in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
  if (!p?.brand_id) return jsonError("admin or brand role required", 403);
  if (!(p.role === "brand_admin" || p.is_master)) return jsonError("insufficient permissions", 403);
  return { kind: "brand", brandId: p.brand_id as number, profileId: p.id as string };
}

async function start(req: Request, caller: Caller, body: Record<string, unknown>) {
  const brandId = caller.kind === "brand" ? caller.brandId : Number(body.brand_id ?? 0) || null;
  if (!brandId) return jsonError("brand_id is required", 400);
  const shop = normaliseShopDomain(String(body.shop ?? ""));
  if (!shop) return jsonError("Enter the shop's myshopify address, like house.myshopify.com.", 400);

  const app = await appCredentials(brandId);
  if (!app) {
    return jsonError("AION hasn't set up the Shopify app for this house yet. Ask your AION contact — it takes a few minutes.", 409);
  }
  // A house's own app is made for ONE shop. Starting it against another shop
  // would end on Shopify's "this app can't be installed" page; say so here.
  const { data: conn } = await admin.from("storefront_connections").select("shop_domain, client_id").eq("brand_id", brandId).maybeSingle();
  if (conn?.client_id && conn.shop_domain && conn.shop_domain !== shop) {
    return jsonError(`This house's Shopify app is set up for ${conn.shop_domain}, not ${shop}.`, 409);
  }

  const origin = req.headers.get("Origin") ?? req.headers.get("origin");
  const returnTo = safeReturnTo(origin, await integrationsPath(brandId)) ?? `${APP_URL}${await integrationsPath(brandId)}`;
  const state = await signState({
    brand_id: brandId, shop, return_to: returnTo, profile_id: caller.kind === "brand" ? caller.profileId : null,
  }, STATE_SECRET);
  return json({ url: authorizeUrl(shop, app.clientId, REDIRECT_URI, state) });
}

async function setApp(body: Record<string, unknown>) {
  const brandId = Number(body.brand_id ?? 0) || null;
  const shop = normaliseShopDomain(String(body.shop ?? ""));
  const clientId = String(body.client_id ?? "").trim();
  const clientSecret = String(body.client_secret ?? "").trim();
  if (!brandId || !shop || !clientId) return jsonError("brand_id, shop and client_id are required", 400);

  const { data: existing } = await admin.from("storefront_connections").select("brand_id").eq("brand_id", brandId).maybeSingle();
  const { error } = existing
    ? await admin.from("storefront_connections").update({ shop_domain: shop, client_id: clientId, updated_at: new Date().toISOString() }).eq("brand_id", brandId)
    : await admin.from("storefront_connections").insert({ brand_id: brandId, shop_domain: shop, client_id: clientId, api_version: DEFAULT_API_VERSION });
  if (error) return jsonError(`could not save: ${error.message}`, 500);
  if (clientSecret) {
    const { error: sErr } = await admin.rpc("shopify_set_client_secret", { p_brand_id: brandId, p_secret: clientSecret });
    if (sErr) return jsonError(`could not store the secret: ${sErr.message}`, 500);
  }
  return json({
    ok: true,
    // What to paste into the app's configuration in the Shopify Dev Dashboard.
    app_url: REDIRECT_URI,
    redirect_url: REDIRECT_URI,
  });
}

// ── GET: Shopify's install launch ────────────────────────────────────────────
async function installLaunch(params: URLSearchParams) {
  const shop = normaliseShopDomain(params.get("shop") ?? "");
  if (!shop) return page("Unknown shop", "This link didn't come with a valid Shopify shop.");
  const { data: conn } = await admin.from("storefront_connections").select("brand_id").eq("shop_domain", shop).limit(1).maybeSingle();
  if (!conn) {
    return page("Not set up yet", `AION doesn't have ${escapeHtml(shop)} on file yet. Please ask your AION contact to finish the set-up, then open the link again.`, 404);
  }
  const brandId = conn.brand_id as number;
  const app = await appCredentials(brandId);
  if (!app || !(await verifyShopifyHmac(params, app.clientSecret))) {
    return page("Couldn't verify this request", "It didn't carry a valid Shopify signature. Open the install link again from the email you were sent.", 401);
  }
  const state = await signState({
    brand_id: brandId, shop, return_to: `${APP_URL}${await integrationsPath(brandId)}`, profile_id: null,
  }, STATE_SECRET);
  return redirect(authorizeUrl(shop, app.clientId, REDIRECT_URI, state));
}

// ── GET: the callback ────────────────────────────────────────────────────────
async function callback(params: URLSearchParams) {
  const state = await verifyState(params.get("state") ?? "", STATE_SECRET);
  if (!state) return page("This link has expired", "Start the connection again from the Knowledge page in AION.");
  const back = (extra: Record<string, string>) => redirect(withParams(state.return_to, extra));

  const shop = normaliseShopDomain(params.get("shop") ?? "");
  // The code must come back for the shop we sent the person to.
  if (!shop || shop !== state.shop) return back({ connect_error: "Shopify answered for a different shop." });
  const app = await appCredentials(state.brand_id);
  if (!app || !(await verifyShopifyHmac(params, app.clientSecret))) {
    return back({ connect_error: "Couldn't verify Shopify's answer. Try connecting again." });
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code: params.get("code") }),
  });
  const tokenBody = await tokenRes.json().catch(() => null) as { access_token?: string; scope?: string } | null;
  if (!tokenRes.ok || !tokenBody?.access_token) {
    console.error("[shopify-oauth] token exchange", tokenRes.status);
    return back({ connect_error: `Shopify didn't issue a token (${tokenRes.status}). Try connecting again.` });
  }
  const granted = (tokenBody.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const missingForOrders = missingScopes(granted);

  // The row must exist before the token can be attached to it.
  const { data: existing } = await admin.from("storefront_connections").select("brand_id").eq("brand_id", state.brand_id).maybeSingle();
  const row = {
    shop_domain: shop, scopes: granted, missing_scopes: missingForOrders,
    status: missingForOrders.length ? "error" : "ok",
    last_error: missingForOrders.length ? `token is missing: ${missingForOrders.join(", ")}` : null,
    last_test_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    // The orders sync stays OFF: switching it on is still a decision someone
    // makes after a dry run, exactly as with a pasted token.
  };
  const { error: cErr } = existing
    ? await admin.from("storefront_connections").update(row).eq("brand_id", state.brand_id)
    : await admin.from("storefront_connections").insert({ ...row, brand_id: state.brand_id, api_version: DEFAULT_API_VERSION });
  if (cErr) return back({ connect_error: `Couldn't save the connection: ${cErr.message}` });

  const { error: tErr } = await admin.rpc("shopify_set_token", { p_brand_id: state.brand_id, p_token: tokenBody.access_token });
  if (tErr) return back({ connect_error: `Couldn't store the token: ${tErr.message}` });

  const { error: sErr } = await admin.from("knowledge_sources").upsert({
    brand_id: state.brand_id, kind: "shopify", target: shop, label: shop, enabled: true,
    status: "ok", last_error: null, next_sync_at: new Date().toISOString(), sync_started_at: null,
    created_by: state.profile_id,
  }, { onConflict: "brand_id,kind" });
  if (sErr) return back({ connect_error: `Connected, but couldn't start the sync: ${sErr.message}` });

  return back({ connected: "shopify" });
}

// ── Entry ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    try {
      if (params.get("code")) return await callback(params);
      if (params.get("shop") && params.get("hmac")) return await installLaunch(params);
      return page("Nothing to do here", "This address is used by Shopify when a shop connects to AION.");
    } catch (e) {
      console.error("[shopify-oauth GET]", e);
      return page("Something went wrong", "Please try connecting again from AION.", 500);
    }
  }

  if (req.method !== "POST") return jsonError("GET or POST only", 405);
  if (!originAllowed(req)) return originRefused();
  const caller = await resolveCaller(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "");
  try {
    if (action === "start") return await start(req, caller, body);
    if (action === "set_app") {
      if (caller.kind !== "admin") return jsonError("admin required", 403);
      return await setApp(body);
    }
    return jsonError('action must be "start" or "set_app"', 400);
  } catch (e) {
    console.error("[shopify-oauth]", e);
    return jsonError(e instanceof Error ? e.message : "internal error", 500);
  }
});
