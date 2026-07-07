// import-cards: turn spreadsheet rows into brand knowledge "cards" — one doc per
// row (e.g. a client card or a product card) — chunked + embedded so the
// assistant can retrieve them by name. Generalises the pattern where a brand's
// clients/products live in the knowledge base rather than the SQL CRM.
//
// The browser parses the sheet, maps a title column, and builds each card's
// text; this fn just persists them (bulk, one embedding pass).
//
// Brand admins / master users only (admins pass brand_id).
// Body: { category?, source_label?, cards: [{ title, content }], brand_id? }
// Returns: { docs_created, chunks_created }

import { createClient } from "npm:@supabase/supabase-js@2";
import { chunkText, embedDocuments } from "../_shared/crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

const MAX_CARDS = 2000;
const MAX_CARD_CHARS = 8000;
const MAX_TOTAL_CHUNKS = 6000;
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
  const category = VALID_CATEGORIES.includes(String(body.category)) ? String(body.category) : "other";
  const sourceLabel = body.source_label ? String(body.source_label).slice(0, 200) : null;

  const rawCards = Array.isArray(body.cards) ? body.cards : [];
  const cards = rawCards
    .map((c) => ({
      title: String((c as { title?: unknown })?.title ?? "").trim().slice(0, 300),
      content: String((c as { content?: unknown })?.content ?? "").trim().slice(0, MAX_CARD_CHARS),
    }))
    .filter((c) => c.title || c.content);
  if (cards.length === 0) return jsonError("no cards to import", 400);
  if (cards.length > MAX_CARDS) return jsonError(`too many rows (max ${MAX_CARDS})`, 413);

  // Resolve brand scope + require a write role.
  let brandId: number | null = null;
  let profileId: string | null = null;
  const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
  if (adminRow) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
  } else {
    const { data: p } = await userClient.from("profiles").select("id, brand_id, role, is_master")
      .eq("user_id", user.id).in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
    if (!p?.brand_id) return jsonError("admin or brand role required", 403);
    if (!(p.role === "brand_admin" || (p.role === "brand_user" && p.is_master))) return jsonError("insufficient permissions", 403);
    brandId = p.brand_id as number;
    profileId = p.id as string;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Chunk every card up front (cards are small — usually 1 chunk each).
  const perCard = cards.map((c) => {
    const text = c.title ? `${c.title}\n${c.content}` : c.content;
    return { title: c.title || text.slice(0, 60), content: text, chunks: chunkText(text) };
  });
  const totalChunks = perCard.reduce((s, c) => s + c.chunks.length, 0);
  if (totalChunks === 0) return jsonError("nothing to index", 400);
  if (totalChunks > MAX_TOTAL_CHUNKS) return jsonError(`too much content (max ${MAX_TOTAL_CHUNKS} sections)`, 413);

  try {
    // Embed all chunks in one batched pass.
    const flatChunks = perCard.flatMap((c) => c.chunks);
    const embeddings = await embedDocuments(flatChunks, VOYAGE_API_KEY);

    // Bulk-insert the docs; a single INSERT returns rows in VALUES order.
    const docRows = perCard.map((c) => ({
      brand_id: brandId, title: c.title.slice(0, 300), category,
      source_type: "import", source_url: sourceLabel,
      content: c.content, char_count: c.content.length, chunk_count: c.chunks.length,
      status: "ready", created_by: profileId,
    }));
    const insertedIds: string[] = [];
    for (let i = 0; i < docRows.length; i += 500) {
      const { data, error } = await admin.from("brand_knowledge_docs").insert(docRows.slice(i, i + 500)).select("id");
      if (error) throw new Error(`doc insert failed: ${error.message}`);
      for (const d of (data ?? [])) insertedIds.push((d as { id: string }).id);
    }
    if (insertedIds.length !== perCard.length) throw new Error("doc id count mismatch");

    // Build + insert chunk rows aligned to the flat embedding list.
    const chunkRows: Record<string, unknown>[] = [];
    let g = 0;
    perCard.forEach((c, i) => {
      c.chunks.forEach((ch, j) => {
        chunkRows.push({ doc_id: insertedIds[i], brand_id: brandId, chunk_index: j, content: ch, token_count: Math.round(ch.length / 4), embedding: embeddings[g++] });
      });
    });
    for (let i = 0; i < chunkRows.length; i += 200) {
      const { error } = await admin.from("brand_knowledge_chunks").insert(chunkRows.slice(i, i + 200));
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    }

    return jsonOk({ docs_created: insertedIds.length, chunks_created: chunkRows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[import-cards]", message);
    return jsonError(`import failed: ${message}`, 500);
  }
});

function jsonOk(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...CORS } }); }
function jsonError(message: string, status: number) { return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json", ...CORS } }); }
