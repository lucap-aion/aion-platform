// onboard-brand: lead → demo-ready, in one call per stage.
//
// An AION admin creates the brand with its website; this runs everything after
// it and reports where it got to:
//   branding    — logo, colours, description and hero imagery, from their own site
//   sources     — register the site + news as knowledge sources and kick the crawl
//   storefront  — detect an e-commerce feed, register it, pull the catalogue
//   demo_data   — a believable book of business built from the brand's own pieces
//   demo_users  — loginable brand admin, sales associate and client accounts
//   documents   — the onboarding paperwork, drafted in the brand's own voice
//   assistant   — confirm the brand has enough indexed to answer questions
//
// Stages are independent and re-runnable: the crawl is long and occasionally
// needs a second pass, so the admin can re-run just that one instead of starting
// the brand over. Progress is DERIVED from the real tables (queue depth, chunk
// count, product count) rather than trusted from a status column, so a stage
// that half-finished reports what actually landed.
//
// Auth: AION admin (bearer) or batch (x-batch-secret / service role).
// Body: { brand_id, action?: "run" | "status" | "purge_demo",
//         stages?: string[], options?: { customers, policies, avg_ticket } }

import { createClient } from "npm:@supabase/supabase-js@2";
import { demoToolsEnabled, demoToolsBlockedReason, isNonProduction } from "../_shared/environment.ts";
import { harvestBrandIdentity } from "../_shared/brand-identity.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

const ALL_STAGES = ["branding", "sources", "storefront", "demo_data", "demo_users", "documents", "assistant"] as const;
// Stages that invent data — never run outside a non-production project.
const DEMO_STAGES = ["demo_data", "demo_users"] as const;
// Product images embedded per invocation. Small enough that a run always
// finishes and reports; the stage re-queues itself until the catalogue is done.
const STOREFRONT_BATCH = 40;
type Stage = (typeof ALL_STAGES)[number];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  // Onboarding creates logins and writes demo data across a brand — AION staff
  // only. A brand user must never be able to reach it, even for their own brand.
  const isBatch =
    (KNOWLEDGE_BATCH_SECRET && req.headers.get("x-batch-secret") === KNOWLEDGE_BATCH_SECRET) ||
    token === SUPABASE_SERVICE_ROLE_KEY ||
    jwtRole(token) === "service_role";
  if (!isBatch) {
    if (!token) return json({ error: "missing bearer token" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid session" }, 401);
    const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return json({ error: "AION admin only" }, 403);
  }

  const brandId = Number(body.brand_id ?? 0);
  if (!brandId) return json({ error: "brand_id required" }, 400);
  const options = (body.options ?? {}) as { customers?: number; policies?: number; avg_ticket?: number; force?: boolean };

  const { data: brand } = await admin.from("brands").select("*").eq("id", brandId).maybeSingle();
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  const action = String(body.action ?? "run");
  if (action === "status") return json({ ...await status(admin, brandId), demo_tools_enabled: demoToolsEnabled() });

  // Queue and return. The browser is not the runner: a cron tick advances one
  // stage a minute, so closing the tab, refreshing, or handing the brand to a
  // colleague all leave the run going and showing the same live progress.
  if (action === "start") {
    const wanted = (Array.isArray(body.stages) && body.stages.length
      ? (body.stages as string[]).filter((s) => (ALL_STAGES as readonly string[]).includes(s))
      : [...ALL_STAGES]) as Stage[];
    const runnable = wanted.filter((s) => demoToolsEnabled() || !(DEMO_STAGES as readonly string[]).includes(s));
    const skipped = wanted.filter((s) => !(runnable as string[]).includes(s));
    for (const s of skipped) {
      await setStage(admin, brandId, s, "skipped", { blocked: true, reason: demoToolsBlockedReason() });
    }
    const { error } = await admin.rpc("queue_onboarding_stages", { p_brand_id: brandId, p_stages: runnable });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, queued: runnable, skipped, status: await status(admin, brandId) });
  }

  // Called by the tick: run exactly ONE queued stage, then get out of the way.
  if (action === "run_queued") {
    const stage = String(body.stage ?? "") as Stage;
    if (!(ALL_STAGES as readonly string[]).includes(stage)) return json({ error: "unknown stage" }, 400);
    await setStage(admin, brandId, stage, "running");
    try {
      const out = await runStage(admin, brand, stage, options);
      const ok = (out as { ok?: boolean }).ok !== false;
      const more = ok && (out as { continue?: boolean }).continue === true;

      if (more) {
        // Still work to do: back in the queue, at the end, so another brand's
        // stages are not starved while this catalogue finishes.
        await setStage(admin, brandId, stage, "pending", out);
        await admin.from("brand_onboarding")
          .update({ queued_at: new Date().toISOString() })
          .eq("brand_id", brandId).eq("stage", stage);
        return json({ ok: true, stage, continuing: true, result: out });
      }

      await setStage(admin, brandId, stage, ok ? "done" : "failed", out,
        ok ? null : String((out as { reason?: string }).reason ?? "stage did not complete"));
      // A failed stage cancels what was queued behind it: the later stages
      // depend on it (no catalogue → no demo book), and silently running them
      // would produce a half-built brand that looks finished.
      if (!ok) await admin.from("brand_onboarding").update({ queued_at: null })
        .eq("brand_id", brandId).eq("status", "pending").not("queued_at", "is", null);
      return json({ ok, stage, result: out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setStage(admin, brandId, stage, "failed", {}, msg);
      return json({ ok: false, stage, error: msg }, 200);
    }
  }

  // Dry run: what a purge would take out, and what it would leave behind.
  if (action === "preview_purge") {
    if (body.include_legacy !== false) await admin.rpc("adopt_legacy_demo_rows", { p_brand_id: brandId });
    const { data, error } = await admin.rpc("preview_brand_demo_purge", { p_brand_id: brandId });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // Hand the account over: remove everything we fabricated, keep everything we
  // harvested from the brand itself (site, news, catalogue, brand record).
  if (action === "purge_demo") {
    // Older hand-seeded example rows predate the artifact log; tag them first or
    // they survive and quietly become "the brand's data".
    if (body.include_legacy !== false) await admin.rpc("adopt_legacy_demo_rows", { p_brand_id: brandId });

    // Auth users FIRST, while the profiles that point at them still exist —
    // otherwise the logins outlive the purge and keep working against a brand
    // that has gone live. SQL can't remove auth users, so it happens here.
    const removedLogins = await deleteDemoLogins(admin, brandId);

    const { data, error } = await admin.rpc("purge_brand_demo_data", { p_brand_id: brandId });
    if (error) return json({ error: error.message }, 500);

    // The demo is gone, so the stages that produced it are no longer done.
    await setStage(admin, brandId, "demo_data", "pending", { purged: data });
    await setStage(admin, brandId, "demo_users", "pending", { removed_logins: removedLogins });

    return json({ ok: true, purged: data, removed_logins: removedLogins, status: await status(admin, brandId) });
  }

  const requested = (Array.isArray(body.stages) && body.stages.length
    ? body.stages.filter((s: string) => (ALL_STAGES as readonly string[]).includes(s))
    : [...ALL_STAGES]) as Stage[];

  // Demo stages are dev-only. Asking for them in production is not an error to
  // hide — it is reported per stage, and the real onboarding stages still run.
  

  const results: Record<string, unknown> = {};
  for (const stage of requested) {
    if ((DEMO_STAGES as readonly string[]).includes(stage) && !demoToolsEnabled()) {
      await setStage(admin, brandId, stage, "skipped", { blocked: true, reason: demoToolsBlockedReason() });
      results[stage] = { ok: true, skipped: true, reason: demoToolsBlockedReason() };
      continue;
    }
    await setStage(admin, brandId, stage, "running");
    try {
      const out = await runStage(admin, brand, stage, options);
      const ok = (out as { ok?: boolean }).ok !== false;
      const more = ok && (out as { continue?: boolean }).continue === true;

      if (more) {
        // Still work to do: back in the queue, at the end, so another brand's
        // stages are not starved while this catalogue finishes.
        await setStage(admin, brandId, stage, "pending", out);
        await admin.from("brand_onboarding")
          .update({ queued_at: new Date().toISOString() })
          .eq("brand_id", brandId).eq("stage", stage);
        return json({ ok: true, stage, continuing: true, result: out });
      }

      await setStage(admin, brandId, stage, ok ? "done" : "failed", out,
        ok ? null : String((out as { reason?: string }).reason ?? "stage did not complete"));
      results[stage] = out;
      // A stage that couldn't complete usually blocks the ones after it (no
      // catalogue → no demo book), so stop and let the admin see why.
      if (!ok) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setStage(admin, brandId, stage, "failed", {}, msg);
      results[stage] = { ok: false, error: msg };
      break;
    }
  }

  return json({
    ok: true, brand_id: brandId, ran: results,
    demo_tools_enabled: demoToolsEnabled(),
    status: await status(admin, brandId),
  });
});

// ── Stages ───────────────────────────────────────────────────────────────────

async function runStage(
  admin: ReturnType<typeof createClient>,
  brand: Record<string, unknown>,
  stage: Stage,
  options: { customers?: number; policies?: number; avg_ticket?: number; force?: boolean },
): Promise<unknown> {
  const brandId = Number(brand.id);
  const force = options.force === true;

  if (stage === "branding") {
    const website = String(brand.website ?? "").trim();
    if (!website) return { ok: false, reason: "the brand has no website — add one on the brand record first" };

    const id = await harvestBrandIdentity(website);
    // Only fill what is EMPTY. A logo or colour an admin chose deliberately
    // outranks anything scraped, and overwriting it silently would be worse
    // than finding nothing.
    const patch: Record<string, unknown> = {};
    const fillable: [string, unknown][] = [
      ["description", id.description], ["email", id.email],
      ["logo_big", id.logo_big], ["logo_small", id.logo_small],
      ["top_banner_image", id.top_banner_image], ["auth_background_image", id.auth_background_image],
      ["theme_settings", id.theme_settings],
    ];
    const kept: string[] = [];
    for (const [key, value] of fillable) {
      if (value == null) continue;
      const current = (brand as Record<string, unknown>)[key];
      const empty = current == null || current === "" ||
        (typeof current === "object" && Object.keys(current as object).length === 0);
      if (empty || force) patch[key] = value;
      else kept.push(key);
    }

    if (Object.keys(patch).length) {
      const { error } = await admin.from("brands").update(patch).eq("id", brandId);
      if (error) throw new Error(`brand update: ${error.message}`);
    }

    return {
      ok: true,
      filled: Object.keys(patch),
      kept_existing: kept,
      found: id.found,
      notes: id.notes,
    };
  }

  if (stage === "sources") {
    const website = String(brand.website ?? "").trim();
    if (!website) return { ok: false, reason: "the brand has no website — add one on the brand record first" };
    const base = website.startsWith("http") ? website : `https://${website}`;

    await admin.from("knowledge_sources").upsert(
      [
        { brand_id: brandId, kind: "website", target: base, enabled: true, config: { max_pages: 500, news_enabled: true } },
        { brand_id: brandId, kind: "news", target: String(brand.name ?? ""), enabled: true, config: {} },
      ],
      { onConflict: "brand_id,kind" },
    );

    // seed-crawl discovers the sitemap, derives the site's boilerplate and fills
    // the crawl queue; the per-minute cron tick drains it from there.
    const seeded = await callFn("seed-crawl", { brand_id: brandId, max_pages: 500, news: true });
    return { ok: true, website: base, seeded };
  }

  if (stage === "storefront") {
    const website = String(brand.website ?? "").trim();
    const base = normaliseBase(website);
    if (!base) return { ok: false, reason: "no website to look for a catalogue on" };

    const detected = await detectShopify(base);
    if (!detected) {
      // Not every house sells online through a readable feed. That's fine — the
      // crawler still indexed the product pages, and the demo book falls back to
      // those. Record it so nobody goes looking for a bug.
      await admin.from("storefront_sources").upsert(
        { brand_id: brandId, base_url: base, platform: "none", enabled: false, detected_at: new Date().toISOString() },
        { onConflict: "brand_id" },
      );
      return { ok: true, platform: "none", products: 0,
        note: "no public product feed found — the catalogue will come from the indexed product pages" };
    }

    await admin.from("storefront_sources").upsert(
      { brand_id: brandId, base_url: detected.base, platform: "shopify", currency: "EUR",
        keep_untyped: detected.keepUntyped, enabled: true, detected_at: new Date().toISOString() },
      { onConflict: "brand_id" },
    );

    // Embedding every product image takes longer than one invocation is allowed
    // to live: 481 products meant the stage did real work (258 images embedded)
    // and then died before reporting, so it looked stuck while it was in fact
    // progressing. Do a SMALL batch that comfortably fits, and ask to be called
    // again until there is nothing left.
    const synced = await callFn("sync-storefront", { brand_id: brandId, max: STOREFRONT_BATCH }) as
      { results?: { products?: number; embedded?: number; remaining?: number }[] };
    const r = synced.results?.[0] ?? {};
    const { count } = await admin.from("storefront_products").select("id", { count: "exact", head: true }).eq("brand_id", brandId);
    const remaining = Number(r.remaining ?? 0);

    return {
      ok: true,
      platform: "shopify",
      base: detected.base,
      products: count ?? 0,
      embedded_this_run: Number(r.embedded ?? 0),
      images_remaining: remaining,
      // The runner re-queues rather than finishing, so progress is visible and
      // no single call has to carry the whole catalogue.
      continue: remaining > 0,
    };
  }

  if (stage === "demo_data") {
    if (!demoToolsEnabled()) return { ok: true, skipped: true, reason: demoToolsBlockedReason() };
    const { data, error } = await admin.rpc("generate_brand_demo_data", {
      p_brand_id: brandId,
      p_customers: options.customers ?? 40,
      p_policies: options.policies ?? 60,
      p_avg_ticket: options.avg_ticket ?? null,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (stage === "demo_users") {
    if (!demoToolsEnabled()) return { ok: true, skipped: true, reason: demoToolsBlockedReason() };
    return await createDemoUsers(admin, brand);
  }

  if (stage === "documents") {
    // Bilingual FAQ (it lands on the public FAQ page once approved), the rest
    // in English — a human reviews every one before it goes anywhere.
    const out = await callFn("generate-brand-docs", {
      brand_id: brandId,
      kinds: ["faq", "associate_onepager", "cover_summary", "welcome_email", "partnership_proposal"],
      locales: ["en"],
    }) as { ok?: boolean; reason?: string; documents?: Record<string, unknown> };
    if (out.ok === false) return out;
    const docs = out.documents ?? {};
    const failed = Object.entries(docs).filter(([, v]) => (v as { ok?: boolean })?.ok === false);
    return {
      ok: failed.length < Object.keys(docs).length,
      written: Object.keys(docs).length - failed.length,
      failed: failed.map(([k]) => k),
      documents: docs,
    };
  }

  // assistant: the config auto-detects (data_home from CRM vs knowledge counts),
  // so there is nothing to write — just confirm there is something to answer from.
  const [{ count: chunks }, { count: products }, { count: customers }] = await Promise.all([
    admin.from("brand_knowledge_chunks").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    admin.from("storefront_products").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("brand_id", brandId).or("role.is.null,role.eq.customer"),
  ]);
  if (!chunks) {
    return { ok: false, reason: "nothing indexed yet — the crawl is still running, re-run this stage in a few minutes" };
  }

  // "Done" used to mean "there is something to answer from", which let a brand
  // read as ready while most of its site was still being crawled. Report the
  // coverage honestly: still crawling is not a failure, but it is not finished
  // either, so the stage keeps itself queued until the queue is empty.
  const { count: pending } = await admin.from("knowledge_crawl_queue")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId).in("status", ["pending", "processing"]);

  return {
    ok: true,
    knowledge_chunks: chunks,
    products: products ?? 0,
    customers: customers ?? 0,
    pages_still_crawling: pending ?? 0,
    continue: (pending ?? 0) > 0,
  };
}

// ── Demo logins ──────────────────────────────────────────────────────────────
// A profile row keyed by email first, then the auth user: the existing
// sync_user_metadata_to_profile trigger links user_id by matching the email.
async function createDemoUsers(admin: ReturnType<typeof createClient>, brand: Record<string, unknown>) {
  const brandId = Number(brand.id);
  const slug = String(brand.slug ?? brand.name ?? `brand${brandId}`)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  const people = [
    { key: "brand_admin", email: `${slug}-admin@demo.aioncover.com`, first: "Demo", last: "Brand Admin", role: "brand", master: true },
    { key: "sales_associate", email: `${slug}-sales@demo.aioncover.com`, first: "Demo", last: "Sales Associate", role: "brand", master: false },
    { key: "customer", email: `${slug}-client@demo.aioncover.com`, first: "Demo", last: "Client", role: null, master: false },
  ];

  const created: Record<string, { email: string; password: string; portal: string }> = {};
  for (const p of people) {
    const password = demoPassword(slug, p.key);

    const { data: existing } = await admin.from("profiles").select("id, user_id").eq("email", p.email).maybeSingle();
    let profileId = existing?.id as string | undefined;
    if (!profileId) {
      profileId = crypto.randomUUID();
      const { error } = await admin.from("profiles").insert({
        id: profileId, email: p.email, first_name: p.first, last_name: p.last,
        brand_id: brandId, role: p.role, is_master: p.master, status: "active",
        is_visible: true, registered_at: new Date().toISOString(),
      });
      if (error) throw new Error(`profile ${p.email}: ${error.message}`);
      await admin.from("brand_demo_artifacts").insert({ brand_id: brandId, table_name: "profiles", row_pk: profileId });
    }

    // Idempotent: if the login already exists, reset it to the known password so
    // the credentials on screen always work.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = list?.users?.find((u) => u.email?.toLowerCase() === p.email.toLowerCase());
    if (found) {
      await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true });
      await admin.from("profiles").update({ user_id: found.id }).eq("id", profileId);
    } else {
      const { data: made, error } = await admin.auth.admin.createUser({
        email: p.email, password, email_confirm: true,
        user_metadata: { first_name: p.first, last_name: p.last, demo: true, brand_id: brandId },
      });
      if (error) throw new Error(`auth user ${p.email}: ${error.message}`);
      if (made?.user) await admin.from("profiles").update({ user_id: made.user.id }).eq("id", profileId);
    }

    created[p.key] = { email: p.email, password, portal: p.role ? "brand" : "customer" };
  }

  return { ok: true, accounts: created };
}

// Delete the auth users behind this brand's demo profiles. Driven off the
// artifact log, so it can only ever reach logins onboarding itself created —
// a real brand user who happens to share the brand is never touched.
async function deleteDemoLogins(admin: ReturnType<typeof createClient>, brandId: number): Promise<string[]> {
  const { data: arts } = await admin.from("brand_demo_artifacts")
    .select("row_pk").eq("brand_id", brandId).eq("table_name", "profiles");
  const ids = (arts ?? []).map((a) => String(a.row_pk));
  if (!ids.length) return [];

  const removed: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: profiles } = await admin.from("profiles")
      .select("id, email, user_id").in("id", ids.slice(i, i + 200)).not("user_id", "is", null);
    for (const p of profiles ?? []) {
      const { error } = await admin.auth.admin.deleteUser(String(p.user_id));
      // A login already gone is the desired end state, not a failure.
      if (!error || /not.?found/i.test(error.message)) removed.push(String(p.email));
      else console.warn("[onboard-brand] deleteUser", p.email, error.message);
    }
  }
  return removed;
}

// Deterministic so re-running shows the same credentials instead of silently
// invalidating the ones already handed to a prospect. Demo accounts only.
function demoPassword(slug: string, key: string): string {
  const s = slug.replace(/-/g, "");
  return `${s.charAt(0).toUpperCase()}${s.slice(1, 10)}-${key === "brand_admin" ? "Admin" : key === "sales_associate" ? "Sales" : "Client"}-2026!`;
}

// ── Storefront detection ─────────────────────────────────────────────────────
// Shopify exposes /products.json. Try the site as given and its www/apex twin —
// robertocoin.com redirects, www.robertocoin.com answers.
async function detectShopify(base: string): Promise<{ base: string; keepUntyped: boolean } | null> {
  const host = base.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const candidates = host.startsWith("www.")
    ? [`https://${host}`, `https://${host.slice(4)}`]
    : [`https://${host}`, `https://www.${host}`];

  for (const c of candidates) {
    try {
      const res = await fetch(`${c}/products.json?limit=20`, {
        headers: { "User-Agent": "Mozilla/5.0 (AION onboarding)" },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const products = (await res.json())?.products;
      if (!Array.isArray(products) || products.length === 0) continue;
      // Some shops leave product_type empty on everything; the sync must not
      // treat those as junk or it discards the whole catalogue.
      const typed = products.filter((p: { product_type?: string }) => (p.product_type ?? "").trim() !== "").length;
      return { base: c, keepUntyped: typed / products.length < 0.5 };
    } catch { /* try the next candidate */ }
  }
  return null;
}

function normaliseBase(website: string): string | null {
  const w = website.trim();
  if (!w) return null;
  return (w.startsWith("http") ? w : `https://${w}`).replace(/\/+$/, "");
}

// ── Status: derived from the real tables, not from a status column ───────────
async function status(admin: ReturnType<typeof createClient>, brandId: number) {
  const [stages, chunks, docs, queued, products, customers, policies, shops, users, src] = await Promise.all([
    admin.from("brand_onboarding").select("stage, status, detail, error, started_at, finished_at").eq("brand_id", brandId),
    admin.from("brand_knowledge_chunks").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    admin.from("brand_knowledge_docs").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    admin.from("knowledge_crawl_queue").select("id", { count: "exact", head: true }).eq("brand_id", brandId).eq("status", "pending"),
    admin.from("storefront_products").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    // A client is role IS NULL *or* 'customer' — both exist in the data, so
    // splitting on "role is null" alone counts real clients as staff.
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("brand_id", brandId).or("role.is.null,role.eq.customer"),
    admin.from("policies").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    admin.from("shops").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("brand_id", brandId).in("role", ["brand", "brand_admin", "brand_user"]),
    admin.from("storefront_sources").select("platform, base_url, enabled").eq("brand_id", brandId).maybeSingle(),
  ]);

  const counts = {
    knowledge_chunks: chunks.count ?? 0,
    knowledge_docs: docs.count ?? 0,
    crawl_pending: queued.count ?? 0,
    products: products.count ?? 0,
    customers: customers.count ?? 0,
    policies: policies.count ?? 0,
    shops: shops.count ?? 0,
    brand_users: users.count ?? 0,
  };

  // Demo-ready = the assistant has something to say AND the platform has
  // something to show on both portals.
  const ready = counts.knowledge_chunks > 0 && counts.policies > 0 && counts.customers > 0 && counts.brand_users > 0;

  return {
    brand_id: brandId,
    demo_ready: ready,
    blocking: ready ? [] : [
      counts.knowledge_chunks === 0 && "nothing indexed yet (crawl)",
      counts.customers === 0 && "no clients (demo data)",
      counts.policies === 0 && "no covers (demo data)",
      counts.brand_users === 0 && "no logins (demo users)",
    ].filter(Boolean),
    storefront: src.data ?? null,
    counts,
    stages: stages.data ?? [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function callFn(name: string, payload: Record<string, unknown>) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "x-batch-secret": KNOWLEDGE_BATCH_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed).slice(0, 300)}`);
  return parsed;
}

async function setStage(
  admin: ReturnType<typeof createClient>, brandId: number, stage: string,
  status: string, detail: unknown = {}, error: string | null = null,
) {
  await admin.rpc("brand_onboarding_set", {
    p_brand_id: brandId, p_stage: stage, p_status: status,
    p_detail: detail ?? {}, p_error: error,
  });
  // A finished stage leaves the queue; a running one stays claimed so the
  // stuck-stage sweeper can tell the difference.
  if (status === "done" || status === "failed" || status === "skipped") {
    await admin.from("brand_onboarding").update({ queued_at: null })
      .eq("brand_id", brandId).eq("stage", stage);
  }
}

// The project has more than one service-role credential in circulation (legacy
// JWT and the newer secret key), so match on the claim, not on string equality.
function jwtRole(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const pad = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}

function json(payload: unknown, code = 200) {
  return new Response(JSON.stringify(payload), {
    status: code, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
