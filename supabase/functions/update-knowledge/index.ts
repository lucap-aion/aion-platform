// update-knowledge: edit an existing brand knowledge doc. Title/category are a
// plain metadata update; when the CONTENT changes we re-chunk + re-embed and
// replace the doc's chunks so retrieval stays in sync (raw client updates can't
// do that, which is why all doc edits route through here).
//
// Brand callers are pinned to their own brand; admins pass brand_id. Writes use
// the service role, but the doc is verified to belong to the caller's brand.
//
// Body: { doc_id, title?, category?, content?, brand_id? }
// Returns: { doc_id, chunk_count, char_count, status, reembedded }

import { createClient } from "npm:@supabase/supabase-js@2";
import { chunkText, embedDocuments } from "../_shared/crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

const MAX_CONTENT_CHARS = 400_000;
const VALID_CATEGORIES = ["product", "storytelling", "policy", "training", "news", "other"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("missing bearer token", 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonError("invalid session", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const docId = String(body.doc_id ?? "").trim();
  if (!docId) return jsonError("doc_id is required", 400);
  const newTitle = body.title != null ? String(body.title).trim().slice(0, 300) : undefined;
  const newCategory = body.category != null && VALID_CATEGORIES.includes(String(body.category)) ? String(body.category) : undefined;
  let newContent = body.content != null ? String(body.content) : undefined;
  if (newContent != null && newContent.length > MAX_CONTENT_CHARS) newContent = newContent.slice(0, MAX_CONTENT_CHARS);

  // Resolve brand scope.
  let brandId: number | null = null;
  const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
  if (adminRow) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
  } else {
    const { data: p } = await userClient.from("profiles").select("brand_id, role, is_master")
      .eq("user_id", user.id).in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
    if (!p?.brand_id) return jsonError("admin or brand role required", 403);
    // Only brand admins / master users may edit knowledge.
    if (!(p.role === "brand_admin" || (p.role === "brand_user" && p.is_master))) {
      return jsonError("insufficient permissions", 403);
    }
    brandId = p.brand_id as number;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify the doc belongs to this brand.
  const { data: doc, error: docErr } = await admin
    .from("brand_knowledge_docs").select("id, brand_id, content").eq("id", docId).maybeSingle();
  if (docErr || !doc) return jsonError("document not found", 404);
  if ((doc.brand_id as number) !== brandId) return jsonError("document does not belong to this brand", 403);

  const contentChanged = newContent != null && newContent.trim() !== String(doc.content ?? "").trim();

  // Metadata-only update (no content change) → simple patch.
  if (!contentChanged) {
    const patch: Record<string, unknown> = {};
    if (newTitle !== undefined) patch.title = newTitle;
    if (newCategory !== undefined) patch.category = newCategory;
    if (Object.keys(patch).length === 0) return jsonError("nothing to update", 400);
    const { error } = await admin.from("brand_knowledge_docs").update(patch).eq("id", docId);
    if (error) return jsonError(`update failed: ${error.message}`, 500);
    return jsonOk({ doc_id: docId, reembedded: false, status: "ready" });
  }

  // Content changed → re-chunk + re-embed + replace chunks.
  const content = newContent!.trim();
  if (!content) return jsonError("content cannot be empty", 400);
  await admin.from("brand_knowledge_docs")
    .update({ title: newTitle, category: newCategory, content, char_count: content.length, status: "processing", error: null })
    .eq("id", docId);
  try {
    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error("no chunkable content");
    const embeddings = await embedDocuments(chunks, VOYAGE_API_KEY);

    // Replace chunks atomically-ish: delete old, insert new.
    await admin.from("brand_knowledge_chunks").delete().eq("doc_id", docId);
    const rows = chunks.map((c, i) => ({
      doc_id: docId, brand_id: brandId, chunk_index: i, content: c,
      token_count: Math.round(c.length / 4), embedding: embeddings[i],
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await admin.from("brand_knowledge_chunks").insert(rows.slice(i, i + 200));
      if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);
    }
    await admin.from("brand_knowledge_docs").update({ status: "ready", chunk_count: chunks.length, error: null }).eq("id", docId);
    return jsonOk({ doc_id: docId, chunk_count: chunks.length, char_count: content.length, status: "ready", reembedded: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[update-knowledge]", message);
    await admin.from("brand_knowledge_docs").update({ status: "error", error: message.slice(0, 500) }).eq("id", docId);
    return jsonError(`re-embedding failed: ${message}`, 500);
  }
});

function jsonOk(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...CORS } }); }
function jsonError(message: string, status: number) { return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json", ...CORS } }); }
