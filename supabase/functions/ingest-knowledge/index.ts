// ingest-knowledge: chunk a brand document, embed each chunk with Voyage AI,
// and store both the doc and its chunks for the sales-assistant RAG layer.
//
// Brand callers are pinned to their own brand; admins may pass `brand_id`.
// Writes use the service role (RLS on the knowledge tables is read-only for
// authenticated users), but the brand scope is resolved from the caller's JWT
// so a brand user can never ingest into another brand.
//
// Body: { title, content, category?, source_type?, source_url?, brand_id? }
// Returns: { doc_id, chunk_count, char_count, status }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

const EMBED_MODEL = "voyage-3.5";
const EMBED_DIMS = 1024;
// Voyage caps batch requests; 128 inputs per call is comfortably under.
const EMBED_BATCH = 128;
// ~1000 chars ≈ 250 tokens — small enough for precise retrieval, large enough
// to keep a coherent idea in one chunk. 150 char overlap preserves context
// across boundaries.
const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 150;
const MAX_CONTENT_CHARS = 400_000; // ~100k tokens; refuse anything larger.

const VALID_CATEGORIES = ["product", "storytelling", "policy", "training", "other"];
const VALID_SOURCE_TYPES = ["manual", "upload", "url"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
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
  const title = String(body.title ?? "").trim();
  const content = String(body.content ?? "").trim();
  const category = VALID_CATEGORIES.includes(String(body.category))
    ? String(body.category)
    : "other";
  const sourceType = VALID_SOURCE_TYPES.includes(String(body.source_type))
    ? String(body.source_type)
    : "manual";
  const sourceUrl = body.source_url ? String(body.source_url).slice(0, 2000) : null;

  if (!title) return jsonError("title is required", 400);
  if (!content) return jsonError("content is required", 400);
  if (content.length > MAX_CONTENT_CHARS) {
    return jsonError(`content too large (max ${MAX_CONTENT_CHARS} chars)`, 413);
  }

  // Resolve brand scope + the caller's profile id. Admins may target any brand
  // via brand_id; brand users are pinned to their own brand.
  let brandId: number | null = null;
  let profileId: string | null = null;

  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminRow) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
  } else {
    const { data: profileRow } = await userClient
      .from("profiles")
      .select("id, brand_id, role")
      .eq("user_id", user.id)
      .in("role", ["brand", "brand_admin", "brand_user"])
      .maybeSingle();
    if (!profileRow?.brand_id) return jsonError("admin or brand role required", 403);
    brandId = profileRow.brand_id as number;
    profileId = profileRow.id as string;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create the doc row up front so it's visible (status='processing') while we
  // embed; on failure we mark it 'error' instead of leaving an orphan.
  const { data: doc, error: docErr } = await admin
    .from("brand_knowledge_docs")
    .insert({
      brand_id: brandId,
      title,
      category,
      source_type: sourceType,
      source_url: sourceUrl,
      content,
      char_count: content.length,
      status: "processing",
      created_by: profileId,
    })
    .select("id")
    .single();

  if (docErr || !doc) return jsonError(`could not create doc: ${docErr?.message}`, 500);
  const docId = doc.id as string;

  try {
    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error("no chunkable content");

    const embeddings = await embedDocuments(chunks);

    const rows = chunks.map((c, i) => ({
      doc_id: docId,
      brand_id: brandId,
      chunk_index: i,
      content: c,
      token_count: Math.round(c.length / 4),
      embedding: embeddings[i],
    }));

    // Insert in batches to stay under statement/size limits.
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await admin
        .from("brand_knowledge_chunks")
        .insert(rows.slice(i, i + 200));
      if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);
    }

    await admin
      .from("brand_knowledge_docs")
      .update({ status: "ready", chunk_count: chunks.length, error: null })
      .eq("id", docId);

    return jsonOk({
      doc_id: docId,
      chunk_count: chunks.length,
      char_count: content.length,
      status: "ready",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[ingest-knowledge]", message);
    await admin
      .from("brand_knowledge_docs")
      .update({ status: "error", error: message.slice(0, 500) })
      .eq("id", docId);
    // Drop any partial chunks so a retry starts clean.
    await admin.from("brand_knowledge_chunks").delete().eq("doc_id", docId);
    return jsonError(`ingestion failed: ${message}`, 500);
  }
});

// ── Chunking: split on paragraph boundaries, pack up to CHUNK_CHARS, carry a
// small overlap so a sentence cut across a boundary still has context.
function chunkText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const paragraphs = normalised.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };

  for (const para of paragraphs) {
    // A single oversized paragraph is hard-split by characters.
    if (para.length > CHUNK_CHARS) {
      push();
      for (let i = 0; i < para.length; i += CHUNK_CHARS - CHUNK_OVERLAP) {
        chunks.push(para.slice(i, i + CHUNK_CHARS).trim());
      }
      continue;
    }
    if (current.length + para.length + 2 > CHUNK_CHARS) {
      const tail = current.slice(-CHUNK_OVERLAP);
      push();
      current = tail ? `${tail}\n\n${para}` : para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  push();
  return chunks;
}

// ── Voyage embeddings. input_type 'document' is the indexing-side variant;
// the assistant embeds queries with input_type 'query'.
async function embedDocuments(inputs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH);
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: batch,
        model: EMBED_MODEL,
        input_type: "document",
        output_dimension: EMBED_DIMS,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Voyage embed failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const d of data) out.push(d.embedding as number[]);
  }
  if (out.length !== inputs.length) {
    throw new Error(`embedding count mismatch: ${out.length} vs ${inputs.length}`);
  }
  return out;
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
