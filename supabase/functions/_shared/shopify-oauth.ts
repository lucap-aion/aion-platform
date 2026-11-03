// Installing AION on a Shopify shop over OAuth.
//
// Until 2026 a merchant could create a "custom app" in their admin and paste
// us its Admin API token; the orders connector was built around that. Shopify
// stopped allowing new ones on 2026-01-01 (existing ones keep working). A shop
// now grants access by installing an app: the merchant approves our scopes on
// Shopify's own screen, Shopify sends us a one-time code, and we exchange it
// for an offline token. That token goes into the same Vault slot the pasted
// one did, so the orders sync and the knowledge sync both just work.
//
// Pure helpers only — signing, verifying, URLs — so they are unit-tested.

/** Everything AION reads, asked for once, so a single install serves every connector. */
export const OAUTH_SCOPES = [
  "read_content",        // pages + blog articles → knowledge
  "read_legal_policies", // refund / shipping / privacy policies → knowledge
  "read_products",       // catalogue, including what the public feed hides
  "read_orders",         // orders → client history (shopify-orders)
  "read_customers",      // the shopper behind each order
] as const;

/**
 * "house.myshopify.com" from a pasted URL or a bare handle. Anything else is
 * refused rather than guessed at: a typo here is a request to somebody else's
 * shop.
 */
export function normaliseShopDomain(input: string): string | null {
  const raw = (input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw)) return raw;
  if (/^[a-z0-9][a-z0-9-]*$/.test(raw)) return `${raw}.myshopify.com`;
  return null;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (s: string) =>
  btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time string comparison, so a forged signature can't be found byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Shopify signs every redirect it sends us: all query parameters except `hmac`
 * (and the legacy `signature`), sorted by name, joined as k=v with &, HMAC-SHA256
 * with the app's client secret, hex. Anything that fails this did not come from
 * Shopify — or came for a different app.
 */
export async function verifyShopifyHmac(params: URLSearchParams, clientSecret: string): Promise<boolean> {
  const given = params.get("hmac") ?? "";
  if (!given || !clientSecret) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(await hmacHex(clientSecret, message), given.toLowerCase());
}

/** What we need to remember across the round trip through Shopify. */
export type OAuthState = {
  brand_id: number;
  shop: string;
  /** Where to send the person back to: an origin we already allow, plus a path. */
  return_to: string;
  /** The profile that started it, for the audit trail; null for an admin. */
  profile_id: string | null;
  exp: number;
  nonce: string;
};

/**
 * The state parameter, signed. The callback is an unauthenticated GET from
 * the merchant's browser, so this signature is the only thing tying the code
 * Shopify sends back to the brand that asked for it. Without it, anyone could
 * finish an install into any brand's slot.
 */
export async function signState(state: Omit<OAuthState, "exp" | "nonce">, secret: string, ttlSeconds = 900): Promise<string> {
  const full: OAuthState = {
    ...state,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: crypto.randomUUID(),
  };
  const body = b64url(JSON.stringify(full));
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifyState(token: string, secret: string): Promise<OAuthState | null> {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig || !secret) return null;
  if (!safeEqual(await hmacHex(secret, body), sig)) return null;
  try {
    const s = JSON.parse(unb64url(body)) as OAuthState;
    if (!s.brand_id || !s.shop || typeof s.exp !== "number") return null;
    if (s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch { return null; }
}

export function authorizeUrl(shop: string, clientId: string, redirectUri: string, state: string): string {
  const u = new URL(`https://${shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("scope", OAUTH_SCOPES.join(","));
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  // No grant_options[]=per-user: we want an OFFLINE token, one that keeps
  // working when the person who clicked Install logs out or leaves the house.
  return u.toString();
}

/** Only send people back to our own app. */
export function safeReturnTo(origin: string | null, path: string | null): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    const ours = (u.protocol === "https:" && /(^|\.)aioncover\.com$/.test(u.hostname))
      || u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (!ours) return null;
    const p = (path ?? "/").startsWith("/") && !(path ?? "").startsWith("//") ? (path ?? "/") : "/";
    return `${u.origin}${p}`;
  } catch { return null; }
}
