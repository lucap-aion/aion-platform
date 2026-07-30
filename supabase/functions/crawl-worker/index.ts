// crawl-worker: process a batch of queued URLs for a brand — fetch, clean,
// chunk, embed, and upsert into the knowledge base. Content-hash dedup skips
// re-embedding unchanged pages. Designed to be called repeatedly (by cron or a
// drain loop) until the queue empties; each call stays under the function
// timeout by processing a small batch.
//
// Auth: batch (x-batch-secret) / service role / admin.
// Body: { brand_id, limit? }

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchText, jinaRaw, parseJinaMarkdown, extractContent, chunkText, embedDocuments,
  stripLines, categorize, titleFromUrl, sha256, MIN_PAGE_CHARS, MAX_PAGE_CHARS,
} from "../_shared/crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") ?? "";
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";

const DEFAULT_LIMIT = 8;
const MAX_CHUNKS_PER_PAGE = 40;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
  const isBatch = (KNOWLEDGE_BATCH_SECRET && req.headers.get("x-batch-secret") === KNOWLEDGE_BATCH_SECRET) || token === SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  let brandId = Number(body.brand_id ?? 0) || null;

  if (!isBatch) {
    // Allow an admin JWT to drive the worker manually.
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonError("invalid session", 401);
    const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return jsonError("admin or batch auth required", 403);
  }
  if (!brandId) {
    // No brand specified: pick the brand with the most pending items.
    const { data } = await admin.from("knowledge_crawl_queue").select("brand_id").eq("status", "pending").limit(1);
    brandId = (data?.[0]?.brand_id as number) ?? null;
    if (!brandId) return jsonOk({ processed: 0, remaining: 0, note: "queue empty" });
  }

  const limit = Math.min(20, Math.max(1, Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

  // Source config: render flag + boilerplate set.
  const { data: src } = await admin.from("knowledge_sources").select("config").eq("brand_id", brandId).eq("kind", "website").maybeSingle();
  const cfg = (src?.config ?? {}) as { render?: boolean; boilerplate?: string[] };
  const render = !!cfg.render;
  const boilerplate = new Set(cfg.boilerplate ?? []);

  // Claim a batch atomically.
  const { data: batch, error: claimErr } = await admin.rpc("claim_crawl_batch", { p_brand_id: brandId, p_limit: limit });
  if (claimErr) return jsonError(`claim failed: ${claimErr.message}`, 500);
  const items = (batch ?? []) as { id: string; url: string; kind: string; title: string | null }[];

  let done = 0, skipped = 0, errored = 0, unchanged = 0;

  for (const it of items) {
    try {
      // Fetch + extract.
      let title = it.title ?? "";
      let text = "";
      if (it.kind === "news") {
        const j = parseJinaMarkdown(await jinaRaw(it.url, JINA_API_KEY));
        title = title || j.title; text = j.text;
      } else if (render) {
        // Prefer the Jina-rendered version, but fall back to a raw fetch when
        // Jina is unavailable (quota/402, rate-limit/429, transient 5xx) or
        // returns too little — static pages (policies, help) render fine raw.
        let j = { title: "", text: "" };
        try { j = parseJinaMarkdown(await jinaRaw(it.url, JINA_API_KEY)); } catch { /* fall back to raw below */ }
        if (j.text.length < MIN_PAGE_CHARS) {
          const e = extractContent(await fetchText(it.url));
          if (e.text.length > j.text.length) j = { title: e.title || j.title, text: e.text };
        }
        title = title || j.title; text = j.text;
      } else {
        const e = extractContent(await fetchText(it.url));
        title = title || e.title; text = e.text;
        if (text.length < MIN_PAGE_CHARS && JINA_API_KEY) {
          const j = parseJinaMarkdown(await jinaRaw(it.url, JINA_API_KEY));
          if (j.text.length > text.length) { title = j.title || title; text = j.text; }
        }
      }
      text = stripLines(text, boilerplate).slice(0, MAX_PAGE_CHARS);

      if (text.length < MIN_PAGE_CHARS) {
        await mark(admin, it.id, "skipped", null, null);
        skipped++; continue;
      }

      const hash = await sha256(text);
      const { data: existing } = await admin.from("brand_knowledge_docs")
        .select("id, content_hash").eq("brand_id", brandId).eq("source_url", it.url).maybeSingle();
      if (existing?.content_hash === hash) {
        await mark(admin, it.id, "done", hash, existing.id);
        unchanged++; continue;
      }

      const chunks = chunkText(text).slice(0, MAX_CHUNKS_PER_PAGE);
      if (chunks.length === 0) { await mark(admin, it.id, "skipped", null, null); skipped++; continue; }
      const embeddings = await embedDocuments(chunks, VOYAGE_API_KEY);

      const category = it.kind === "news" ? "news" : categorize(it.url, title, text);
      const cleanTitle = (title && !/online boutique|404|not found/i.test(title)) ? title : titleFromUrl(it.url, title || it.url);

      // Replace any prior doc for this URL.
      if (existing?.id) await admin.from("brand_knowledge_docs").delete().eq("id", existing.id);
      const { data: doc, error: docErr } = await admin.from("brand_knowledge_docs").insert({
        brand_id: brandId, title: cleanTitle.slice(0, 300), category,
        source_type: it.kind === "news" ? "news" : "url", source_url: it.url,
        content: text, char_count: text.length, chunk_count: chunks.length,
        status: "ready", content_hash: hash,
      }).select("id").single();
      if (docErr || !doc) throw new Error(`doc insert: ${docErr?.message}`);

      const rows = chunks.map((c, i) => ({ doc_id: doc.id, brand_id: brandId, chunk_index: i, content: c, token_count: Math.round(c.length / 4), embedding: embeddings[i] }));
      const { error: insErr } = await admin.from("brand_knowledge_chunks").insert(rows);
      if (insErr) { await admin.from("brand_knowledge_docs").delete().eq("id", doc.id); throw new Error(`chunk insert: ${insErr.message}`); }

      await mark(admin, it.id, "done", hash, doc.id);
      done++;
    } catch (e) {
      await admin.from("knowledge_crawl_queue").update({ status: "error", error: String(e instanceof Error ? e.message : e).slice(0, 400), processed_at: new Date().toISOString() }).eq("id", it.id);
      errored++;
    }
  }

  const { count } = await admin.from("knowledge_crawl_queue").select("id", { count: "exact", head: true }).eq("brand_id", brandId).eq("status", "pending");
  return jsonOk({ brand_id: brandId, claimed: items.length, done, unchanged, skipped, errored, remaining: count ?? 0 });
});

async function mark(admin: ReturnType<typeof createClient>, id: string, status: string, hash: string | null, docId: string | null) {
  await admin.from("knowledge_crawl_queue").update({ status, content_hash: hash, doc_id: docId, error: null, processed_at: new Date().toISOString() }).eq("id", id);
}

function jsonOk(b: unknown) { return new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json", ...CORS } }); }
function jsonError(m: string, s: number) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json", ...CORS } }); }
