// parse-knowledge: turn an uploaded FILE into brand knowledge. The browser
// uploads the raw file to the `brand-knowledge-uploads` Storage bucket (keyed
// {brand_id}/{uuid}.{ext}) and then calls this function with the storage path.
// We download it with the service role, extract its text (PDF / DOCX / PPTX /
// TXT / MD / CSV), then chunk + embed + store it into brand_knowledge_docs /
// brand_knowledge_chunks exactly like ingest-knowledge — source_type='upload'.
//
// Brand callers are pinned to their own brand; admins may pass brand_id. The
// storage path's first segment MUST equal the resolved brand — the service-role
// download bypasses RLS, so we re-check ownership here in defense of depth.
//
// Body: { storage_path, filename?, title?, category?, description?, brand_id? }
// Returns: { doc_id, chunk_count, char_count, status }

import { createClient } from "npm:@supabase/supabase-js@2";
import { originAllowed, originRefused } from "../_shared/origin.ts";
import { chunkText, embedDocuments } from "../_shared/crawl.ts";
import { extractByType } from "../_shared/extract-text.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

const BUCKET = "brand-knowledge-uploads";
const MAX_CONTENT_CHARS = 400_000; // ~100k tokens; truncate beyond this.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB raw file ceiling.
const MIN_TEXT_CHARS = 20; // below this we treat the file as "no extractable text".

const VALID_CATEGORIES = ["product", "storytelling", "policy", "training", "other"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Refuse a browser origin that isn't ours before doing anything else.
  if (!originAllowed(req)) return originRefused();

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("missing bearer token", 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonError("invalid session", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const storagePath = String(body.storage_path ?? "").trim();
  const filename = String(body.filename ?? storagePath.split("/").pop() ?? "document").trim();
  const category = VALID_CATEGORIES.includes(String(body.category)) ? String(body.category) : "other";
  const titleInput = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim().slice(0, 1000);
  // Ephemeral: extract the text, hand it back, keep nothing. This is how an
  // associate asks a question ABOUT a file — a client brief, a supplier quote —
  // without it becoming part of the brand's permanent knowledge.
  const ephemeral = body.ephemeral === true;
  if (!storagePath) return jsonError("storage_path is required", 400);

  // Resolve brand scope + the caller's profile id, same as ingest-knowledge.
  let brandId: number | null = null;
  let profileId: string | null = null;

  const { data: adminRow } = await userClient
    .from("admins").select("id").eq("user_id", user.id).maybeSingle();

  if (adminRow) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
  } else {
    const { data: profileRow } = await userClient
      .from("profiles").select("id, brand_id, role, is_master")
      .eq("user_id", user.id)
      .in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
    if (!profileRow?.brand_id) return jsonError("admin or brand role required", 403);
    // Only brand admins / master users may change the knowledge base. The UI
    // hides these controls from everyone else, but a hidden button is not a
    // permission: three of the five write paths accepted any brand login
    // straight from the API. Same rule update-knowledge already enforces.
    //
    // An ephemeral read is NOT a knowledge change — nothing is indexed and
    // nothing is kept — so it is not gated. Asking a question about your own
    // file should not require permission to alter the brand's knowledge.
    if (!ephemeral && !(profileRow.role === "brand_admin" || profileRow.is_master)) {
      return jsonError("insufficient permissions", 403);
    }
    brandId = profileRow.brand_id as number;
    profileId = profileRow.id as string;
  }

  // Ownership check: the path MUST live under this brand's prefix. Prevents a
  // caller from pointing the service-role download at another brand's object.
  if ((storagePath.split("/")[0] ?? "") !== String(brandId)) {
    return jsonError("storage_path does not belong to this brand", 403);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Download the raw file (service role — bypasses Storage RLS).
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath);
  if (dlErr || !blob) return jsonError(`could not read the uploaded file: ${dlErr?.message ?? "not found"}`, 404);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) return jsonError("the uploaded file is empty", 400);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return jsonError(`file too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB)`, 413);
  }

  // 2) Extract text by file type.
  let content: string;
  try {
    content = await extractByType(filename, bytes);
  } catch (e) {
    console.error("[parse-knowledge extract]", e);
    return jsonError(`couldn't read this file: ${e instanceof Error ? e.message : "unknown"}`, 422);
  }
  content = content.replace(/\u0000/g, "").replace(/\uFEFF/g, "").trim();
  if (content.length < MIN_TEXT_CHARS) {
    return jsonError(
      "no readable text found in this file — a scanned or image-only document can't be indexed as text.",
      422,
    );
  }
  let truncated = false;
  if (content.length > MAX_CONTENT_CHARS) { content = content.slice(0, MAX_CONTENT_CHARS); truncated = true; }

  const title = (titleInput || filename.replace(/\.[a-z0-9]+$/i, "")).slice(0, 300) || "Document";

  if (ephemeral) {
    // Remove the raw upload immediately: a one-off document the brand did not
    // choose to keep should not linger in storage.
    await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return jsonOk({
      ephemeral: true,
      title,
      filename,
      char_count: content.length,
      truncated,
      text: content,
      note: "Not indexed — this text was returned for a single conversation and nothing was stored.",
    });
  }

  // The uploader's note goes INTO the text, at the top, before chunking. A file
  // called "Protocollo_v3_FINAL.pdf" tells the assistant nothing about when to
  // reach for it; the sentence the uploader wrote usually tells it everything —
  // and it is often the only place the document's own name appears in prose.
  if (description) {
    content = `${title}\n${description}\n\n${content}`.slice(0, MAX_CONTENT_CHARS);
  }

  // 3) Create the doc row up front (status='processing'), then embed. Same
  //    lifecycle as ingest-knowledge so the UI shows it immediately.
  const { data: doc, error: docErr } = await admin
    .from("brand_knowledge_docs")
    .insert({
      brand_id: brandId, title, category, description: description || null,
      source_type: "upload", source_url: storagePath,
      content, char_count: content.length, status: "processing", created_by: profileId,
    })
    .select("id").single();
  if (docErr || !doc) return jsonError(`could not create doc: ${docErr?.message}`, 500);
  const docId = doc.id as string;

  try {
    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error("no chunkable content");
    const embeddings = await embedDocuments(chunks, VOYAGE_API_KEY);

    const rows = chunks.map((c, i) => ({
      doc_id: docId, brand_id: brandId, chunk_index: i, content: c,
      token_count: Math.round(c.length / 4), embedding: embeddings[i],
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await admin.from("brand_knowledge_chunks").insert(rows.slice(i, i + 200));
      if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);
    }

    await admin.from("brand_knowledge_docs")
      .update({ status: "ready", chunk_count: chunks.length, error: null })
      .eq("id", docId);

    return jsonOk({ doc_id: docId, chunk_count: chunks.length, char_count: content.length, status: "ready", truncated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[parse-knowledge]", message);
    await admin.from("brand_knowledge_docs").update({ status: "error", error: message.slice(0, 500) }).eq("id", docId);
    await admin.from("brand_knowledge_chunks").delete().eq("doc_id", docId);
    return jsonError(`indexing failed: ${message}`, 500);
  }
});

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
