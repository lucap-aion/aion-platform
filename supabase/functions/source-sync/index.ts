// source-sync: keep the knowledge base in step with a brand's own systems —
// a Google Drive folder, a Shopify shop's pages, articles and policies.
//
// One function for both because the hard part is the same: list what the
// source holds, compare it with what we indexed last time by the item's own
// modified time (so an unchanged file is never downloaded), index what is new
// or changed, and remove what the brand removed. The listing is cheap and done
// in full on every run; the indexing is bounded by a time budget, and a run
// that stops with work left asks the tick to come back at once.
//
// Auth: an AION admin; a brand master for their own brand (the same gate every
// other knowledge write has); or the batch secret / service role (the tick).
// Body:
//   { action: "info" }                                     → AION's Drive address
//   { action: "connect_gdrive", folder, brand_id? }        → share-checked, saved
//   { action: "connect_shopify", brand_id? }               → reuse an existing shop token
//   { action: "sync", source_id } | { action: "sync", brand_id?, kind }
//   { action: "disconnect", source_id }                    → source + its documents gone

import { createClient } from "npm:@supabase/supabase-js@2";
import { originAllowed, originRefused } from "../_shared/origin.ts";
import { chunkText, embedDocuments, sha256 } from "../_shared/crawl.ts";
import { extractByType } from "../_shared/extract-text.ts";
import {
  categoryFromPath, fetchFileBytes, getFolder, listFolderTree, parseFolderId, parseServiceAccount,
  planFile, serviceAccountToken, titleFromFileName, type ListedFile,
} from "../_shared/gdrive.ts";
import {
  ARTICLES_QUERY, PAGES_QUERY, POLICIES_QUERY, SHOP_QUERY, contentScopeGaps, fetchAllPaged,
  mapArticle, mapPage, mapPolicy, shopifyGraphql,
  type ContentItem, type ShopArticle, type ShopPage, type ShopPolicy,
} from "../_shared/shopify-content.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const SERVICE_ACCOUNT = parseServiceAccount(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
const SHOPIFY_PUBLIC_APP = !!(Deno.env.get("SHOPIFY_CLIENT_ID") && Deno.env.get("SHOPIFY_CLIENT_SECRET"));

// The edge runtime stops a request at 150 s; leave room to write the outcome.
const TIME_BUDGET_MS = 110_000;
const MAX_CONTENT_CHARS = 400_000;
const MIN_TEXT_CHARS = 20;
// How often a caught-up source is read again. Drive is where people are
// actively editing; a shop's pages and policies change rarely.
const RESYNC_HOURS: Record<string, number> = { gdrive: 6, shopify: 12 };
const ERROR_RETRY_HOURS = 1;
const LOCK_MINUTES = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
const jsonError = (message: string, status: number) => json({ error: message }, status);

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null;
  } catch { return null; }
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Caller =
  | { kind: "system" }
  | { kind: "admin" }
  | { kind: "brand"; brandId: number; profileId: string };

type Source = {
  id: string; brand_id: number; kind: string; target: string; enabled: boolean;
  config: Record<string, unknown> | null; label: string | null; status: string;
};

type Existing = {
  id: string; external_id: string; external_updated_at: string | null;
  content_hash: string | null; deleted_at: string | null;
};

type RunStats = {
  listed: number; indexed: number; unchanged: number; skipped: number; failed: number; removed: number;
  remaining: number; skipped_examples: string[]; failed_examples: string[];
};

// ── Who is calling ───────────────────────────────────────────────────────────
async function resolveCaller(req: Request): Promise<Caller | Response> {
  const batchSecret = req.headers.get("x-batch-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (KNOWLEDGE_BATCH_SECRET && batchSecret === KNOWLEDGE_BATCH_SECRET) return { kind: "system" };
  if (bearer && (bearer === SUPABASE_SERVICE_ROLE_KEY || jwtRole(bearer) === "service_role")) return { kind: "system" };
  if (!bearer) return jsonError("missing bearer token", 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return jsonError("invalid session", 401);
  const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
  if (adminRow) return { kind: "admin" };

  const { data: p } = await userClient
    .from("profiles").select("id, brand_id, role, is_master")
    .eq("user_id", user.id).in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
  if (!p?.brand_id) return jsonError("admin or brand role required", 403);
  // The same gate as every other knowledge write: connecting a source puts a
  // whole folder into what the assistant tells clients.
  if (!(p.role === "brand_admin" || p.is_master)) return jsonError("insufficient permissions", 403);
  return { kind: "brand", brandId: p.brand_id as number, profileId: p.id as string };
}

function brandFor(caller: Caller, requested: unknown): number | null {
  if (caller.kind === "brand") return caller.brandId;
  return Number(requested ?? 0) || null;
}

async function loadSource(caller: Caller, sourceId: string): Promise<Source | Response> {
  const { data } = await admin.from("knowledge_sources").select("*").eq("id", sourceId).maybeSingle();
  const src = data as Source | null;
  if (!src) return jsonError("no such source", 404);
  if (caller.kind === "brand" && src.brand_id !== caller.brandId) return jsonError("no such source", 404);
  return src;
}

// ── Indexing one item ────────────────────────────────────────────────────────

/** Rows for a source, paged — PostgREST returns at most 1,000 at a time. */
async function existingDocs(sourceId: string): Promise<Map<string, Existing>> {
  const map = new Map<string, Existing>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("brand_knowledge_docs")
      .select("id, external_id, external_updated_at, content_hash, deleted_at")
      .eq("source_id", sourceId).range(from, from + 999);
    if (error) throw new Error(`reading indexed documents: ${error.message}`);
    for (const d of (data ?? []) as Existing[]) map.set(d.external_id, d);
    if (!data || data.length < 1000) return map;
  }
}

const sameTime = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

type Item = ContentItem & { source_type: "gdrive" | "shopify" };

/**
 * Index one item: unchanged text costs nothing but a timestamp, changed text is
 * re-chunked and re-embedded, new text gets a new doc. Embedding happens BEFORE
 * the old chunks are removed, so a Voyage failure leaves the last good version
 * searchable instead of an empty document.
 *
 * A document the brand deleted in the Knowledge page stays deleted: they told
 * us not to use it, and a sync quietly bringing it back would undo that. To
 * have it indexed again they restore it, or remove it from the source.
 */
async function indexItem(src: Source, item: Item, prior: Existing | undefined): Promise<"indexed" | "unchanged"> {
  // eslint-disable-next-line no-control-regex -- stripping NULs is the point
  let content = item.content.replace(/\u0000/g, "").replace(/\uFEFF/g, "").trim();
  if (content.length < MIN_TEXT_CHARS) {
    throw new PermanentError("no readable text — a scanned or image-only document can't be indexed as text");
  }
  if (content.length > MAX_CONTENT_CHARS) content = content.slice(0, MAX_CONTENT_CHARS);
  const hash = await sha256(content);

  if (prior && (prior.deleted_at || prior.content_hash === hash)) {
    await admin.from("brand_knowledge_docs").update({ external_updated_at: item.updated_at }).eq("id", prior.id);
    return "unchanged";
  }

  const chunks = chunkText(content);
  if (chunks.length === 0) throw new PermanentError("no chunkable content");
  const embeddings = await embedDocuments(chunks, VOYAGE_API_KEY);

  const fields = {
    brand_id: src.brand_id, source_id: src.id, external_id: item.external_id,
    external_updated_at: item.updated_at, title: item.title, category: item.category,
    source_type: item.source_type, source_url: item.source_url,
    content, content_hash: hash, char_count: content.length, chunk_count: chunks.length,
    status: "ready", error: null,
  };
  let docId = prior?.id ?? null;
  if (docId) {
    const { error } = await admin.from("brand_knowledge_docs").update(fields).eq("id", docId);
    if (error) throw new Error(`updating document: ${error.message}`);
    await admin.from("brand_knowledge_chunks").delete().eq("doc_id", docId);
  } else {
    const { data, error } = await admin.from("brand_knowledge_docs").insert(fields).select("id").single();
    if (error || !data) throw new Error(`creating document: ${error?.message}`);
    docId = data.id as string;
  }
  const rows = chunks.map((c, i) => ({
    doc_id: docId, brand_id: src.brand_id, chunk_index: i, content: c,
    token_count: Math.round(c.length / 4), embedding: embeddings[i],
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("brand_knowledge_chunks").insert(rows.slice(i, i + 200));
    if (error) {
      await admin.from("brand_knowledge_docs").update({ status: "error", error: `chunk insert: ${error.message}`.slice(0, 500) }).eq("id", docId);
      throw new Error(`chunk insert failed: ${error.message}`);
    }
  }
  return "indexed";
}

/** A failure that will happen again until the item itself changes. */
class PermanentError extends Error {}

/**
 * Record a failed item as a document in 'error', so the brand sees WHICH file
 * didn't make it and why, in the list they already look at. A permanent
 * failure records the item's modified time, so it is not retried every five
 * minutes; a transient one does not, so the next run tries again.
 */
async function recordFailure(src: Source, item: Omit<Item, "content">, prior: Existing | undefined, err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const permanent = err instanceof PermanentError;
  const fields = {
    brand_id: src.brand_id, source_id: src.id, external_id: item.external_id,
    external_updated_at: permanent ? item.updated_at : null,
    title: item.title, category: item.category, source_type: item.source_type, source_url: item.source_url,
    status: "error", error: message,
  };
  if (prior) {
    if (prior.deleted_at) return;
    // Keep the last good text and chunks: an error on an UPDATE should not
    // take the previous version away from the assistant.
    await admin.from("brand_knowledge_docs")
      .update({ status: "error", error: message, external_updated_at: fields.external_updated_at }).eq("id", prior.id);
  } else {
    await admin.from("brand_knowledge_docs").insert({ ...fields, content: "", char_count: 0, chunk_count: 0 });
  }
}

/** Remove documents for items the source no longer has. Hard delete: the brand removed it at the source. */
async function sweep(existing: Map<string, Existing>, keep: Set<string>, inScope: (externalId: string) => boolean) {
  const gone = [...existing.values()].filter((d) => inScope(d.external_id) && !keep.has(d.external_id)).map((d) => d.id);
  for (let i = 0; i < gone.length; i += 200) {
    await admin.from("brand_knowledge_docs").delete().in("id", gone.slice(i, i + 200));
  }
  return gone.length;
}

// ── Google Drive ─────────────────────────────────────────────────────────────
async function syncDrive(src: Source, deadline: number, stats: RunStats) {
  if (!SERVICE_ACCOUNT) throw new Error("Google Drive isn't set up on this environment yet (GOOGLE_SERVICE_ACCOUNT_JSON).");
  const token = await serviceAccountToken(SERVICE_ACCOUNT);
  // Re-reading the folder each run catches a rename, and an un-share fails
  // here with a clear message instead of as an empty listing that would sweep
  // every document away.
  const folder = await getFolder(token, src.target);
  if (folder.name !== src.label) await admin.from("knowledge_sources").update({ label: folder.name }).eq("id", src.id);

  const { files, truncated } = await listFolderTree(token, src.target);
  stats.listed = files.length;
  const existing = await existingDocs(src.id);

  const keep = new Set<string>();
  const todo: { f: ListedFile; plan: ReturnType<typeof planFile> }[] = [];
  for (const f of files) {
    const plan = planFile(f);
    if (plan.how === "skip") {
      stats.skipped++;
      if (stats.skipped_examples.length < 5) stats.skipped_examples.push(`${f.name} — ${plan.reason}`);
      continue;
    }
    keep.add(f.id);
    const prior = existing.get(f.id);
    if (prior && sameTime(prior.external_updated_at, f.modifiedTime)) { stats.unchanged++; continue; }
    todo.push({ f, plan });
  }
  // A capped listing is not the whole folder: removing what it didn't reach
  // would delete documents that are still there.
  if (!truncated) stats.removed = await sweep(existing, keep, () => true);

  for (const { f, plan } of todo) {
    if (Date.now() > deadline) { stats.remaining++; continue; }
    const base: Omit<Item, "content"> = {
      external_id: f.id, title: titleFromFileName(f.name), category: categoryFromPath(f.path, f.name),
      source_url: f.webViewLink ?? null, updated_at: f.modifiedTime ?? null, source_type: "gdrive",
    };
    try {
      const bytes = await fetchFileBytes(token, f, plan);
      let text: string;
      try {
        text = await extractByType(plan.how === "skip" ? f.name : plan.asName, bytes);
      } catch (e) {
        throw new PermanentError(`couldn't read this file: ${e instanceof Error ? e.message : "unknown"}`);
      }
      const where = f.path.length ? `\n(${f.path.join(" / ")})` : "";
      const r = await indexItem(src, { ...base, content: `${base.title}${where}\n\n${text}` }, existing.get(f.id));
      if (r === "indexed") stats.indexed++; else stats.unchanged++;
    } catch (e) {
      const err = e instanceof Error && /too large|larger than/.test(e.message) ? new PermanentError(e.message) : e;
      stats.failed++;
      if (stats.failed_examples.length < 5) stats.failed_examples.push(`${f.name} — ${err instanceof Error ? err.message : String(err)}`);
      await recordFailure(src, base, existing.get(f.id), err);
    }
  }
  if (truncated) stats.skipped_examples.unshift("The folder holds more than 2,000 files or 300 sub-folders; only the first part is indexed. Share a narrower folder.");
}

// ── Shopify ──────────────────────────────────────────────────────────────────
async function syncShopify(src: Source, deadline: number, stats: RunStats) {
  const { data: conn } = await admin.from("storefront_connections").select("shop_domain").eq("brand_id", src.brand_id).maybeSingle();
  if (!conn?.shop_domain) throw new Error("This brand has no Shopify shop connected.");
  const shop = conn.shop_domain as string;
  const { data: secret } = await admin.rpc("shopify_get_token", { p_brand_id: src.brand_id });
  const token = typeof secret === "string" ? secret : "";
  if (!token) throw new Error("No Shopify token stored — reconnect Shopify.");

  const scopeRes = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
  });
  if (scopeRes.status === 401) throw new Error("Shopify rejected the token (401) — the app may have been uninstalled. Reconnect Shopify.");
  const scopeBody = await scopeRes.json().catch(() => null) as { access_scopes?: { handle?: string }[] } | null;
  const { canPages, canPolicies } = contentScopeGaps((scopeBody?.access_scopes ?? []).map((s) => String(s.handle ?? "")));
  if (!canPages && !canPolicies) {
    throw new Error("The Shopify token can't read content (needs read_content and read_legal_policies). Reconnect Shopify to grant them.");
  }

  const shopInfo = await shopifyGraphql<{ shop: { name: string; primaryDomain: { url: string } | null } }>(shop, token, SHOP_QUERY);
  const shopUrl = shopInfo.shop.primaryDomain?.url ?? `https://${shop}`;
  if (shopInfo.shop.name && shopInfo.shop.name !== src.label) {
    await admin.from("knowledge_sources").update({ label: shopInfo.shop.name }).eq("id", src.id);
  }

  const items: Item[] = [];
  let complete = true;
  const fetchedKinds: string[] = [];
  if (canPages) {
    const pages = await fetchAllPaged<ShopPage>(shop, token, PAGES_QUERY, "pages");
    const articles = await fetchAllPaged<ShopArticle>(shop, token, ARTICLES_QUERY, "articles");
    complete = pages.complete && articles.complete;
    fetchedKinds.push("Page", "Article");
    for (const p of pages.nodes) { const m = mapPage(p, shopUrl); if (m) items.push({ ...m, source_type: "shopify" }); }
    for (const a of articles.nodes) { const m = mapArticle(a, shopUrl); if (m) items.push({ ...m, source_type: "shopify" }); }
  } else {
    stats.skipped_examples.push("Pages and articles skipped — the token lacks read_content.");
  }
  if (canPolicies) {
    const pol = await shopifyGraphql<{ shop: { shopPolicies: ShopPolicy[] } }>(shop, token, POLICIES_QUERY);
    fetchedKinds.push("ShopPolicy");
    for (const p of pol.shop.shopPolicies ?? []) { const m = mapPolicy(p); if (m) items.push({ ...m, source_type: "shopify" }); }
  } else {
    stats.skipped_examples.push("Policies skipped — the token lacks read_legal_policies.");
  }
  stats.listed = items.length;

  const existing = await existingDocs(src.id);
  const keep = new Set(items.map((i) => i.external_id));
  // Only sweep the kinds this run actually read: a token that lost
  // read_legal_policies must not delete the policies indexed before.
  const kindOf = (gid: string) => gid.match(/^gid:\/\/shopify\/([A-Za-z]+)\//)?.[1] ?? "";
  if (complete) stats.removed = await sweep(existing, keep, (gid) => fetchedKinds.includes(kindOf(gid)));

  for (const item of items) {
    const prior = existing.get(item.external_id);
    if (prior && sameTime(prior.external_updated_at, item.updated_at)) { stats.unchanged++; continue; }
    if (Date.now() > deadline) { stats.remaining++; continue; }
    try {
      const r = await indexItem(src, item, prior);
      if (r === "indexed") stats.indexed++; else stats.unchanged++;
    } catch (e) {
      stats.failed++;
      if (stats.failed_examples.length < 5) stats.failed_examples.push(`${item.title} — ${e instanceof Error ? e.message : String(e)}`);
      await recordFailure(src, item, prior, e);
    }
  }
}

// ── A run ────────────────────────────────────────────────────────────────────
async function runSync(src: Source): Promise<{ ok: boolean; stats: RunStats; error?: string; busy?: boolean }> {
  const stats: RunStats = {
    listed: 0, indexed: 0, unchanged: 0, skipped: 0, failed: 0, removed: 0, remaining: 0,
    skipped_examples: [], failed_examples: [],
  };
  // Claim it. Two runs of one source would embed every changed file twice.
  const cutoff = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data: claimed } = await admin.from("knowledge_sources")
    .update({ sync_started_at: new Date().toISOString(), status: "syncing" })
    .eq("id", src.id)
    .or(`sync_started_at.is.null,sync_started_at.lt.${cutoff}`)
    .select("id").maybeSingle();
  if (!claimed) return { ok: true, stats, busy: true };

  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    if (src.kind === "gdrive") await syncDrive(src, deadline, stats);
    else if (src.kind === "shopify") await syncShopify(src, deadline, stats);
    else throw new Error(`source kind "${src.kind}" is not synced here`);

    const { count } = await admin.from("brand_knowledge_docs")
      .select("id", { count: "exact", head: true }).eq("source_id", src.id).eq("status", "ready").is("deleted_at", null);
    const next = stats.remaining > 0
      ? new Date()
      : new Date(Date.now() + (RESYNC_HOURS[src.kind] ?? 12) * 3_600_000);
    await admin.from("knowledge_sources").update({
      status: "ok", last_error: null, last_synced_at: new Date().toISOString(),
      next_sync_at: next.toISOString(), sync_started_at: null, items_indexed: count ?? 0,
      config: { ...(src.config ?? {}), last_run: { at: new Date().toISOString(), ...stats } },
    }).eq("id", src.id);
    return { ok: true, stats };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("[source-sync]", src.kind, src.id, message);
    await admin.from("knowledge_sources").update({
      status: "error", last_error: message, sync_started_at: null,
      next_sync_at: new Date(Date.now() + ERROR_RETRY_HOURS * 3_600_000).toISOString(),
    }).eq("id", src.id);
    return { ok: false, stats, error: message };
  }
}

// ── Connecting ───────────────────────────────────────────────────────────────
async function connectDrive(caller: Caller, body: Record<string, unknown>) {
  const brandId = brandFor(caller, body.brand_id);
  if (!brandId) return jsonError("brand_id is required", 400);
  if (!SERVICE_ACCOUNT) return jsonError("Google Drive isn't set up on this environment yet.", 503);
  const folderId = parseFolderId(String(body.folder ?? ""));
  if (!folderId) return jsonError("Paste the link of a Google Drive FOLDER (it contains /folders/).", 400);

  // Prove it is shared with us before saving anything: a source that can never
  // be read is worse than no source, because it looks connected.
  let folder: { id: string; name: string };
  try {
    folder = await getFolder(await serviceAccountToken(SERVICE_ACCOUNT), folderId);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Couldn't open the folder", share_with: SERVICE_ACCOUNT.client_email });
  }

  const { data: before } = await admin.from("knowledge_sources")
    .select("id, target").eq("brand_id", brandId).eq("kind", "gdrive").maybeSingle();

  const { data, error } = await admin.from("knowledge_sources").upsert({
    brand_id: brandId, kind: "gdrive", target: folder.id, label: folder.name, enabled: true,
    status: "ok", last_error: null, next_sync_at: new Date().toISOString(), sync_started_at: null,
    config: { folder_url: `https://drive.google.com/drive/folders/${folder.id}` },
    created_by: caller.kind === "brand" ? caller.profileId : null,
  }, { onConflict: "brand_id,kind" }).select("id").single();
  if (error) return jsonError(`could not save the source: ${error.message}`, 500);

  // Pointing the source at a DIFFERENT folder: what came from the old one no
  // longer belongs. The next run's sweep would remove it anyway; doing it now
  // means the list never shows two folders' worth at once.
  if (before && before.target !== folder.id) {
    await admin.from("brand_knowledge_docs").delete().eq("source_id", data.id);
  }
  return json({ ok: true, source_id: data.id, label: folder.name });
}

async function connectShopify(caller: Caller, body: Record<string, unknown>) {
  const brandId = brandFor(caller, body.brand_id);
  if (!brandId) return jsonError("brand_id is required", 400);
  const { data: conn } = await admin.from("storefront_connections").select("shop_domain, token_secret_name").eq("brand_id", brandId).maybeSingle();
  if (!conn?.token_secret_name) return jsonError("Connect Shopify first.", 409);
  const { data, error } = await admin.from("knowledge_sources").upsert({
    brand_id: brandId, kind: "shopify", target: conn.shop_domain, label: conn.shop_domain, enabled: true,
    status: "ok", last_error: null, next_sync_at: new Date().toISOString(), sync_started_at: null,
    created_by: caller.kind === "brand" ? caller.profileId : null,
  }, { onConflict: "brand_id,kind" }).select("id").single();
  if (error) return jsonError(`could not save the source: ${error.message}`, 500);
  return json({ ok: true, source_id: data.id });
}

// ── Entry ────────────────────────────────────────────────────────────────────
type EdgeRuntimeLike = { waitUntil: (p: Promise<unknown>) => void };

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return originRefused();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError("POST only", 405);

  const caller = await resolveCaller(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "").trim();

  try {
    if (action === "info") {
      // Whether "Connect Shopify" can lead anywhere: a public app on this
      // environment, or an app AION has made for this house. Without either the
      // panel says so up front instead of failing after the shop is typed in.
      const brandId = brandFor(caller, body.brand_id);
      let shopifyReady = SHOPIFY_PUBLIC_APP;
      if (!shopifyReady && brandId) {
        const { data: conn } = await admin.from("storefront_connections").select("client_id").eq("brand_id", brandId).maybeSingle();
        shopifyReady = !!conn?.client_id;
      }
      return json({ gdrive_share_with: SERVICE_ACCOUNT?.client_email ?? null, shopify_available: shopifyReady });
    }
    if (action === "connect_gdrive") return await connectDrive(caller, body);
    if (action === "connect_shopify") return await connectShopify(caller, body);

    if (action === "sync" || action === "disconnect") {
      let src: Source | Response;
      if (body.source_id) {
        src = await loadSource(caller, String(body.source_id));
      } else {
        const brandId = brandFor(caller, body.brand_id);
        const { data } = await admin.from("knowledge_sources").select("id")
          .eq("brand_id", brandId ?? -1).eq("kind", String(body.kind ?? "")).maybeSingle();
        src = data ? await loadSource(caller, data.id as string) : jsonError("no such source", 404);
      }
      if (src instanceof Response) return src;

      if (action === "disconnect") {
        // Documents go with it (on delete cascade). The Shopify token is NOT
        // revoked here: the orders sync may still be using it. Uninstalling the
        // app in Shopify is how a house withdraws access altogether.
        const { error } = await admin.from("knowledge_sources").delete().eq("id", src.id);
        if (error) return jsonError(error.message, 500);
        return json({ ok: true });
      }

      // A person pressing "Sync now" should not stare at a spinner for two
      // minutes: answer at once and let the run finish in the background. The
      // tick (a system call) waits, so its logs carry the outcome.
      const run = runSync(src);
      const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
      if (caller.kind !== "system" && rt?.waitUntil) {
        rt.waitUntil(run);
        return json({ ok: true, started: true });
      }
      const result = await run;
      return json(result, result.ok ? 200 : 502);
    }
    return jsonError('action must be "info", "connect_gdrive", "connect_shopify", "sync" or "disconnect"', 400);
  } catch (err) {
    console.error("[source-sync]", err);
    return jsonError(err instanceof Error ? err.message : "internal error", 500);
  }
});
