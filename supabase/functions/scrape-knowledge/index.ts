// scrape-knowledge: populate a brand's knowledge base from its PUBLIC website.
//
// Goal: retrieve as much publicly-available brand info as possible, including
// from JavaScript-rendered sites. It does NOT rely on visible HTML text alone:
//
//   URL discovery:
//     • robots.txt Sitemap: directives + /sitemap.xml /sitemap_index.xml
//       (recursively expands sitemap indexes, handles .xml and .xml.gz)
//     • homepage link crawl (same-origin, keyword-relevant)
//     • a set of common brand/policy/care paths probed directly
//   Content extraction per page (merged + de-duplicated):
//     • JSON-LD structured data (<script type=application/ld+json>)
//     • hydration state embedded in the HTML (__NEXT_DATA__, __NUXT__,
//       __APOLLO_STATE__, __INITIAL_STATE__, Next 13 streamed self.__next_f)
//     • <meta> description / og tags
//     • visible text
//   Optional render fallback: if SCRAPE_RENDER_URL is configured, pages that
//     still come back thin are re-fetched through that rendering service
//     (e.g. a headless-browser endpoint) and re-extracted.
//
// Pages are categorized (storytelling / product / policy / other), chunked,
// embedded with Voyage (batched), and stored. Honors robots.txt Disallow.
//
// Auth: brand user (pinned) / admin (brand_id) / batch (x-batch-secret header).
// Body: { brand_id?, base_url?, max_pages?, replace?, dry_run?, return_chunks? }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
// JS rendering backend for client-rendered SPAs. Default: Jina AI Reader
// (r.jina.ai) which renders the page and returns clean LLM-ready content.
// JINA_API_KEY is optional (lifts the free-tier rate limit). SCRAPE_RENDER_URL
// can override with a custom/self-hosted renderer that returns HTML.
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") ?? "";
const SCRAPE_RENDER_URL = Deno.env.get("SCRAPE_RENDER_URL") ?? "";
const RENDER_ENABLED = true; // Jina free tier needs no key, so rendering is always available

const EMBED_MODEL = "voyage-3.5";
const EMBED_DIMS = 1024;
const EMBED_BATCH = 128;
const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 150;

const DEFAULT_MAX_PAGES = 25;
const HARD_MAX_PAGES = 60;
const PER_PAGE_TIMEOUT_MS = 15_000;
const MAX_PAGE_CHARS = 16_000;
const MIN_PAGE_CHARS = 200;
const MAX_TOTAL_CHUNKS = 600;
const MAX_SITEMAP_FILES = 12;
const MAX_SITEMAP_URLS = 3000;
const STRING_MIN_LEN = 40;       // min length for a hydration/JSON-LD string to keep
// Crawler UA. Many SSR sites serve full pre-rendered HTML to bots (for SEO)
// but a client-rendered shell to browser UAs — so a bot UA yields MORE content
// on those. Genuinely client-only SPAs are handled by the Jina render path.
const UA = "Mozilla/5.0 (compatible; AIONKnowledgeBot/1.0; +https://aioncover.com/bot) Googlebot/2.1";

const COMMON_PATHS = [
  "/about", "/about-us", "/about-us/", "/our-story", "/our-history", "/heritage",
  "/the-house", "/maison", "/world", "/mondo", "/chi-siamo", "/la-maison",
  "/sustainability", "/sostenibilita", "/values", "/craftsmanship", "/savoir-faire",
  "/care", "/product-care", "/jewelry-care", "/watch-care", "/cura", "/manutenzione",
  "/returns", "/return-policy", "/resi", "/shipping", "/spedizioni", "/warranty",
  "/garanzia", "/faq", "/faqs", "/customer-service", "/customer-care", "/assistenza",
  "/contact", "/contatti", "/store-locator",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORY_RULES: { re: RegExp; category: string }[] = [
  { re: /(return|reso|resi|warranty|garanzia|guarantee|shipping|spedizion|faq|assistenza|customer-?(care|service)|client-?(care|service)|support|terms|legal|privacy|ethic|corporate)/i, category: "policy" },
  { re: /(about|stor(y|ia)|heritage|history|founder|fondat|maison|world|mondo|values|valori|sustainab|sostenib|chi-?siamo|the-?house|craft|savoir|la-maison|design|career)/i, category: "storytelling" },
  { re: /(product|collection|collezion|care|cura|manutenz|materials?|materiali|gioiell|jewel|watch|orolog|fragrance|leather|pelle|bag|shoe|ready-to-wear)/i, category: "product" },
];

const LINK_KEYWORDS =
  /(about|stor(y|ia)|heritage|history|founder|fondat|maison|world|mondo|values|valori|sustainab|sostenib|chi-?siamo|return|reso|resi|warranty|garanzia|shipping|spedizion|faq|assistenza|customer-?(care|service)|client-?(care|service)|support|care|cura|manutenz|collection|collezion|material|craft|savoir|the-?house|gioiell|jewel|watch|orolog|fragrance|leather|pelle|bag|product|ethic|corporate|design|career)/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("missing bearer token", 401);
  const token = authHeader.slice(7).trim();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let brandId: number | null = null;
  let createdBy: string | null = null;

  const batchSecret = req.headers.get("x-batch-secret") ?? "";
  const isBatch =
    (KNOWLEDGE_BATCH_SECRET !== "" && batchSecret === KNOWLEDGE_BATCH_SECRET) ||
    token === SUPABASE_SERVICE_ROLE_KEY;

  if (isBatch) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required in batch mode", 400);
  } else {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonError("invalid session", 401);
    const { data: adminRow } = await userClient
      .from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (adminRow) {
      brandId = Number(body.brand_id ?? 0) || null;
      if (!brandId) return jsonError("brand_id required for admin caller", 400);
    } else {
      const { data: profileRow } = await userClient
        .from("profiles").select("id, brand_id, role")
        .eq("user_id", user.id)
        .in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
      if (!profileRow?.brand_id) return jsonError("admin or brand role required", 403);
      brandId = profileRow.brand_id as number;
      createdBy = profileRow.id as string;
    }
  }

  let baseUrl = body.base_url ? String(body.base_url).trim() : "";
  if (!baseUrl) {
    const { data: brand } = await admin.from("brands").select("website").eq("id", brandId).maybeSingle();
    baseUrl = String(brand?.website ?? "").trim();
  }
  if (!baseUrl) return jsonError("no website on file for this brand; pass base_url", 400);
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;

  let origin: URL;
  try { origin = new URL(baseUrl); } catch { return jsonError("invalid base_url", 400); }

  const maxPages = Math.min(HARD_MAX_PAGES, Math.max(1, Number(body.max_pages ?? DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES));
  const replace = body.replace !== false;

  try {
    const disallow = await fetchRobotsDisallow(origin);
    const allowed = (u: URL) => !disallow.some((d) => d && u.pathname.startsWith(d));

    // Fetch the homepage two ways, once: raw HTML (SSR + link discovery) and
    // Jina-rendered (SPA detection + link discovery + content reuse).
    let rawHomeHtml = "";
    try { rawHomeHtml = await fetchText(origin.href); } catch { /* may be JS-gated */ }
    const rawHome = extractContent(rawHomeHtml);
    let jinaHomeRaw = "";
    if (RENDER_ENABLED) { try { jinaHomeRaw = await jinaRaw(origin.href); } catch { /* render optional */ } }
    const jinaHome = jinaHomeRaw ? parseJinaMarkdown(jinaHomeRaw) : { title: "", text: "" };
    // If rendering reveals substantially more than the raw HTML, the site is a
    // client-rendered SPA → render every page instead of parsing the shell.
    const siteNeedsRender = jinaHome.text.length > Math.max(rawHome.text.length * 1.4, 500);

    // 1) Discover candidate URLs (sitemap + raw + rendered homepage links + common paths).
    const candidates = await discoverUrls(origin, maxPages, allowed, rawHomeHtml, jinaHomeRaw);

    // 2) Fetch + extract each page.
    type Page = { url: string; title: string; category: string; text: string };
    const pages: Page[] = [];
    const report: { url: string; title: string; category: string; chars: number; chunks: number; status: string }[] = [];
    const seenText = new Set<string>();
    const homeKey = stripHash(origin.href);
    // Many SPAs return the same generic og:title on every page; fall back to a
    // slug-derived title so knowledge citations are meaningful.
    const siteTitle = rawHome.title || jinaHome.title;

    for (const c of candidates) {
      if (pages.length >= maxPages) break;
      try {
        let extracted: { title: string; text: string };
        if (c.url === homeKey) {
          // Reuse the homepage fetches we already did.
          extracted = siteNeedsRender ? jinaHome : (rawHome.text ? rawHome : jinaHome);
        } else if (siteNeedsRender) {
          try { extracted = await renderPage(c.url); }
          catch { try { extracted = extractContent(await fetchText(c.url)); } catch { extracted = { title: c.anchor, text: "" }; } }
        } else {
          try { extracted = extractContent(await fetchText(c.url)); }
          catch { extracted = { title: c.anchor, text: "" }; }
          // SSR page that came back thin → try rendering as a fallback.
          if (extracted.text.length < MIN_PAGE_CHARS && RENDER_ENABLED) {
            try {
              const r = await renderPage(c.url);
              if (r.text.length > extracted.text.length) extracted = { title: r.title || extracted.title, text: r.text };
            } catch { /* keep direct result */ }
          }
        }
        const text = extracted.text.slice(0, MAX_PAGE_CHARS);
        // Soft-404: many sites return 200 with a "404 Not Found" page for
        // unknown paths (e.g. guessed COMMON_PATHS). Drop them.
        if (c.url !== homeKey && /(^|\W)404(\W|$)|page not found|not found/i.test(extracted.title)) {
          report.push({ url: c.url, title: extracted.title, category: "-", chars: text.length, chunks: 0, status: "skipped (404)" });
          continue;
        }
        if (text.length < MIN_PAGE_CHARS) {
          report.push({ url: c.url, title: extracted.title || c.anchor, category: "-", chars: text.length, chunks: 0, status: "skipped (thin)" });
          continue;
        }
        // Cross-page dedupe: SPAs sometimes serve byte-identical shells. Use the
        // FULL normalized text as the signature — pages that merely share a nav
        // header (common on SSR sites) but differ in body are kept.
        const sig = text.replace(/\s+/g, " ").trim();
        if (seenText.has(sig)) {
          report.push({ url: c.url, title: extracted.title || c.anchor, category: "-", chars: text.length, chunks: 0, status: "skipped (duplicate)" });
          continue;
        }
        seenText.add(sig);
        const category = categorize(c.url + " " + c.anchor + " " + extracted.title);
        const title = (extracted.title && extracted.title !== siteTitle && !/online boutique/i.test(extracted.title))
          ? extracted.title
          : titleFromUrl(c.url, c.anchor) || extracted.title || c.url;
        pages.push({ url: c.url, title, category, text });
      } catch (e) {
        report.push({ url: c.url, title: c.anchor, category: "-", chars: 0, chunks: 0, status: `fetch failed: ${errMsg(e)}` });
      }
    }

    if (pages.length === 0) {
      return jsonOk({ brand_id: brandId, base_url: origin.href, pages: report, docs_created: 0, chunks_created: 0,
        note: SCRAPE_RENDER_URL ? "Nothing retrievable even with rendering." : "Nothing retrievable — site likely needs JS rendering (set SCRAPE_RENDER_URL)." });
    }

    // 2b) Strip cross-page boilerplate (shared nav/menu/footer) and junk lines
    // so chunks are prose, not navigation soup. Drop pages left too thin.
    {
      const cleaned = stripBoilerplate(pages).filter((p) => p.text.length >= MIN_PAGE_CHARS);
      pages.length = 0;
      pages.push(...cleaned);
    }
    if (pages.length === 0) {
      return jsonOk({ brand_id: brandId, base_url: origin.href, pages: report, docs_created: 0, chunks_created: 0,
        note: "Only navigation/boilerplate found — no substantive content to index." });
    }

    // 3) Chunk everything.
    const flat: { pageIdx: number; content: string }[] = [];
    pages.forEach((p, i) => {
      for (const ch of chunkText(p.text)) {
        if (flat.length >= MAX_TOTAL_CHUNKS) break;
        flat.push({ pageIdx: i, content: ch });
      }
    });

    if (body.dry_run === true) {
      for (let i = 0; i < pages.length; i++) {
        const n = flat.filter((f) => f.pageIdx === i).length;
        report.push({ url: pages[i].url, title: pages[i].title, category: pages[i].category, chars: pages[i].text.length, chunks: n, status: "dry-run" });
      }
      return jsonOk({
        brand_id: brandId, base_url: origin.href, dry_run: true,
        pages: report, would_create_docs: pages.length, would_create_chunks: flat.length,
        docs: body.return_chunks === true
          ? pages.map((p, i) => ({
            title: p.title, category: p.category, source_url: p.url, char_count: p.text.length,
            content: p.text, chunks: flat.filter((f) => f.pageIdx === i).map((f) => f.content),
          }))
          : undefined,
      });
    }

    // 4) Embed all chunks (batched), then store.
    const embeddings = await embedDocuments(flat.map((f) => f.content));
    if (replace) {
      await admin.from("brand_knowledge_docs").delete().eq("brand_id", brandId).eq("source_type", "url");
    }

    let docsCreated = 0, chunksCreated = 0;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const pageChunks = flat.map((f, idx) => ({ ...f, idx })).filter((f) => f.pageIdx === i);
      if (pageChunks.length === 0) continue;
      const { data: doc, error: docErr } = await admin.from("brand_knowledge_docs").insert({
        brand_id: brandId, title: p.title.slice(0, 300), category: p.category,
        source_type: "url", source_url: p.url, content: p.text,
        char_count: p.text.length, chunk_count: pageChunks.length, status: "ready", created_by: createdBy,
      }).select("id").single();
      if (docErr || !doc) {
        report.push({ url: p.url, title: p.title, category: p.category, chars: p.text.length, chunks: 0, status: "doc insert failed" });
        continue;
      }
      const rows = pageChunks.map((f, j) => ({
        doc_id: doc.id, brand_id: brandId, chunk_index: j, content: f.content,
        token_count: Math.round(f.content.length / 4), embedding: embeddings[f.idx],
      }));
      const { error: insErr } = await admin.from("brand_knowledge_chunks").insert(rows);
      if (insErr) {
        await admin.from("brand_knowledge_docs").delete().eq("id", doc.id);
        report.push({ url: p.url, title: p.title, category: p.category, chars: p.text.length, chunks: 0, status: "chunk insert failed" });
        continue;
      }
      docsCreated++; chunksCreated += rows.length;
      report.push({ url: p.url, title: p.title, category: p.category, chars: p.text.length, chunks: rows.length, status: "ready" });
    }

    return jsonOk({ brand_id: brandId, base_url: origin.href, pages: report, docs_created: docsCreated, chunks_created: chunksCreated });
  } catch (e) {
    console.error("[scrape-knowledge]", e);
    return jsonError(`scrape failed: ${errMsg(e)}`, 500);
  }
});

// ── URL discovery ────────────────────────────────────────────────────────────
async function discoverUrls(
  origin: URL, maxPages: number, allowed: (u: URL) => boolean,
  homeHtml: string, jinaHomeRaw: string,
): Promise<{ url: string; anchor: string }[]> {
  const pool = new Map<string, string>(); // url -> anchor/label
  const add = (u: URL, label: string) => {
    if (u.hostname !== origin.hostname) return;
    if (!allowed(u)) return;
    const key = stripHash(u.href);
    if (!pool.has(key)) pool.set(key, label.slice(0, 80));
  };

  add(origin, "Home");

  // Real discovered URLs take priority over the guessed COMMON_PATHS below.
  // Sitemaps — the most complete source of public URLs.
  try {
    for (const u of await collectSitemapUrls(origin)) {
      try {
        const url = new URL(u);
        if (LINK_KEYWORDS.test(url.pathname)) add(url, url.pathname);
      } catch { /* skip */ }
    }
  } catch { /* sitemaps optional */ }

  // Homepage links — from the raw HTML (SSR sites)…
  if (homeHtml) {
    for (const { href, text } of extractLinks(homeHtml, origin)) {
      if (LINK_KEYWORDS.test(href.pathname + " " + text)) add(href, text);
    }
  }
  // …and from the Jina-rendered homepage (SPA navigation that isn't in the raw HTML).
  if (jinaHomeRaw) {
    for (const { href, text } of extractMarkdownLinks(jinaHomeRaw, origin)) {
      if (LINK_KEYWORDS.test(href.pathname + " " + text)) add(href, text);
    }
  }

  // COMMON_PATHS last — only fill remaining slots; many will 404 on any given
  // site and are dropped by the soft-404 check at fetch time.
  for (const p of COMMON_PATHS) {
    try { add(new URL(p, origin), p.replace(/\//g, " ").trim()); } catch { /* skip */ }
  }

  // Balance the selection so policy + storytelling (usually few pages) aren't
  // crowded out by hundreds of product URLs.
  const buckets: Record<string, { url: string; anchor: string }[]> =
    { storytelling: [], policy: [], product: [], other: [] };
  for (const [url, anchor] of pool) {
    buckets[categorize(url + " " + anchor)].push({ url, anchor });
  }
  const out: { url: string; anchor: string }[] = [];
  const home = { url: stripHash(origin.href), anchor: "Home" };
  out.push(home);
  const quota = (n: number) => Math.max(1, Math.floor(maxPages * n));
  const take = (arr: { url: string; anchor: string }[], n: number) => {
    for (const it of arr) {
      if (out.length >= maxPages) break;
      if (out.find((o) => o.url === it.url)) continue;
      out.push(it); if (--n <= 0) break;
    }
  };
  take(buckets.storytelling, quota(0.35));
  take(buckets.policy, quota(0.30));
  take(buckets.product, quota(0.30));
  take(buckets.other, quota(0.15));
  // Fill any remaining slots from whatever's left.
  for (const b of ["storytelling", "policy", "product", "other"]) take(buckets[b], maxPages);
  return out.slice(0, maxPages);
}

async function collectSitemapUrls(origin: URL): Promise<string[]> {
  const queue: string[] = [];
  const seen = new Set<string>();
  // From robots.txt + conventional locations.
  try {
    const robots = await (await fetch(new URL("/robots.txt", origin).href, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) })).text();
    for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1].trim());
  } catch { /* ignore */ }
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) queue.push(new URL(p, origin).href);

  const urls: string[] = [];
  let filesFetched = 0;
  while (queue.length && filesFetched < MAX_SITEMAP_FILES && urls.length < MAX_SITEMAP_URLS) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml: string;
    try { xml = await fetchSitemap(sm); filesFetched++; } catch { continue; }
    const isIndex = /<sitemapindex/i.test(xml);
    const locs = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]).trim());
    if (isIndex) {
      for (const l of locs) if (!seen.has(l) && queue.length < MAX_SITEMAP_FILES * 4) queue.push(l);
    } else {
      for (const l of locs) { urls.push(l); if (urls.length >= MAX_SITEMAP_URLS) break; }
    }
  }
  return urls;
}

async function fetchSitemap(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(12000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/\.gz($|\?)/i.test(url) || /application\/gzip/i.test(res.headers.get("content-type") ?? "")) {
    const ds = new DecompressionStream("gzip");
    const stream = res.body!.pipeThrough(ds);
    return await new Response(stream).text();
  }
  return await res.text();
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en,it;q=0.8" },
      signal: ctrl.signal, redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|xhtml|xml/i.test(ct)) throw new Error(`non-html (${ct.split(";")[0]})`);
    return await res.text();
  } finally { clearTimeout(t); }
}

// Render a JS page and return clean {title, text}. Prefers a custom
// SCRAPE_RENDER_URL (returns HTML) if set; otherwise uses Jina AI Reader,
// which returns ready-to-use markdown.
async function renderPage(url: string): Promise<{ title: string; text: string }> {
  if (SCRAPE_RENDER_URL) {
    const isPost = /\{url\}|POST/i.test(SCRAPE_RENDER_URL) || !/\?/.test(SCRAPE_RENDER_URL);
    const res = isPost
      ? await fetch(SCRAPE_RENDER_URL, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(40000) })
      : await fetch(SCRAPE_RENDER_URL + encodeURIComponent(url), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(40000) });
    if (!res.ok) throw new Error(`render HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    const html = /application\/json/i.test(ct)
      ? String((await res.json()).html ?? "")
      : await res.text();
    return extractContent(html);
  }
  return parseJinaMarkdown(await jinaRaw(url));
}

// Raw Jina AI Reader output (markdown) for a URL. Used both for content and
// for harvesting the rendered page's links (SPA navigation).
async function jinaRaw(url: string): Promise<string> {
  const res = await fetch("https://r.jina.ai/" + url, {
    headers: {
      ...(JINA_API_KEY ? { "Authorization": `Bearer ${JINA_API_KEY}` } : {}),
      "Accept": "text/plain",
      "X-Return-Format": "markdown",
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`jina HTTP ${res.status}`);
  return await res.text();
}

// Links from a Jina markdown blob: [text](url) plus bare same-origin URLs.
function extractMarkdownLinks(md: string, base: URL): { href: URL; text: string }[] {
  const out: { href: URL; text: string }[] = [];
  const seen = new Set<string>();
  const add = (raw: string, text: string) => {
    try {
      const href = new URL(raw, base);
      const k = stripHash(href.href);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ href, text: text.trim() });
    } catch { /* skip */ }
  };
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)) add(m[2], m[1]);
  for (const m of md.matchAll(/https?:\/\/[^\s)\]]+/g)) add(m[0], "");
  return out;
}

function parseJinaMarkdown(raw: string): { title: string; text: string } {
  let title = "";
  let body = raw;
  const tm = raw.match(/^Title:\s*(.+)$/m);
  if (tm) title = tm[1].trim();
  const mc = raw.indexOf("Markdown Content:");
  if (mc !== -1) body = raw.slice(mc + "Markdown Content:".length);
  return { title, text: cleanMarkdown(body) };
}

// Strip markdown link/image syntax and boilerplate so chunks are prose, not
// navigation soup.
function cleanMarkdown(md: string): string {
  let s = md;
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");        // images
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");        // links → text
  s = s.replace(/^[#>*\-=_`|]+\s?/gm, "");              // md markers at line start
  s = s.replace(/\|/g, " ");                            // table pipes
  s = s.replace(/https?:\/\/\S+/g, " ");                // bare urls
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

async function fetchRobotsDisallow(origin: URL): Promise<string[]> {
  try {
    const res = await fetch(new URL("/robots.txt", origin).href, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const txt = await res.text();
    const disallow: string[] = [];
    let inStar = false;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (/^user-agent:/i.test(line)) inStar = /:\s*\*/.test(line);
      else if (inStar && /^disallow:/i.test(line)) {
        const path = line.split(":")[1]?.trim();
        if (path) disallow.push(path);
      }
    }
    return disallow;
  } catch { return []; }
}

// ── Content extraction ───────────────────────────────────────────────────────
function extractContent(html: string): { title: string; text: string } {
  const title = extractTitle(html);
  const parts: string[] = [];
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (metaDesc?.[1]) parts.push(decodeEntities(metaDesc[1]).trim());

  for (const s of extractJsonLdStrings(html)) parts.push(s);
  for (const s of extractHydrationStrings(html)) parts.push(s);
  parts.push(htmlToText(html));

  // Merge line-by-line, dedupe, drop boilerplate-short lines.
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const block of parts) {
    for (const lnRaw of block.split(/\n+/)) {
      const ln = lnRaw.trim().replace(/\s{2,}/g, " ");
      if (ln.length < 3) continue;
      const norm = ln.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      lines.push(ln);
      total += ln.length + 1;
      if (total >= MAX_PAGE_CHARS * 1.5) break;
    }
    if (total >= MAX_PAGE_CHARS * 1.5) break;
  }
  return { title, text: lines.join("\n").trim() };
}

function extractJsonLdStrings(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectStrings(JSON.parse(m[1].trim()), out); } catch { /* skip bad json */ }
  }
  return out;
}

function extractHydrationStrings(html: string): string[] {
  const out: string[] = [];
  // __NEXT_DATA__ (Next.js, clean JSON in a script tag).
  const nd = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nd?.[1]) { try { collectStrings(JSON.parse(nd[1].trim()), out); } catch { /* skip */ } }

  // Assignment-style global state blobs: window.__X__ = {...};
  for (const marker of ["__NUXT__", "__APOLLO_STATE__", "__INITIAL_STATE__", "__PRELOADED_STATE__", "__data"]) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const eq = html.indexOf("=", idx + marker.length);
    if (eq === -1) continue;
    const braceStart = html.indexOf("{", eq);
    if (braceStart === -1 || braceStart - eq > 8) continue;
    const json = extractBalancedJson(html, braceStart);
    if (json) { try { collectStrings(JSON.parse(json), out); } catch { /* skip */ } }
  }

  // Next.js 13 streamed payload: self.__next_f.push([1,"...escaped..."])
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      const decoded = JSON.parse(`"${m[1]}"`); // unescape
      for (const s of decoded.split(/\\n|\n/)) {
        const t = s.trim();
        if (t.length >= STRING_MIN_LEN && /\s/.test(t) && !/^https?:\/\//.test(t)) out.push(t);
      }
    } catch { /* skip */ }
  }
  return out;
}

// Recursively collect prose-like strings from a parsed JSON value.
function collectStrings(v: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 4000) return;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.length >= STRING_MIN_LEN && /\s/.test(s) && !/^https?:\/\//i.test(s) && !/^[\w-]+\/[\w-]+$/.test(s)) {
      // Looks like prose, not an id/url/mime — strip any embedded html.
      out.push(decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s{2,}/g, " ").trim());
    }
  } else if (Array.isArray(v)) {
    for (const it of v) collectStrings(it, out, depth + 1);
  } else if (v && typeof v === "object") {
    for (const val of Object.values(v as Record<string, unknown>)) collectStrings(val, out, depth + 1);
  }
}

// Balance-match a JSON object starting at `start` (index of '{'), string-aware.
function extractBalancedJson(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length && i < start + 2_000_000; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
    }
  }
  return null;
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t?.[1] ? decodeEntities(t[1]).replace(/\s+/g, " ").trim() : "";
}

function extractLinks(html: string, base: URL): { href: URL; text: string }[] {
  const out: { href: URL; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = m[1];
    if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) continue;
    try {
      const href = new URL(raw, base);
      const key = stripHash(href.href);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ href, text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() });
    } catch { /* skip */ }
  }
  return out;
}

function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|li|h[1-6]|section|article|tr|td)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => safeChar(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)));
}
function safeChar(code: number): string {
  try { return Number.isFinite(code) ? String.fromCodePoint(code) : ""; } catch { return ""; }
}

function categorize(haystack: string): string {
  for (const r of CATEGORY_RULES) if (r.re.test(haystack)) return r.category;
  return "other";
}

// E-commerce / navigation chrome that adds noise to every page.
const JUNK_LINE =
  /^(sort by|filter|refine|add to (cart|bag|wishlist)|free (standard )?(shipping|returns?)|complimentary (shipping|returns?)|regular price|unit price|sale price|price|shop now|shop all|discover( more)?|learn more|read more|view (all|more|details)|see (all|more)|book (your )?(a )?(visit|appointment)|search|menu|sign ?in|log ?in|register|create account|my account|newsletter|subscribe|follow us|share|wishlist|quick (view|shop|buy)|select( options?| size)?|home|cart|bag|checkout|contact( us)?|store locator|find a (store|boutique)|back to top|skip to (main )?content|©|copyright|all rights reserved|cookies?|privacy( policy)?|terms|change (country|region|language)|loading)\b/i;

const normLine = (l: string) => l.toLowerCase().replace(/\s+/g, " ").trim();

function isJunkLine(l: string): boolean {
  const t = l.trim();
  if (t.length < 2) return true;
  if (JUNK_LINE.test(t)) return true;
  // Pure price / currency / number-only lines.
  if (/^[€$£%+\-\s\d.,:|/]+$/.test(t)) return true;
  // Bare locale/nav tokens like "EN", "IT", "US".
  if (/^[a-z]{2,3}([_/-][a-z]{2,3})?$/i.test(t) && !/\s/.test(t)) return true;
  return false;
}

// Remove lines that repeat across many pages (shared chrome) plus junk lines.
function stripBoilerplate<T extends { text: string }>(pages: T[]): T[] {
  const pageLines = pages.map((p) => p.text.split("\n").map((l) => l.trim()));
  const freq = new Map<string, number>();
  if (pages.length >= 3) {
    for (const lines of pageLines) {
      for (const key of new Set(lines.map(normLine))) if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  return pages.map((p, i) => {
    const kept = pageLines[i].filter(
      (l) => l && !isJunkLine(l) && (freq.get(normLine(l)) ?? 0) < threshold,
    );
    return { ...p, text: kept.join("\n") };
  });
}
const stripHash = (u: string) => u.split("#")[0];

// Human-readable title from a URL's last meaningful path segment.
function titleFromUrl(url: string, fallback: string): string {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    // Skip pure locale segments like "us_en" / "it_it" / "en".
    let seg = segs.reverse().find((s) => !/^[a-z]{2}([_-][a-z]{2})?$/i.test(s)) ?? segs[0] ?? "";
    seg = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
    if (seg.length < 2) return fallback;
    return seg.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120);
  } catch { return fallback; }
}

// ── Chunking + embedding ─────────────────────────────────────────────────────
function chunkText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const paragraphs = normalised.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const push = () => { const t = current.trim(); if (t) chunks.push(t); current = ""; };
  for (const para of paragraphs) {
    if (para.length > CHUNK_CHARS) {
      push();
      for (let i = 0; i < para.length; i += CHUNK_CHARS - CHUNK_OVERLAP) chunks.push(para.slice(i, i + CHUNK_CHARS).trim());
      continue;
    }
    if (current.length + para.length + 2 > CHUNK_CHARS) {
      const tail = current.slice(-CHUNK_OVERLAP); push(); current = tail ? `${tail}\n\n${para}` : para;
    } else current = current ? `${current}\n\n${para}` : para;
  }
  push();
  return chunks;
}

async function embedDocuments(inputs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH);
    let lastErr = "", ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: batch, model: EMBED_MODEL, input_type: "document", output_dimension: EMBED_DIMS }),
      });
      if (res.ok) {
        const json = await res.json();
        for (const d of (json?.data ?? [])) out.push(d.embedding as number[]);
        ok = true;
      } else {
        lastErr = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
        if (res.status === 429 || res.status >= 500) await sleep(2000 * (attempt + 1));
        else throw new Error(`Voyage embed failed (${lastErr})`);
      }
    }
    if (!ok) throw new Error(`Voyage embed failed after retries (${lastErr})`);
  }
  if (out.length !== inputs.length) throw new Error(`embedding count mismatch: ${out.length} vs ${inputs.length}`);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "unknown");
function jsonOk(b: unknown) { return new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json", ...CORS } }); }
function jsonError(m: string, s: number) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json", ...CORS } }); }
