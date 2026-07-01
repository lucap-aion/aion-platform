// index-catalogue-images: embed a brand's catalogue product photos with Voyage
// multimodal so the assistant can do visual search (photo of a piece → the exact
// catalogue item). Image and text land in the SAME vector space, so a photo
// query matches the stored product images directly.
//
// Idempotent + resumable: only items whose photo isn't embedded yet (or whose
// picture URL changed) are (re)embedded, unless `force` is set. Processes at
// most MAX_PER_RUN items per call and returns `remaining` so a caller/cron can
// loop until done.
//
// Auth: an admin session, OR the service-role key as bearer (for backfill/cron).
// Body: { brand_id?, force?, max? }
// Returns: { brand_id, indexed, skipped, failed, remaining, done }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
// Shared secret for cron/batch callers (same one the crawl pipeline uses).
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";

const EMBED_MODEL = "voyage-multimodal-3.5";
const EMBED_DIMS = 1024;
// Voyage fetches each image URL itself, so keep batches modest to stay well
// inside the function's wall-clock and Voyage's per-request limits.
const EMBED_BATCH = 8;
const MAX_PER_RUN = 200;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Item = { id: number; picture: string; brand_id: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Authorize. A batch caller (cron) presents the shared x-batch-secret; a
  // service-role caller (backfill) presents the service key; otherwise the
  // caller must be a signed-in admin. Brand users don't manage the index.
  const batchSecret = req.headers.get("x-batch-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const isBatch = KNOWLEDGE_BATCH_SECRET.length > 0 && batchSecret === KNOWLEDGE_BATCH_SECRET;
  // Detect the service role from the JWT role claim (robust to key format) and,
  // as a fallback, exact-match the injected env key.
  const isServiceRole = token !== "" && (token === SUPABASE_SERVICE_ROLE_KEY || jwtRole(token) === "service_role");
  if (!isBatch && !isServiceRole) {
    if (!token) return jsonError("missing bearer token", 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonError("invalid session", 401);
    const { data: adminRow } = await userClient
      .from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return jsonError("admin required", 403);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const brandId = Number(body.brand_id ?? 0) || null;
  const force = body.force === true;
  const max = Math.min(Number(body.max ?? MAX_PER_RUN) || MAX_PER_RUN, MAX_PER_RUN);

  try {
    // 1. Candidate catalogue items (have a photo).
    let q = admin.from("catalogues").select("id, picture, brand_id").not("picture", "is", null);
    if (brandId) q = q.eq("brand_id", brandId);
    const { data: catRows, error: catErr } = await q;
    if (catErr) throw new Error(`catalogues: ${catErr.message}`);
    const candidates = ((catRows ?? []) as Item[]).filter(
      (r) => typeof r.picture === "string" && /^https?:\/\//i.test(r.picture),
    );

    // 2. What's already indexed (to skip unchanged photos).
    let eq = admin.from("catalogue_image_embeddings").select("catalogue_id, picture_url");
    if (brandId) eq = eq.eq("brand_id", brandId);
    const { data: existRows, error: existErr } = await eq;
    if (existErr) throw new Error(`embeddings: ${existErr.message}`);
    const existing = new Map<number, string>();
    for (const r of (existRows ?? []) as { catalogue_id: number; picture_url: string }[]) {
      existing.set(r.catalogue_id, r.picture_url);
    }

    // 3. Items needing (re)embedding.
    const todo = candidates.filter(
      (c) => force || existing.get(c.id) !== c.picture,
    );
    const remainingBefore = todo.length;
    const slice = todo.slice(0, max);

    let indexed = 0;
    let failed = 0;
    for (let i = 0; i < slice.length; i += EMBED_BATCH) {
      const batch = slice.slice(i, i + EMBED_BATCH);
      let embeddings: number[][];
      try {
        embeddings = await voyageEmbedImages(batch.map((b) => b.picture));
      } catch (e) {
        // A whole batch can fail on one bad image; fall back to one-by-one so a
        // single broken URL doesn't sink the others.
        embeddings = [];
        for (const b of batch) {
          try {
            const [emb] = await voyageEmbedImages([b.picture]);
            embeddings.push(emb);
          } catch (_e2) {
            embeddings.push([]);
          }
        }
        console.warn("[index-catalogue-images] batch fell back to singles:", e instanceof Error ? e.message : e);
      }

      const rows = batch
        .map((b, j) => ({ b, emb: embeddings[j] }))
        .filter((x) => Array.isArray(x.emb) && x.emb.length === EMBED_DIMS)
        .map((x) => ({
          catalogue_id: x.b.id,
          brand_id: x.b.brand_id,
          picture_url: x.b.picture,
          embedding: x.emb,
          model: EMBED_MODEL,
          updated_at: new Date().toISOString(),
        }));
      failed += batch.length - rows.length;

      if (rows.length) {
        const { error: upErr } = await admin
          .from("catalogue_image_embeddings")
          .upsert(rows, { onConflict: "catalogue_id" });
        if (upErr) throw new Error(`upsert: ${upErr.message}`);
        indexed += rows.length;
      }
    }

    const remaining = Math.max(0, remainingBefore - indexed - failed);
    return json({
      brand_id: brandId,
      indexed,
      skipped: candidates.length - remainingBefore,
      failed,
      remaining,
      done: remaining === 0,
    });
  } catch (err) {
    console.error("[index-catalogue-images]", err);
    return jsonError(err instanceof Error ? err.message : "internal error", 500);
  }
});

// Embed product images with Voyage multimodal. input_type "document" — these are
// the corpus the photo query is matched against. Returns embeddings in input
// order (empty array in a slot Voyage couldn't return).
async function voyageEmbedImages(urls: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: urls.map((u) => ({ content: [{ type: "image_url", image_url: u }] })),
      model: EMBED_MODEL,
      input_type: "document",
      output_dimension: EMBED_DIMS,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage multimodal ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const json = await res.json();
  const data = (json?.data ?? []) as { embedding?: number[]; index?: number }[];
  // Preserve request order; Voyage returns items in order, but honour index if present.
  const out: number[][] = urls.map(() => []);
  data.forEach((d, i) => {
    const idx = Number.isInteger(d.index) ? (d.index as number) : i;
    if (Array.isArray(d.embedding)) out[idx] = d.embedding;
  });
  return out;
}

// Best-effort decode of a JWT's `role` claim (no signature check — the platform
// already verified the token before it reached us).
function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}
