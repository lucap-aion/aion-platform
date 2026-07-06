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
  if (u.protocol !== "https:" && u.protocol !== "http:") return bad("bad protocol");
  if (!ALLOW.some((re) => re.test(u.hostname))) return bad("host not allowed", 403);

  const upstream = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0 (AION image proxy)" } })
    .catch(() => null);
  if (!upstream || !upstream.ok) return bad(`upstream ${upstream?.status ?? "error"}`, 502);

  const ct = upstream.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) return bad("not an image", 415);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400",
      ...CORS,
    },
  });
});

function bad(message: string, status = 400) {
  return new Response(message, { status, headers: CORS });
}
