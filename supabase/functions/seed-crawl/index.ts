// seed-crawl: discover everything to index for a brand and fill the crawl queue.
//  • whole website via sitemap (+ homepage links, raw and Jina-rendered)
//  • brand news via Google News RSS
//  • derives the cross-page boilerplate line set + SPA-render flag, stored on
//    knowledge_sources.config so the worker can clean/render each page.
//
// Auth: batch (x-batch-secret) / admin (brand_id) / brand user (pinned).
// Body: { brand_id?, base_url?, max_pages?, news?:bool }

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  UA, fetchText, jinaRaw, parseJinaMarkdown, extractContent, extractLinks,
  extractMarkdownLinks, collectSitemapUrls, normLine, stripHash, decodeEntities,
} from "../_shared/crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") ?? "";
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";

const DEFAULT_MAX_PAGES = 500;
const HARD_MAX_PAGES = 2000;
const NEWS_MAX = 20;
const BOILERPLATE_SAMPLE = 8;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Resolve brand scope.
  let brandId: number | null = null;
  const isBatch = (KNOWLEDGE_BATCH_SECRET && req.headers.get("x-batch-secret") === KNOWLEDGE_BATCH_SECRET) || token === SUPABASE_SERVICE_ROLE_KEY;
  if (isBatch) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required in batch mode", 400);
  } else {
    if (!token) return jsonError("missing bearer token", 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonError("invalid session", 401);
    const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (adminRow) { brandId = Number(body.brand_id ?? 0) || null; if (!brandId) return jsonError("brand_id required for admin caller", 400); }
    else {
      const { data: p } = await userClient.from("profiles").select("brand_id, role").eq("user_id", user.id).in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
      if (!p?.brand_id) return jsonError("admin or brand role required", 403);
      brandId = p.brand_id as number;
    }
  }

  // Base URL.
  let baseUrl = body.base_url ? String(body.base_url).trim() : "";
  if (!baseUrl) { const { data: b } = await admin.from("brands").select("website, name").eq("id", brandId).maybeSingle(); baseUrl = String(b?.website ?? "").trim(); }
  const { data: brandRow } = await admin.from("brands").select("name").eq("id", brandId).maybeSingle();
  const brandName = String(brandRow?.name ?? "").trim();
  if (!baseUrl) return jsonError("no website on file; pass base_url", 400);
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  let origin: URL;
  try { origin = new URL(baseUrl); } catch { return jsonError("invalid base_url", 400); }
  const maxPages = Math.min(HARD_MAX_PAGES, Math.max(1, Number(body.max_pages ?? DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES));

  // News preference: an explicit body.news wins; otherwise use the persisted
  // per-brand pref (set from the UI toggle), defaulting to on. This is what the
  // weekly cron (which passes no news flag) honours.
  const { data: existingSrc } = await admin.from("knowledge_sources").select("config").eq("brand_id", brandId).eq("kind", "website").maybeSingle();
  const existingCfg = (existingSrc?.config ?? {}) as { news_enabled?: boolean };
  const newsPref = typeof body.news === "boolean" ? body.news : (existingCfg.news_enabled ?? true);

  try {
    // Homepage two ways → SPA detection + link discovery.
    let rawHomeHtml = ""; try { rawHomeHtml = await fetchText(origin.href); } catch { /* JS-gated */ }
    const rawHome = extractContent(rawHomeHtml);
    let jinaHomeRaw = ""; try { jinaHomeRaw = await jinaRaw(origin.href, JINA_API_KEY); } catch { /* optional */ }
    const jinaHome = jinaHomeRaw ? parseJinaMarkdown(jinaHomeRaw) : { title: "", text: "" };
    const render = jinaHome.text.length > Math.max(rawHome.text.length * 1.4, 500);

    // Discover page URLs: full sitemap + homepage links (raw + rendered).
    const pageUrls = new Map<string, string>(); // url -> category_hint
    const add = (u: URL) => { if (u.hostname !== origin.hostname) return; const k = stripHash(u.href); if (!pageUrls.has(k)) pageUrls.set(k, ""); };
    add(origin);
    for (const u of await collectSitemapUrls(origin, maxPages)) { try { add(new URL(u)); } catch { /* skip */ } }
    if (rawHomeHtml) for (const { href } of extractLinks(rawHomeHtml, origin)) add(href);
    if (jinaHomeRaw) for (const { href } of extractMarkdownLinks(jinaHomeRaw, origin)) add(href);

    const urls = [...pageUrls.keys()].slice(0, maxPages);

    // Boilerplate set: sample a few pages, keep lines repeated on >=40%.
    const sample = urls.slice(0, BOILERPLATE_SAMPLE);
    const lineFreq = new Map<string, number>();
    let sampled = 0;
    for (const u of sample) {
      let text = "";
      try { text = render ? parseJinaMarkdown(await jinaRaw(u, JINA_API_KEY)).text : extractContent(await fetchText(u)).text; } catch { continue; }
      if (!text) continue;
      sampled++;
      for (const key of new Set(text.split("\n").map(normLine))) if (key) lineFreq.set(key, (lineFreq.get(key) ?? 0) + 1);
    }
    const thr = Math.max(2, Math.ceil(sampled * 0.4));
    const boilerplate = [...lineFreq.entries()].filter(([, n]) => n >= thr).map(([l]) => l).slice(0, 500);

    // News via Google News RSS.
    const newsItems: { url: string; title: string }[] = [];
    if (newsPref && brandName) {
      try {
        const rss = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${brandName}"`)}&hl=en-US&gl=US&ceid=US:en`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) })).text();
        for (const m of rss.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
          const link = m[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
          const title = decodeEntities(m[1].match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
          if (link) newsItems.push({ url: link, title });
          if (newsItems.length >= NEWS_MAX) break;
        }
      } catch { /* news optional */ }
    }

    // Persist source config.
    await admin.from("knowledge_sources").upsert({
      brand_id: brandId, kind: "website", target: origin.href, enabled: true,
      config: { render, boilerplate, max_pages: maxPages, news_enabled: newsPref }, last_seeded_at: new Date().toISOString(),
    }, { onConflict: "brand_id,kind" });
    if (newsItems.length) {
      await admin.from("knowledge_sources").upsert({
        brand_id: brandId, kind: "news", target: brandName, enabled: true, config: {}, last_seeded_at: new Date().toISOString(),
      }, { onConflict: "brand_id,kind" });
    }

    // Enqueue. Upsert to pending so re-seeds refresh.
    const rows = [
      ...urls.map((u) => ({ brand_id: brandId, url: u, kind: "page", status: "pending" as const })),
      ...newsItems.map((n) => ({ brand_id: brandId, url: n.url, kind: "news", title: n.title.slice(0, 300), status: "pending" as const })),
    ];
    let enqueued = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("knowledge_crawl_queue").upsert(rows.slice(i, i + 500), { onConflict: "brand_id,url", ignoreDuplicates: false });
      if (!error) enqueued += rows.slice(i, i + 500).length;
      else console.error("[seed enqueue]", error.message);
    }

    return jsonOk({ brand_id: brandId, base_url: origin.href, render, page_urls: urls.length, news_items: newsItems.length, boilerplate_lines: boilerplate.length, enqueued });
  } catch (e) {
    console.error("[seed-crawl]", e);
    return jsonError(`seed failed: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});

function jsonOk(b: unknown) { return new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json", ...CORS } }); }
function jsonError(m: string, s: number) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json", ...CORS } }); }
