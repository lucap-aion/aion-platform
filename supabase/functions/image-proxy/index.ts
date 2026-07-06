// image-proxy: fetch a product image and re-serve it with CORS headers, so the
// report PDF (html2canvas → jsPDF) can embed images from feeds that don't send
// Access-Control-Allow-Origin (e.g. the legacy x-tra.it catalogue feed).
//
// Public (deploy --no-verify-jwt) but locked to a small allowlist of known image
// hosts and to image/* responses, so it can't be used as an open proxy/SSRF.
//
// GET /image-proxy?url=<encoded image url>

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only these hosts (and subdomains) may be proxied.
const ALLOW = [/\.x-tra\.it$/i, /(^|\.)shopify\.com$/i, /(^|\.)shopifycdn\.com$/i, /\.robertocoin\.com$/i, /\.supabase\.co$/i];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return new Response("method not allowed", { status: 405, headers: CORS });

  const target = new URL(req.url).searchParams.get("url") ?? "";
  let u: URL;
  try { u = new URL(target); } catch { return bad("invalid url"); }
  if (u.protocol !== "https:") return bad("https only", 400);          // no http / internal schemes
  if (u.username || u.password) return bad("no credentials in url", 400);
  if (!ALLOW.some((re) => re.test(u.hostname))) return bad("host not allowed", 403);

  // redirect:"manual" — an allowlisted host must not be able to bounce us to an
  // internal address (SSRF). A 3xx is refused rather than followed.
  const upstream = await fetch(u.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (AION image proxy)" },
    redirect: "manual",
  }).catch(() => null);
  if (!upstream) return bad("upstream error", 502);
  if (upstream.status >= 300 && upstream.status < 400) return bad("redirect not allowed", 502);
  if (!upstream.ok) return bad(`upstream ${upstream.status}`, 502);

  const ct = upstream.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) return bad("not an image", 415);
  const len = Number(upstream.headers.get("content-length") ?? 0);
  if (len && len > 15_000_000) return bad("image too large", 413);     // 15 MB cap

  return new Response(upstream.body, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      ...CORS,
    },
  });
});

function bad(message: string, status = 400) {
  return new Response(message, { status, headers: CORS });
}
