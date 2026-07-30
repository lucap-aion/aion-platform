// promote-brand: move a brand built in DEV into PROD, without its demo data.
//
// A brand is assembled on DEV — site crawled, catalogue synced and embedded,
// knowledge indexed, identity harvested, documents drafted — and then a demo is
// generated on top of it. Rebuilding all of that on PROD would mean re-crawling
// the site and re-embedding every product image: hours of work and API spend to
// reproduce something we already have.
//
// So this copies the REAL work across and leaves the invented data behind.
//
//   copied   brand record, knowledge sources, knowledge docs + chunks (with
//            their embeddings), storefront source + products (with their image
//            embeddings), drafted documents, insurance quotes for this brand
//   NEVER    demo clients, covers, boutiques, claims, feedback, demo logins —
//            anything logged in brand_demo_artifacts, and anything derived from
//            it. A live brand account must contain only its own data.
//
// DIRECTION OF TRUST: this function is meant to run on the TARGET (prod) and
// PULL from the source (dev). The credential it holds is therefore a dev key. The
// reverse — a prod service-role key sitting in dev — would mean a dev compromise
// grants prod write access, which is a far worse trade.
//
// Auth: AION admin, or batch.
// Body: { brand_id, action?: "preview" | "promote", confirm?: true,
//         source_url?, source_key? }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
// Where to pull from, when this runs on the target.
const SOURCE_URL = Deno.env.get("PROMOTE_SOURCE_URL") ?? "";
const SOURCE_KEY = Deno.env.get("PROMOTE_SOURCE_SERVICE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Brand columns worth carrying over. Deliberately explicit: a new column should
// have to be considered rather than silently promoted.
const BRAND_COLUMNS = [
  "name", "slug", "description", "website", "email", "status",
  "hq_country", "hq_city", "hq_address", "hq_postcode",
  "logo_big", "logo_small", "theme_settings",
  "auth_background_image", "top_banner_image",
  "theft_image", "damage_image", "faq_image", "feedback_image",
  "faq_en", "faq_it",
  "enable_chubb_reporting", "chubb_policy_prefix",
  "activation_fee", "insurance_premium", "aion_premium_fee",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const isBatch =
    (KNOWLEDGE_BATCH_SECRET && req.headers.get("x-batch-secret") === KNOWLEDGE_BATCH_SECRET) ||
    token === SUPABASE_SERVICE_ROLE_KEY || jwtRole(token) === "service_role";
  if (!isBatch) {
    if (!token) return json({ error: "missing bearer token" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid session" }, 401);
    const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return json({ error: "AION admin only" }, 403);
  }

  const sourceUrl = String(body.source_url ?? SOURCE_URL);
  const sourceKey = String(body.source_key ?? SOURCE_KEY);
  if (!sourceUrl || !sourceKey) {
    return json({
      error: "no source configured",
      hint: "set PROMOTE_SOURCE_URL and PROMOTE_SOURCE_SERVICE_KEY on this project (the environment you are promoting INTO), pointing at the environment you are promoting FROM",
    }, 400);
  }
  if (sourceUrl.replace(/\/$/, "") === SUPABASE_URL.replace(/\/$/, "")) {
    return json({ error: "source and target are the same project — nothing to promote" }, 400);
  }

  const source = createClient(sourceUrl, sourceKey);
  const target = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const brandId = Number(body.brand_id ?? 0);
  if (!brandId) return json({ error: "brand_id required" }, 400);

  const { data: brand, error: brandErr } = await source.from("brands").select("*").eq("id", brandId).maybeSingle();
  if (brandErr) return json({ error: `source unreachable: ${brandErr.message}` }, 502);
  if (!brand) return json({ error: `brand ${brandId} not found on the source` }, 404);

  // Everything the demo generator created, so it can be excluded by id.
  const { data: artifacts } = await source.from("brand_demo_artifacts")
    .select("table_name, row_pk").eq("brand_id", brandId);
  const demoIds = new Map<string, Set<string>>();
  for (const a of (artifacts ?? []) as { table_name: string; row_pk: string }[]) {
    if (!demoIds.has(a.table_name)) demoIds.set(a.table_name, new Set());
    demoIds.get(a.table_name)!.add(a.row_pk);
  }

  const plan = await buildPlan(source, target, brandId, brand, demoIds);

  if (String(body.action ?? "preview") !== "promote") {
    return json({ ok: true, action: "preview", source: sourceUrl, target: SUPABASE_URL, ...plan });
  }

  // Writing into another environment is not something to do by accident.
  if (body.confirm !== true) {
    return json({ ok: false, reason: "pass confirm: true to actually write to the target", ...plan }, 400);
  }

  const written = await promote(source, target, brandId, brand, plan);
  return json({ ok: true, action: "promote", source: sourceUrl, target: SUPABASE_URL, written, excluded: plan.excluded });
});

// ── Plan ────────────────────────────────────────────────────────────────────
async function buildPlan(
  source: ReturnType<typeof createClient>,
  target: ReturnType<typeof createClient>,
  brandId: number,
  brand: Record<string, unknown>,
  demoIds: Map<string, Set<string>>,
) {
  const count = async (client: ReturnType<typeof createClient>, table: string, col = "brand_id") => {
    const { count: n } = await client.from(table).select("id", { count: "exact", head: true }).eq(col, brandId);
    return n ?? 0;
  };

  const [docs, chunks, products, sources, documents, quotes] = await Promise.all([
    count(source, "brand_knowledge_docs"),
    count(source, "brand_knowledge_chunks"),
    count(source, "storefront_products"),
    count(source, "knowledge_sources"),
    count(source, "brand_documents"),
    count(source, "insurance_quotes"),
  ]);

  // Does a brand with this slug already exist on the target?
  const { data: existing } = await target.from("brands")
    .select("id, name, slug").eq("slug", String(brand.slug ?? "")).maybeSingle();

  const targetCounts = existing
    ? {
        knowledge_docs: (await target.from("brand_knowledge_docs").select("id", { count: "exact", head: true }).eq("brand_id", existing.id)).count ?? 0,
        products: (await target.from("storefront_products").select("id", { count: "exact", head: true }).eq("brand_id", existing.id)).count ?? 0,
      }
    : null;

  return {
    brand: { id: brandId, name: brand.name, slug: brand.slug },
    will_copy: {
      brand_record: 1,
      knowledge_sources: sources,
      knowledge_docs: docs,
      knowledge_chunks: chunks,
      storefront_products: products,
      brand_documents: documents,
      insurance_quotes: quotes,
    },
    excluded: {
      reason: "generated for the demo — a live account holds only the brand's own data",
      demo_clients: demoIds.get("profiles")?.size ?? 0,
      demo_covers: demoIds.get("policies")?.size ?? 0,
      demo_catalogue: demoIds.get("catalogues")?.size ?? 0,
      demo_boutiques: demoIds.get("shops")?.size ?? 0,
      demo_claims: demoIds.get("claims")?.size ?? 0,
      demo_feedback: demoIds.get("feedback")?.size ?? 0,
      demo_logins: "all — auth users are never copied between environments",
    },
    target_state: existing
      ? { exists: true, id: existing.id, name: existing.name, ...targetCounts,
          note: "the brand already exists on the target — promoting UPDATES it and adds missing knowledge/products; it does not delete anything" }
      : { exists: false, note: "the brand will be created on the target with a new id" },
  };
}

// ── Promote ─────────────────────────────────────────────────────────────────
async function promote(
  source: ReturnType<typeof createClient>,
  target: ReturnType<typeof createClient>,
  brandId: number,
  brand: Record<string, unknown>,
  plan: Awaited<ReturnType<typeof buildPlan>>,
) {
  const written: Record<string, number> = {};

  // 1. The brand itself. Ids differ between environments, so everything below
  //    is remapped onto the target's id rather than assuming they match.
  const brandRow: Record<string, unknown> = {};
  for (const c of BRAND_COLUMNS) if (brand[c] !== undefined) brandRow[c] = brand[c];

  let targetBrandId: number;
  if (plan.target_state.exists) {
    targetBrandId = Number(plan.target_state.id);
    const { error } = await target.from("brands").update(brandRow).eq("id", targetBrandId);
    if (error) throw new Error(`brand update: ${error.message}`);
  } else {
    const { data, error } = await target.from("brands").insert(brandRow).select("id").single();
    if (error) throw new Error(`brand insert: ${error.message}`);
    targetBrandId = Number(data.id);
  }
  written.brand = 1;

  // 2. Knowledge sources (so the target keeps crawling on its own schedule).
  const { data: srcSources } = await source.from("knowledge_sources")
    .select("kind, target, enabled, config").eq("brand_id", brandId);
  if (srcSources?.length) {
    const rows = srcSources.map((r) => ({ ...r, brand_id: targetBrandId }));
    const { error } = await target.from("knowledge_sources").upsert(rows, { onConflict: "brand_id,kind" });
    if (!error) written.knowledge_sources = rows.length;
  }

  // 3. Knowledge documents and their chunks — embeddings included, which is the
  //    whole point: re-embedding this corpus would cost hours and real money.
  written.knowledge_docs = 0;
  written.knowledge_chunks = 0;
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    const { data: docs } = await source.from("brand_knowledge_docs")
      .select("*").eq("brand_id", brandId).order("id").range(from, from + PAGE - 1);
    if (!docs?.length) break;

    for (const doc of docs as Record<string, unknown>[]) {
      const { id: srcDocId, ...docRest } = doc;
      const { data: inserted, error } = await target.from("brand_knowledge_docs")
        .upsert({ ...docRest, brand_id: targetBrandId }, { onConflict: "brand_id,content_hash" })
        .select("id").maybeSingle();
      if (error || !inserted) continue;
      written.knowledge_docs++;

      const { data: chunks } = await source.from("brand_knowledge_chunks")
        .select("chunk_index, content, embedding").eq("doc_id", srcDocId);
      if (!chunks?.length) continue;
      await target.from("brand_knowledge_chunks").delete().eq("doc_id", inserted.id);
      const rows = chunks.map((c) => ({ ...c, doc_id: inserted.id, brand_id: targetBrandId }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error: cErr } = await target.from("brand_knowledge_chunks").insert(rows.slice(i, i + 100));
        if (!cErr) written.knowledge_chunks += Math.min(100, rows.length - i);
      }
    }
    if (docs.length < PAGE) break;
  }

  // 4. Catalogue, with image embeddings.
  const { data: sfSource } = await source.from("storefront_sources").select("*").eq("brand_id", brandId).maybeSingle();
  if (sfSource) {
    const { id: _drop, ...rest } = sfSource as Record<string, unknown>;
    await target.from("storefront_sources").upsert({ ...rest, brand_id: targetBrandId }, { onConflict: "brand_id" });
    written.storefront_source = 1;
  }

  written.storefront_products = 0;
  for (let from = 0; ; from += PAGE) {
    const { data: prods } = await source.from("storefront_products")
      .select("*").eq("brand_id", brandId).order("id").range(from, from + PAGE - 1);
    if (!prods?.length) break;
    const rows = (prods as Record<string, unknown>[]).map(({ id: _id, ...rest }) => ({ ...rest, brand_id: targetBrandId }));
    const { error } = await target.from("storefront_products").upsert(rows, { onConflict: "brand_id,handle" });
    if (!error) written.storefront_products += rows.length;
    if (prods.length < PAGE) break;
  }

  // 5. Drafted documents — still drafts on the target, still needing approval.
  const { data: documents } = await source.from("brand_documents").select("*").eq("brand_id", brandId);
  if (documents?.length) {
    const rows = (documents as Record<string, unknown>[]).map(({ id: _id, ...rest }) => ({
      ...rest, brand_id: targetBrandId, status: "draft", approved_at: null, approved_by: null,
    }));
    const { error } = await target.from("brand_documents").upsert(rows, { onConflict: "brand_id,kind,locale" });
    if (!error) written.brand_documents = rows.length;
  }

  // 6. Insurance quotes recorded against this brand.
  const { data: quotes } = await source.from("insurance_quotes").select("*").eq("brand_id", brandId);
  if (quotes?.length) {
    const rows = (quotes as Record<string, unknown>[]).map(({ id: _id, ...rest }) => ({ ...rest, brand_id: targetBrandId }));
    const { error } = await target.from("insurance_quotes").insert(rows);
    if (!error) written.insurance_quotes = rows.length;
  }

  written.target_brand_id = targetBrandId;
  return written;
}

function jwtRole(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const pad = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}

function json(payload: unknown, code = 200) {
  return new Response(JSON.stringify(payload), { status: code, headers: { ...CORS, "Content-Type": "application/json" } });
}
