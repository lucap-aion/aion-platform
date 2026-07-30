// Shared crawling / extraction / embedding helpers for the knowledge pipeline
// (seed-crawl, crawl-worker). Keep dependency-free (Deno std only).

export const UA =
  "Mozilla/5.0 (compatible; AIONKnowledgeBot/1.0; +https://aioncover.com/bot) Googlebot/2.1";
export const EMBED_MODEL = "voyage-3.5";
export const EMBED_DIMS = 1024;
const EMBED_BATCH = 128;
const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 150;
const PER_PAGE_TIMEOUT_MS = 15_000;
export const MAX_PAGE_CHARS = 16_000;
export const MIN_PAGE_CHARS = 200;

export const CATEGORY_RULES: { re: RegExp; category: string }[] = [
  { re: /(return|reso|resi|warranty|garanzia|guarantee|shipping|spedizion|faq|assistenza|customer-?(care|service)|client-?(care|service)|support|terms|legal|privacy|ethic|corporate)/i, category: "policy" },
  { re: /(about|stor(y|ia)|heritage|history|founder|fondat|maison|world|mondo|values|valori|sustainab|sostenib|chi-?siamo|the-?house|craft|savoir|la-maison|design|career)/i, category: "storytelling" },
  { re: /(product|collection|collezion|care|cura|manutenz|materials?|materiali|gioiell|jewel|watch|orolog|fragrance|leather|pelle|bag|shoe|ready-to-wear)/i, category: "product" },
];

export const LINK_KEYWORDS =
  /(about|stor(y|ia)|heritage|history|founder|fondat|maison|world|mondo|values|valori|sustainab|sostenib|chi-?siamo|return|reso|resi|warranty|garanzia|shipping|spedizion|faq|assistenza|customer-?(care|service)|client-?(care|service)|support|care|cura|manutenz|collection|collezion|material|craft|savoir|the-?house|gioiell|jewel|watch|orolog|fragrance|leather|pelle|bag|product|ethic|corporate|design|career)/i;

const JUNK_LINE =
  /^(sort by|filter|refine|add to (cart|bag|wishlist)|free (standard )?(shipping|returns?)|complimentary (shipping|returns?)|regular price|unit price|sale price|price|shop now|shop all|discover( more)?|learn more|read more|view (all|more|details)|see (all|more)|book (your )?(a )?(visit|appointment)|search|menu|sign ?in|log ?in|register|create account|my account|newsletter|subscribe|follow us|share|wishlist|quick (view|shop|buy)|select( options?| size)?|home|cart|bag|checkout|contact( us)?|store locator|find a (store|boutique)|back to top|skip to (main )?content|©|copyright|all rights reserved|cookies?|privacy( policy)?|terms|change (country|region|language)|loading)\b/i;

export const stripHash = (u: string) => u.split("#")[0];
export const normLine = (l: string) => l.toLowerCase().replace(/\s+/g, " ").trim();

export function isJunkLine(l: string): boolean {
  const t = l.trim();
  if (t.length < 2) return true;
  if (JUNK_LINE.test(t)) return true;
  if (/^[€$£%+\-\s\d.,:|/]+$/.test(t)) return true;
  if (/^[a-z]{2,3}([_/-][a-z]{2,3})?$/i.test(t) && !/\s/.test(t)) return true;
  return false;
}

// A product page IS a product page, whatever its prose says. This has to be
// checked first and on the URL alone.
const PRODUCT_URL = /\/(products?|p|item|articolo|prodotti?)\/[^/]+/i;
// Content that only a shop page has, for sites that don't put /products/ in the
// path.
const PRODUCT_BODY = /(add to (cart|bag)|aggiungi al carrello|select (a )?size|scegli la taglia|composition\s*:|composizione\s*:|sku\s*:|product details)/i;

// Categorising on url + title + the first 300 characters of the page looked
// sensible and was wrong: on most luxury sites those 300 characters are the
// global navigation, which mentions "World", "About us", "Sustainability" and
// "Craft" on EVERY page — so every page matched the storytelling rule before
// the product rule was reached. Luisa Beccaria ended up with 112 of its 141
// "storytelling" documents being product pages, which then won every search
// for the brand's voice.
//
// So: trust the URL, then the title, and only fall back to body text when
// neither says anything. Body text is the least reliable signal, not the most.
export function categorize(url: string, title = "", text = ""): string {
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();

  if (PRODUCT_URL.test(path)) return "product";

  const label = `${path} ${title}`;
  for (const r of CATEGORY_RULES) if (r.re.test(label)) return r.category;

  if (PRODUCT_BODY.test(text)) return "product";
  for (const r of CATEGORY_RULES) if (r.re.test(text)) return r.category;
  return "other";
}

// ── HTTP ──────────────────────────────────────────────────────────────────
export async function fetchText(url: string): Promise<string> {
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

export async function jinaRaw(url: string, jinaKey: string): Promise<string> {
  const res = await fetch("https://r.jina.ai/" + url, {
    headers: { ...(jinaKey ? { "Authorization": `Bearer ${jinaKey}` } : {}), "Accept": "text/plain", "X-Return-Format": "markdown" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`jina HTTP ${res.status}`);
  return await res.text();
}

export function parseJinaMarkdown(raw: string): { title: string; text: string } {
  let title = "";
  let body = raw;
  const tm = raw.match(/^Title:\s*(.+)$/m);
  if (tm) title = tm[1].trim();
  const mc = raw.indexOf("Markdown Content:");
  if (mc !== -1) body = raw.slice(mc + "Markdown Content:".length);
  return { title, text: cleanMarkdown(body) };
}

function cleanMarkdown(md: string): string {
  let s = md;
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/^[#>*\-=_`|]+\s?/gm, "");
  s = s.replace(/\|/g, " ");
  s = s.replace(/https?:\/\/\S+/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function extractMarkdownLinks(md: string, base: URL): { href: URL; text: string }[] {
  const out: { href: URL; text: string }[] = [];
  const seen = new Set<string>();
  const add = (raw: string, text: string) => {
    try { const href = new URL(raw, base); const k = stripHash(href.href); if (seen.has(k)) return; seen.add(k); out.push({ href, text: text.trim() }); } catch { /* skip */ }
  };
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)) add(m[2], m[1]);
  for (const m of md.matchAll(/https?:\/\/[^\s)\]]+/g)) add(m[0], "");
  return out;
}

// ── Sitemaps ─────────────────────────────────────────────────────────────
export async function collectSitemapUrls(origin: URL, maxUrls = 3000, maxFiles = 24): Promise<string[]> {
  const queue: string[] = [];
  const seen = new Set<string>();
  try {
    const robots = await (await fetch(new URL("/robots.txt", origin).href, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) })).text();
    for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1].trim());
  } catch { /* ignore */ }
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap/index.xml"]) queue.push(new URL(p, origin).href);

  const urls: string[] = [];
  let files = 0;
  while (queue.length && files < maxFiles && urls.length < maxUrls) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml: string;
    try { xml = await fetchSitemap(sm); files++; } catch { continue; }
    const isIndex = /<sitemapindex/i.test(xml);
    const locs = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]).trim());
    if (isIndex) {
      // Process informational sitemaps (pages, policies, collections, blogs)
      // before the product catalogue. A large catalogue can otherwise exhaust
      // maxUrls before policy/help pages are ever reached — which is how e.g.
      // /pages/returns-and-refunds gets silently dropped on a Shopify store.
      for (const l of locs) {
        if (seen.has(l) || queue.length >= maxFiles * 6) continue;
        if (/sitemap[^/]*product/i.test(l)) queue.push(l);
        else queue.unshift(l);
      }
    }
    else { for (const l of locs) { urls.push(l); if (urls.length >= maxUrls) break; } }
  }
  return urls;
}

async function fetchSitemap(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(12000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/\.gz($|\?)/i.test(url) || /application\/gzip/i.test(res.headers.get("content-type") ?? "")) {
    return await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).text();
  }
  return await res.text();
}

// ── HTML → text ──────────────────────────────────────────────────────────
export function extractContent(html: string): { title: string; text: string } {
  const title = extractTitle(html);
  const parts: string[] = [];
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (metaDesc?.[1]) parts.push(decodeEntities(metaDesc[1]).trim());
  for (const s of extractJsonLdStrings(html)) parts.push(s);
  for (const s of extractHydrationStrings(html)) parts.push(s);
  parts.push(htmlToText(html));

  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const block of parts) {
    for (const lnRaw of block.split(/\n+/)) {
      const ln = lnRaw.trim().replace(/\s{2,}/g, " ");
      if (ln.length < 3) continue;
      const norm = ln.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm); lines.push(ln); total += ln.length + 1;
      if (total >= MAX_PAGE_CHARS * 1.5) break;
    }
    if (total >= MAX_PAGE_CHARS * 1.5) break;
  }
  return { title, text: lines.join("\n").trim() };
}

function extractJsonLdStrings(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectStrings(JSON.parse(m[1].trim()), out); } catch { /* skip */ }
  }
  return out;
}
function extractHydrationStrings(html: string): string[] {
  const out: string[] = [];
  const nd = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nd?.[1]) { try { collectStrings(JSON.parse(nd[1].trim()), out); } catch { /* skip */ } }
  for (const marker of ["__NUXT__", "__APOLLO_STATE__", "__INITIAL_STATE__", "__PRELOADED_STATE__"]) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const eq = html.indexOf("=", idx + marker.length);
    if (eq === -1) continue;
    const braceStart = html.indexOf("{", eq);
    if (braceStart === -1 || braceStart - eq > 8) continue;
    const json = extractBalancedJson(html, braceStart);
    if (json) { try { collectStrings(JSON.parse(json), out); } catch { /* skip */ } }
  }
  return out;
}
function collectStrings(v: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 4000) return;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.length >= 40 && /\s/.test(s) && !/^https?:\/\//i.test(s) && !/^[\w-]+\/[\w-]+$/.test(s)) {
      out.push(decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s{2,}/g, " ").trim());
    }
  } else if (Array.isArray(v)) { for (const it of v) collectStrings(it, out, depth + 1); }
  else if (v && typeof v === "object") { for (const val of Object.values(v as Record<string, unknown>)) collectStrings(val, out, depth + 1); }
}
function extractBalancedJson(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length && i < start + 2_000_000; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else { if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); } }
  }
  return null;
}
export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t?.[1] ? decodeEntities(t[1]).replace(/\s+/g, " ").trim() : "";
}
export function extractLinks(html: string, base: URL): { href: URL; text: string }[] {
  const out: { href: URL; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = m[1];
    if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) continue;
    try { const href = new URL(raw, base); const k = stripHash(href.href); if (seen.has(k)) continue; seen.add(k); out.push({ href, text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }); } catch { /* skip */ }
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
  return s.replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => safeChar(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)));
}
function safeChar(code: number): string { try { return Number.isFinite(code) ? String.fromCodePoint(code) : ""; } catch { return ""; } }

export function titleFromUrl(url: string, fallback: string): string {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    let seg = segs.reverse().find((s) => !/^[a-z]{2}([_-][a-z]{2})?$/i.test(s)) ?? segs[0] ?? "";
    seg = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
    if (seg.length < 2) return fallback;
    return seg.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120);
  } catch { return fallback; }
}

// Strip junk + caller-provided boilerplate (normalized) lines from one page.
export function stripLines(text: string, boilerplate: Set<string>): string {
  return text.split("\n").map((l) => l.trim())
    .filter((l) => l && !isJunkLine(l) && !boilerplate.has(normLine(l)))
    .join("\n");
}

// ── Chunking + embedding ───────────────────────────────────────────────────
export function chunkText(text: string): string[] {
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
    if (current.length + para.length + 2 > CHUNK_CHARS) { const tail = current.slice(-CHUNK_OVERLAP); push(); current = tail ? `${tail}\n\n${para}` : para; }
    else current = current ? `${current}\n\n${para}` : para;
  }
  push();
  return chunks;
}

export async function embedDocuments(inputs: string[], voyageKey: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH);
    let ok = false, lastErr = "";
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "Authorization": `Bearer ${voyageKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: batch, model: EMBED_MODEL, input_type: "document", output_dimension: EMBED_DIMS }),
      });
      if (res.ok) { const j = await res.json(); for (const d of (j?.data ?? [])) out.push(d.embedding as number[]); ok = true; }
      else { lastErr = `${res.status}`; if (res.status === 429 || res.status >= 500) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); else throw new Error(`Voyage embed ${lastErr}`); }
    }
    if (!ok) throw new Error(`Voyage embed failed (${lastErr})`);
  }
  if (out.length !== inputs.length) throw new Error(`embed count ${out.length}/${inputs.length}`);
  return out;
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
