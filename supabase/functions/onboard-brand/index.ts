// onboard-brand: lead → demo-ready, in one call per stage.
//
// An AION admin creates the brand with its website; this runs everything after
// it and reports where it got to:
//   branding    — logo, colours, description and hero imagery, from their own site,
//                 plus the legal entity and registered office from their own legal pages
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
import { originAllowed, originRefused } from "../_shared/origin.ts";
import {
  demoToolsEnabled, isNonProduction,
  demoAllowedForBrand, demoBlockedForBrandReason,
} from "../_shared/environment.ts";
import { harvestBrandIdentity } from "../_shared/brand-identity.ts";
import { extractProducts } from "../_shared/product-extract.ts";
import { enrichFromWikidata } from "../_shared/brand-enrich.ts";
import { legalNameFromDescription, registeredOfficeFrom, nameIsConfirmedBy } from "../_shared/brand-legal.ts";
// What a failure actually stops, and why it is not "everything queued behind it".
import { blockedBy, type StageName } from "../_shared/stage-graph.ts";
import { rankCatalogueUrls, catalogueSample } from "../_shared/catalogue-urls.ts";
// The last resort when no page of a site can be read: its own sitemap names the pieces and
// the packshots, and the item code joins them.
import { collectSitemap } from "../_shared/crawl.ts";
import { productsFromSitemap } from "../_shared/sitemap-products.ts";
// A product feed the house already publishes — for Google Shopping, for a marketplace. The
// same catalogue, maintained by them, and the cheapest one there is.
import { parseProductFeed } from "../_shared/product-feed.ts";
import { AION_UA } from "../_shared/robots.ts";
// The record's non-visual defaults: focus, FAQ, fee rates, policy prefix.
import { policyPrefix, productFocus, renderFaqs, customerServiceEmail, STANDARD_FEE_RATES } from "../_shared/brand-defaults.ts";
// A brand's imagery, held by us rather than hotlinked from a site that will be redesigned.
import { mirrorBrandImages, servedByAion, IMAGE_SLOTS, type ImageSlot } from "../_shared/brand-images.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") ?? "";
// How many product images one sync run may embed. Small on purpose: embedding every image
// takes longer than a single invocation is allowed to live, so the stage does a batch and
// asks to be called again until nothing is left.
//
// This declaration was dropped in 139f054 — the commit that taught the pipeline to read a
// catalogue off a non-Shopify storefront — while both uses of it stayed. It never threw,
// because detection never once succeeded on such a site: it guessed three URLs, found
// nothing, and returned before reaching the line that would have blown up. Fixing detection
// is what finally reached it.
const STOREFRONT_BATCH = 40;

// Order is the order the queue runs them in, and it encodes the dependencies:
// nothing can be branded before the site is read, no deck can be built before
// the catalogue is pulled.
//
// The last three used to be buttons a human pressed one at a time on three
// different screens. They need no decisions that the brand record does not
// already hold, so they are stages like everything else — they run themselves,
// they retry, and their state is visible in the same place as the rest.
const ALL_STAGES = [
  "branding", "sources", "storefront",
  "intro_deck",
  "demo_data", "demo_users", "documents", "assistant",
  "ops_deck", "data_request",
] as const;
// Stages that invent data. They run on a non-production project, or for a brand
// explicitly flagged as a prospect — see demoAllowedForBrand: a house that has
// signed nothing has an empty account, and the demo is the whole point of it.
const DEMO_STAGES = ["demo_data", "demo_users"] as const;
type Stage = (typeof ALL_STAGES)[number];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// What each stage needs before it can do useful work.
//
// Checked against the DATA, not against whether a stage row says "done". Brands
// onboarded before this pipeline existed have no stage rows at all — Luisa
// Beccaria has 1,013 products and no storefront row — so gating on stage status
// would block them forever. Same principle as the status endpoint: ask the
// tables what is true, don't trust a status column's opinion.
//
// It also has to say whether the thing it is waiting for is COMING or is simply not there.
// "No catalogue yet" while the storefront stage is still to run is a wait. The same sentence
// after that stage has finished and reported no product feed is the end of the matter — and
// reporting it as a failure paints a red mark on a perfectly healthy brand and asks somebody
// to go and fix a site that has nothing wrong with it. Ferragamo publishes no machine-
// readable catalogue; its intro deck is not broken, it is impossible.
type Unmet = { reason: string; terminal: boolean };

async function unmetRequirements(
  admin: ReturnType<typeof createClient>, brandId: number, stage: Stage,
): Promise<Unmet | null> {
  const has = async (table: string, extra?: (q: any) => any) => {
    let q = admin.from(table).select("id", { count: "exact", head: true }).eq("brand_id", brandId);
    if (extra) q = extra(q);
    const { count } = await q;
    return (count ?? 0) > 0;
  };
  // A prerequisite stage that has FINISHED and produced nothing will not produce anything
  // on its own; anything else may still deliver.
  // Settled means "nothing more is coming from it", which a FAILURE satisfies as surely as
  // a success. Reading only 'done' meant a dependent stage was told its wait was
  // non-terminal for ever: now that a non-terminal wait re-queues instead of failing, a
  // prerequisite that died would have had the stages behind it re-queueing once a minute
  // until someone noticed.
  const settled = async (prerequisite: Stage) => {
    const { data } = await admin.from("brand_onboarding")
      .select("status").eq("brand_id", brandId).eq("stage", prerequisite).maybeSingle();
    const status = (data as { status?: string } | null)?.status;
    return status === "done" || status === "failed" || status === "skipped";
  };

  if (stage === "demo_data") {
    // The generator builds the book from the brand's own pieces, falling back to
    // indexed product pages when there is no feed. If neither exists there is
    // nothing to build from, and a demo of empty shelves is worse than none.
    const [products, productPages] = await Promise.all([
      has("storefront_products"),
      has("brand_knowledge_docs", (q: any) => q.eq("category", "product")),
    ]);
    if (!products && !productPages) {
      return {
        reason: "no catalogue yet — run the storefront stage (or let the crawl index the product pages) so the demo is built from real pieces",
        terminal: await settled("storefront") && await settled("sources"),
      };
    }
  }

  if (stage === "intro_deck") {
    // The deck swaps in the brand's own pieces; with no catalogue it would just
    // re-emit AION's stock imagery under the brand's name.
    //
    // PICTURES, not products. The deck fills image slots, so a catalogue of priced rows
    // with no photography leaves it with nothing to put on a slide — and because that check
    // lived in brand-deck rather than here, it came back as a hard failure on a brand whose
    // catalogue was still being read, a minute before the pictures arrived.
    if (!(await has("storefront_products", (q: any) => q.not("image_url", "is", null)))) {
      return await settled("storefront")
        ? {
          reason: "no pictures in this brand's catalogue, so there are no pieces to put in a deck — the catalogue stage has finished and found none",
          terminal: true,
        }
        : {
          reason: "no catalogue pictures yet — the deck is built from the brand's own pieces, so the catalogue stage has to land first",
          terminal: false,
        };
    }
  }

  if (stage === "documents" || stage === "assistant") {
    if (!(await has("brand_knowledge_chunks"))) {
      // `sources` finishing means the crawl QUEUE has been filled, not that a single page
      // has been read. seed-crawl returns in seconds; the crawl then works through five
      // hundred pages on its own once-a-minute tick for the better part of an hour.
      //
      // Treating the one as the other made this terminal within seconds of a brand being
      // created — on EVERY brand — and nothing anywhere reconsiders a terminal skip. Both
      // stages therefore ended as "skipped: nothing indexed yet" on a site that went on to
      // index five hundred pages perfectly well.
      //
      // What settles it is the crawl running dry.
      const crawlPending = await has(
        "knowledge_crawl_queue", (q) => q.in("status", ["pending", "processing"]),
      );
      return {
        reason: crawlPending
          ? "nothing indexed yet — the crawl is still working through this site's pages"
          : "nothing indexed yet — the crawl has run and produced nothing to write from",
        terminal: await settled("sources") && !crawlPending,
      };
    }
  }

  return null;
}

Deno.serve(async (req: Request) => {
  // Refuse a browser origin that isn't ours before doing anything else.
  if (!originAllowed(req)) return originRefused();

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

  // A read that FAILED is not a brand that does not exist.
  //
  // This ignored the error and reported "brand 16 not found" for Pomellato — a house with a
  // demo, a catalogue and 2,686 indexed chunks — because one of two concurrent cold-start
  // invocations lost its database read (dev, 2026-09-12 11:41:07). The stage stayed queued
  // and the next tick got it, so the automation recovered; the person reading the message
  // would have gone looking for a deleted brand.
  // Retried once, because the read that fails is usually a blip and the caller is a cron
  // tick. Four of seven ticks lost their run to "Gateway Timeout" while the crawl worker,
  // the assistant check and a catalogue read were all talking to the database at once.
  let brand: Record<string, unknown> | null = null;
  let brandErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await admin.from("brands").select("*").eq("id", brandId).maybeSingle();
    brand = (r.data ?? null) as Record<string, unknown> | null;
    brandErr = r.error ?? null;
    if (!brandErr) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (brandErr) return json({ error: `could not read brand ${brandId}: ${brandErr.message}` }, 503);
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  const action = String(body.action ?? "run");
  // demo_tools_enabled is about the ENVIRONMENT, demo_allowed is about this brand.
  // The panel needs the second one; the first is kept so a caller can still tell
  // why the answer is what it is.
  if (action === "status") {
    return json({
      ...await status(admin, brandId),
      demo_tools_enabled: demoToolsEnabled(),
      demo_allowed: demoAllowedForBrand(brand),
      demo_blocked_reason: demoAllowedForBrand(brand) ? null : demoBlockedForBrandReason(brand),
    });
  }

  // Queue and return. The browser is not the runner: a cron tick advances one
  // stage a minute, so closing the tab, refreshing, or handing the brand to a
  // colleague all leave the run going and showing the same live progress.
  if (action === "start") {
    const wanted = (Array.isArray(body.stages) && body.stages.length
      ? (body.stages as string[]).filter((s) => (ALL_STAGES as readonly string[]).includes(s))
      : [...ALL_STAGES]) as Stage[];
    const demoOk = demoAllowedForBrand(brand);
    const runnable = wanted.filter((s) => demoOk || !(DEMO_STAGES as readonly string[]).includes(s));
    const skipped = wanted.filter((s) => !(runnable as string[]).includes(s));
    for (const s of skipped) {
      await setStage(admin, brandId, s, "skipped", { blocked: true, reason: demoBlockedForBrandReason(brand) });
    }
    const { error } = await admin.rpc("queue_onboarding_stages", { p_brand_id: brandId, p_stages: runnable });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, queued: runnable, skipped, status: await status(admin, brandId) });
  }

  // Called by the tick: run exactly ONE queued stage, then get out of the way.
  //
  // The tick must NOT wait for the work. pg_net cancels the request at its timeout and the
  // runtime takes the invocation down with it, so a stage whose batch runs longer than that
  // never lands: Buccellati's catalogue read takes thirty seconds against a twenty-second
  // timeout, and four ticks in a row started it, were cut, and wrote nothing — the row sat
  // 'pending' with its old detail and the screen said "queued" for as long as you cared to
  // watch. Claim the stage, answer, and finish the work in the background; the row's own
  // status is what reports progress, with the fifteen-minute sweeper behind it.
  if (action === "run_queued") {
    const stage = String(body.stage ?? "") as Stage;
    if (!(ALL_STAGES as readonly string[]).includes(stage)) return json({ error: "unknown stage" }, 400);
    await setStage(admin, brandId, stage, "running");
    const work = (async () => {
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
          return { ok: true, stage, continuing: true, result: out };
        }

        await setStage(admin, brandId, stage, outcomeOf(out, ok), out,
          ok ? null : String((out as { reason?: string }).reason ?? "stage did not complete"));
        // Cancel only what actually needed this stage. Everything else keeps its place in
        // the queue: a house with no product feed should still get its documents, its
        // assistant check, its ops deck and its data request.
        const blocked = ok ? [] : blockedBy(stage);
        if (blocked.length) {
          await admin.from("brand_onboarding").update({ queued_at: null })
            .eq("brand_id", brandId).eq("status", "pending").in("stage", blocked);
        }
        return { ok, stage, blocked, result: out };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await setStage(admin, brandId, stage, "failed", {}, msg);
        return { ok: false, stage, error: msg };
      }
    })();

    // waitUntil keeps the isolate alive after the response; without it (a local `supabase
    // functions serve`, or a runtime that does not provide it) fall back to waiting, which
    // is the old behaviour rather than a silent no-op.
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (typeof runtime?.waitUntil === "function") {
      runtime.waitUntil(work);
      return json({ ok: true, stage, started: true });
    }
    return json(await work);
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
  // Stages skipped because something they needed failed earlier in this run.
  const skippedByFailure = new Set<Stage>();

  // Demo stages are dev-only. Asking for them in production is not an error to
  // hide — it is reported per stage, and the real onboarding stages still run.
  

  const results: Record<string, unknown> = {};
  for (const stage of requested) {
    if (skippedByFailure.has(stage)) {
      results[stage] = { ok: true, skipped: true, reason: "something it needs failed earlier in this run" };
      continue;
    }
    if ((DEMO_STAGES as readonly string[]).includes(stage) && !demoAllowedForBrand(brand)) {
      const reason = demoBlockedForBrandReason(brand);
      await setStage(admin, brandId, stage, "skipped", { blocked: true, reason });
      results[stage] = { ok: true, skipped: true, reason };
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
        return { ok: true, stage, continuing: true, result: out };
      }

      await setStage(admin, brandId, stage, outcomeOf(out, ok), out,
        ok ? null : String((out as { reason?: string }).reason ?? "stage did not complete"));
      results[stage] = out;
      // Skip what needed this one, and carry on with everything that did not. Stopping the
      // whole run was how one failure left a brand with no documents and no data request.
      if (!ok) for (const s of blockedBy(stage)) skippedByFailure.add(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setStage(admin, brandId, stage, "failed", {}, msg);
      results[stage] = { ok: false, error: msg };
      for (const s of blockedBy(stage)) skippedByFailure.add(s);
    }
  }

  return json({
    ok: true, brand_id: brandId, ran: results,
    demo_tools_enabled: demoToolsEnabled(),
    demo_allowed: demoAllowedForBrand(brand),
    status: await status(admin, brandId),
  });
});

// Not everything that did not finish is a failure.
//
// A stage that is waiting for an ANSWER — the demo book asking for a typical retail price,
// because the site renders its prices in JavaScript — is a question, not a breakage. And a
// stage that cannot run because the thing it needs genuinely does not exist is finished
// with, not broken. Marking either "failed" paints a red mark on a healthy brand and sends
// somebody to fix a site that has nothing wrong with it.
/**
 * Whether we yet know enough about the site to say if it has a catalogue.
 *
 * Detection reads pages off the crawl's URL list, so what it needs is DISCOVERY — the
 * sitemap pass in `sources`, which takes one tick and hands over the whole site — not the
 * crawl itself, which then works through those pages at eight a minute for an hour.
 *
 * Before this, a non-Shopify house onboarded from scratch had its catalogue judged three
 * minutes in, off the eight pages the crawl had managed by then, and the answer was recorded
 * as 'none' for good: no deck, no demo, no way back without a person pressing Run.
 */
async function catalogueReadiness(
  admin: ReturnType<typeof createClient>, brandId: number,
): Promise<{ discovered: number; canDecide: boolean }> {
  const { count } = await admin.from("knowledge_crawl_queue")
    .select("id", { count: "exact", head: true }).eq("brand_id", brandId);
  const discovered = count ?? 0;
  if (discovered > 0) return { discovered, canDecide: true };

  // Nothing discovered. Either `sources` has not run yet — wait for it — or it has run and
  // found nothing, in which case the guessed paths are all there will ever be and there is
  // no point waiting for a list that is not coming.
  const { data } = await admin.from("brand_onboarding")
    .select("status").eq("brand_id", brandId).eq("stage", "sources").maybeSingle();
  const sources = (data as { status?: string } | null)?.status;
  return { discovered, canDecide: sources === "done" || sources === "failed" || sources === "skipped" };
}

function outcomeOf(out: unknown, ok: boolean): "done" | "failed" | "skipped" {
  if (ok) return "done";
  const d = (out ?? {}) as { needs?: string; terminal?: boolean };
  return d.needs || d.terminal === true ? "skipped" : "failed";
}

// ── Stages ───────────────────────────────────────────────────────────────────

async function runStage(
  admin: ReturnType<typeof createClient>,
  brand: Record<string, unknown>,
  stage: Stage,
  options: { customers?: number; policies?: number; avg_ticket?: number; force?: boolean },
): Promise<unknown> {
  const brandId = Number(brand.id);
  const force = options.force === true;

  // A requirement that is not met YET is a wait, not a failure.
  //
  // outcomeOf() records a non-terminal `ok: false` as 'failed', and nothing re-runs a failed
  // stage: the queue only ever picks up 'pending'. So a stage that ran a minute early — the
  // deck before the catalogue, the documents before the crawl — went permanently red and
  // needed a person to press Run, on a pipeline whose whole purpose is that nobody has to.
  // It re-queues instead, and terminality is what ends it: once the stage it is waiting on
  // has settled, unmetRequirements says terminal and this skips with the reason.
  const unmet = await unmetRequirements(admin, brandId, stage);
  if (unmet) {
    return unmet.terminal
      ? { ok: false, reason: unmet.reason, terminal: true }
      : { ok: true, waiting: unmet.reason, note: unmet.reason, continue: true };
  }

  if (stage === "branding") {
    const website = String(brand.website ?? "").trim();
    if (!website) return { ok: false, reason: "the brand has no website — add one on the brand record first" };

    // The key lets the harvester fall back to the crawl's renderer when the site refuses
    // a direct fetch, which is how most luxury storefronts answer anything but a browser.
    const id = await harvestBrandIdentity(website, JINA_API_KEY);

    // The site is the right source for colours and imagery and the wrong one for
    // a description — a storefront's meta description is written for Google's
    // results page. Wikidata/Wikipedia describe the same company as an
    // encyclopaedia would, and hold the OFFICIAL logo as a Commons file that
    // rasterises on request, so a vector wordmark arrives as a PNG a deck can
    // actually embed. Nothing is taken unless the entity's own official website
    // matches this brand's, so a same-named person or company cannot be
    // attached by accident.
    const wiki = await enrichFromWikidata(String(brand.name ?? ""), website).catch(() => null);
    if (wiki) {
      // Site-declared first, encyclopaedia second, SEO copy last.
      if (wiki.description && !String(id.description ?? "").trim()) id.description = wiki.description;
      else if (wiki.description && id.found.some((f) => f.includes("SEO metadata"))) {
        id.description = wiki.description;
        id.notes.push("replaced the site's SEO description with the encyclopaedia entry");
      }
      if (wiki.logo && !id.logo_big) id.logo_big = wiki.logo;
      id.notes.push(`matched ${wiki.entity} on ${wiki.matched_on} (${wiki.source})`);
    }
    // The house's own legal text, which is the only place a registered office actually
    // appears: no encyclopaedia carries a street address, and Wikidata's label for this
    // company is the trading name. A privacy policy states both — "Salvatore Ferragamo
    // S.p.A. with registered offices at Via de' Tornabuoni 2, 50123, Firenze" — and the
    // crawl has already indexed it.
    //
    // On a brand created minutes ago the crawl has NOT run yet, because branding is queued
    // ahead of it. That is worth saying rather than silently returning nothing: running
    // this stage again once the site is indexed is what fills these two fields.
    const siteLegal = await readLegalPages(admin, brandId);
    const office = registeredOfficeFrom(siteLegal);
    const legalName = legalNameFromDescription(id.description);

    if (!siteLegal) {
      id.notes.push("no indexed pages yet — the registered office is read from the site's own legal text, so run this again once the crawl has landed");
    } else if (office) {
      id.notes.push(`registered office, from the site's own legal text: ${office.raw}`);
    } else {
      id.notes.push("the indexed pages do not state a registered office — the data request needs one, so set it by hand on the record");
    }
    if (legalName) {
      id.notes.push(nameIsConfirmedBy(legalName, siteLegal)
        ? `legal entity "${legalName}", confirmed word for word on the brand's own site`
        : `legal entity "${legalName}" — NOT found on the brand's own site, so check it before it goes on a contract`);
    } else {
      id.notes.push("no legal entity could be established — the trading name is not one, so the data request needs it filled by hand");
    }

    // The claim tiles would rather have a piece than a campaign crop, and the catalogue is
    // the only place a piece comes from. Done here rather than in the harvester because the
    // harvester only ever sees the website.
    const pieces = await claimTilePieces(admin, brandId, 6);
    if (pieces[0]) id.theft_image = pieces[0];
    if (pieces[1]) id.damage_image = pieces[1];
    if (pieces[2]) id.faq_image = pieces[2];
    if (pieces[3]) id.feedback_image = pieces[3];

    // The two hero slots want atmosphere, and a homepage campaign shot is the right thing
    // there — which is fine until the homepage renders its photography in JavaScript and
    // hands the harvest nothing at all. Pomellato reached a demo that way: a blank sign-in
    // screen and a blank dashboard banner, on a house with sixty-two photographed pieces in
    // its own catalogue.
    //
    // A piece is not the ideal picture for a 3:1 banner. It is enormously better than a grey
    // box, the portal crops it to fit, and an admin can drop a campaign shot over it in one
    // click. Last resort only: the site gave nothing for this slot AND the record is empty.
    const heroFallbacks = [
      ["auth_background_image", "sign-in background", pieces[4]],
      ["top_banner_image", "dashboard banner", pieces[5]],
    ] as const;
    for (const [slot, label, piece] of heroFallbacks) {
      if (!piece || id[slot] || (brand as Record<string, unknown>)[slot]) continue;
      id[slot] = piece;
      id.notes.push(`no wide photography on the homepage, so the ${label} is a piece from the brand's own catalogue — worth replacing with a campaign shot`);
    }

    // Only fill what is EMPTY. A logo or colour an admin chose deliberately
    // outranks anything scraped, and overwriting it silently would be worse
    // than finding nothing.
    const patch: Record<string, unknown> = {};
    const fillable: [string, unknown][] = [
      // The data request needs the registered address, and it was going out
      // blank because nothing ever filled it.
      //
      // The site's city wins over the encyclopaedia's when the site states an office: the
      // address has to be internally consistent, and "Via de' Tornabuoni 2, 50123,
      // Florence" is a street in Firenze with an English city bolted on.
      ["legal_name", legalName],
      // Three sources, most specific first: the legal page the house publishes its
      // registered office on, the schema.org PostalAddress it hands Google, then the
      // encyclopaedia. A brand-new house was arriving with a city and nothing else — no
      // street, no postcode — which is exactly the pair the data request asks for.
      ["hq_address", office?.street ?? id.hq_address],
      ["hq_postcode", office?.postcode ?? id.hq_postcode],
      ["hq_city", office?.city ?? id.hq_city ?? wiki?.hq_city],
      // The office's own language and postcode settle the country when they agree, and they
      // are better evidence than either of the others: schema.org rarely carries a country
      // and the encyclopaedia describes the group rather than the registered entity. It is
      // also what makes the Chubb policy prefix — Messika came out MESXX, a placeholder in a
      // bordereau key, on an address that says 75008 Paris.
      ["hq_country", office?.country ?? id.hq_country ?? wiki?.hq_country],
      ["description", id.description], ["email", id.email],
      ["logo_big", id.logo_big], ["logo_small", id.logo_small],
      // All six portal slots. Four of them were never in this list, so a brand could finish
      // onboarding with the claim, FAQ and feedback screens carrying nothing at all.
      ["top_banner_image", id.top_banner_image], ["auth_background_image", id.auth_background_image],
      ["theft_image", id.theft_image], ["damage_image", id.damage_image],
      ["faq_image", id.faq_image], ["feedback_image", id.feedback_image],
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

    // ── Hold the pictures ourselves ──────────────────────────────────────────────────────
    // Everything above stored the ADDRESS a picture was found at, on a brand's own CDN. That
    // survives exactly until the house redesigns, and then a client opens the portal to a
    // broken monogram and six grey boxes with nothing in AION aware of it. So the bytes are
    // copied into our own buckets and the record keeps our url.
    //
    // This runs over the EFFECTIVE value — what this pass is about to write, or what is
    // already on the record when this pass kept it. Re-hosting a picture an admin chose is
    // not overriding them: it is the same image, at an address that cannot be taken away.
    // It is also the one thing the "Upload logos and imagery" go-live item was waiting on.
    const effectiveImages: Partial<Record<ImageSlot, string>> = {};
    for (const slot of IMAGE_SLOTS) {
      const value = (patch[slot] ?? (brand as Record<string, unknown>)[slot]) as unknown;
      if (typeof value === "string" && value.trim() && !servedByAion(value)) {
        effectiveImages[slot] = value.trim();
      }
    }
    if (Object.keys(effectiveImages).length) {
      const held = await mirrorBrandImages(admin, brandId, effectiveImages, website);
      for (const [slot, url] of Object.entries(held.urls)) {
        if (url && url !== (brand as Record<string, unknown>)[slot]) patch[slot] = url;
      }
      id.notes.push(...held.notes);
    }

    if (Object.keys(patch).length) {
      const { error } = await admin.from("brands").update(patch).eq("id", brandId);
      if (error) throw new Error(`brand update: ${error.message}`);
    }

    // The data-request workbook is built FROM legal_name and the registered address, and on
    // a brand's first pass this stage runs before the crawl — so those cells are blank when
    // the workbook is generated, and the workbook is queued ahead of the second pass that
    // fills them. If this pass has just filled them, whatever workbook exists is already
    // wrong in the two places that matter most, so build it again.
    const filledForWorkbook = patch.legal_name != null || patch.hq_address != null || patch.hq_postcode != null;
    if (filledForWorkbook) {
      const { error } = await admin.rpc("queue_onboarding_stages", {
        p_brand_id: brandId, p_stages: ["data_request"],
      });
      if (error) console.error("[onboard-brand] could not re-queue the data request", error.message);
      // Say which of the two was found. It used to claim "now that the legal entity and
      // address are known" whenever EITHER landed, so a brand whose legal entity could not
      // be established — the note directly above says so — was told in the next line that
      // it had been. Two contradictory sentences, one of them wrong, every time.
      else {
        const what = patch.legal_name != null
          ? (patch.hq_address != null || patch.hq_postcode != null ? "legal entity and address" : "legal entity")
          : "registered address";
        id.notes.push(`the data request has been queued again, now that the ${what} is known`);
      }
    }

    // Everything on the record that is not visual: the focus, the FAQ, the fee rates and
    // the policy prefix. Runs here and again after the catalogue lands, because the focus
    // and the claim imagery are read out of the catalogue and it does not exist yet on a
    // brand's first pass.
    const defaults = await fillRecordDefaults(admin, brandId);
    id.notes.push(...defaults.notes);

    return {
      ok: true,
      filled: [...Object.keys(patch), ...defaults.filled],
      kept_existing: kept,
      found: id.found,
      notes: id.notes,
      enriched_from: wiki ? { entity: wiki.entity, source: wiki.source, founded: wiki.founded } : null,
      legal: { name: legalName, office: office?.raw ?? null, read_pages: siteLegal.length > 0 },
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

    // Detection has to fit inside one invocation with room left for the sync that follows.
    // It did not, and the stage was being killed before it could write anything at all —
    // Ferragamo never so much as got a storefront_sources row, on any attempt.
    const deadline = Date.now() + 70_000;

    // A URL somebody typed in is a house telling us where its catalogue is, and it need not
    // be a shop at all — a Google Shopping feed is the same catalogue, maintained by them,
    // and the only source that stays current without us doing anything. Tried first,
    // because it is one request and it settles the question.
    const { data: configured } = await admin.from("storefront_sources")
      .select("base_url").eq("brand_id", brandId).maybeSingle();
    const typedIn = String((configured as { base_url?: string } | null)?.base_url ?? "").trim();
    if (typedIn && typedIn.replace(/\/+$/, "") !== base.replace(/\/+$/, "")) {
      const items = await detectFeed(typedIn, deadline);
      if (items > 0) {
        await admin.from("storefront_sources").upsert(
          { brand_id: brandId, base_url: typedIn, platform: "feed", enabled: true,
            detected_at: new Date().toISOString() },
          { onConflict: "brand_id" },
        );
        const synced = await callFn("sync-storefront", { brand_id: brandId, max: STOREFRONT_BATCH });
        const { count } = await admin.from("storefront_products")
          .select("id", { count: "exact", head: true }).eq("brand_id", brandId);
        const defaults = (count ?? 0) > 0 ? await fillRecordDefaults(admin, brandId) : { filled: [], notes: [] };
        const revived = await reviveSkipped(admin, brandId, "storefront");
        return {
          ok: true, platform: "feed", base: typedIn, products: count ?? 0,
          record_defaults: defaults.filled,
          ...(revived.length ? { revived } : {}),
          note: `read ${items} pieces from the product feed at ${typedIn} — the house maintains this file itself, so it stays current with nothing for us to do.`,
          synced,
        };
      }
    }

    const detected = await detectShopify(base, deadline);
    if (Date.now() > deadline) {
      return { ok: false, reason: `${base} did not answer in time — no catalogue could be detected. It may be blocking us, or simply slow; run this stage again.` };
    }
    if (!detected) {
      // No Shopify feed. Before giving up, look for the structured data the site
      // publishes for Google: schema.org Product, which most of the luxury
      // market emits even when it blocks plain fetches. That is the difference
      // between a brand with a catalogue and a brand without one, and therefore
      // between an intro deck with their pieces in it and AION's stock imagery.
      // Detection reads the pages the CRAWL has indexed, so asking it before the crawl has
      // got anywhere answers a question it cannot yet answer — and answers it "no".
      //
      // That is what happened to every non-Shopify house onboarded from scratch. The queue
      // runs branding, sources, storefront: by the time this stage ran, `sources` had
      // enqueued 520 pages and the worker had fetched EIGHT of them, none of which was a
      // product page. Detection found nothing, wrote platform 'none' with enabled false,
      // and that was permanent — nothing re-runs it when the crawl finishes. intro_deck
      // then skipped itself as terminal ("this site publishes no product feed"), demo_data
      // skipped for want of prices, and a house with a full catalogue was recorded as
      // having none, three minutes into its onboarding, for good.
      const ready = await catalogueReadiness(admin, brandId);
      if (!ready.canDecide) {
        // Say nothing about the platform yet: an absent row is "not known", and 'none' is a
        // verdict. Come back once the site's own URL list exists.
        return {
          ok: true, platform: null, products: 0,
          note: "waiting for the site's page list before deciding whether it publishes a catalogue",
          continue: true,
        };
      }
      const structured = await detectStructured(admin, brandId, base, deadline);
      // "We looked and there is nothing" and "we were not allowed to look" are different
      // answers, and only one of them is about the brand. Recorded as 'blocked' so nothing
      // downstream mistakes a locked door for an empty shop.
      const blocked = structured.found === 0 && structured.refused > 0 &&
        structured.refused >= Math.ceil(structured.tried / 2);

      await admin.from("storefront_sources").upsert(
        {
          brand_id: brandId, base_url: base,
          platform: structured.found > 0 ? "structured" : blocked ? "blocked" : "none",
          enabled: structured.found > 0,
          detected_at: new Date().toISOString(),
        },
        { onConflict: "brand_id" },
      );

      if (structured.found === 0) {
        // Both page readers have failed. Before calling it a dead end, take what the
        // sitemap itself names — on a house behind bot protection that is the only part of
        // the site anyone can reach, and it carries the pieces and their photography.
        // The read is a ~30s render; if this pass has not got the room, re-queue rather
        // than start something the runtime will cut in half.
        if (Date.now() > deadline - 40_000) {
          return { ok: true, platform: null, products: 0, continue: true,
            note: "no page of this site could be read; taking the catalogue from its sitemap needs a longer pass than this one had left" };
        }
        const salvaged = await salvageFromSitemap(admin, brandId, base);
        if ("products" in salvaged) {
          // The record's focus and the claim tiles are read out of the catalogue, which did
          // not exist a moment ago.
          const defaults = await fillRecordDefaults(admin, brandId);
          // Downstream stages gave up while there was nothing to build from.
          const revived = await reviveSkipped(admin, brandId, "storefront");
          return {
            ok: true, platform: blocked ? "blocked" : "none",
            products: salvaged.products,
            photographed: salvaged.photographed,
            record_defaults: defaults.filled,
            ...(revived.length ? { revived } : {}),
            note: `no page of this site can be read${blocked ? " — it answers a bot challenge rather than the catalogue" : ""}, so the catalogue was taken from its own sitemap: ${salvaged.products} pieces, ${salvaged.photographed} with photography. There are NO PRICES — a price is only ever on the page — so the demo book and the covered-value model need them from the client. That is what the data request in step 2 asks for.`,
          };
        }
        return blocked
          ? { ok: true, platform: "blocked", products: 0,
              note: `the site refused ${structured.refused} of ${structured.tried} requests — it is behind bot protection that answers a challenge page rather than the catalogue. Its sitemap gave nothing either: ${salvaged.why}. Ask the house for a product feed, or add its pieces by hand.` }
          : { ok: true, platform: "none", products: 0,
              note: "no product feed and no structured product data on this site — the demo book will fall back to indexed product pages" };
      }

      // Hand it to the sync exactly like Shopify, and let it re-queue itself.
      const synced = await callFn("sync-storefront", { brand_id: brandId, max: STOREFRONT_BATCH }) as
        { results?: { products?: number; embedded?: number; remaining?: number; pages_read?: number;
                      pages_remaining?: number; pages_done?: number; pages_total?: number }[] };
      const r = synced.results?.[0] ?? {};
      const { count } = await admin.from("storefront_products").select("id", { count: "exact", head: true }).eq("brand_id", brandId);
      const remaining = Number(r.remaining ?? 0);
      const pagesLeft = Number(r.pages_remaining ?? 0);
      // The focus and the claim tiles are read out of the catalogue, which did not exist
      // when the branding stage ran. Cheap and idempotent: it only fills what is empty.
      const defaults = (count ?? 0) > 0 ? await fillRecordDefaults(admin, brandId) : { filled: [], notes: [] };

      // Anything that gave up for want of a catalogue, now that there is one. This pass is
      // the right place for it: the stage re-queues itself across many minutes while the
      // read walks the site, so it outlives the crawl as well — which is why the stages
      // waiting on `sources` are reconsidered here too, rather than at the instant `sources`
      // reported done with an empty index behind it.
      // Only when the thing they were waiting for exists, or a stage that will skip again
      // for the same reason is re-run once a minute for as long as the read lasts.
      // brand_knowledge_chunks, because that is precisely what `documents` and `assistant`
      // test for — asking a different table would revive them into the same skip.
      const { count: indexed } = await admin.from("brand_knowledge_chunks")
        .select("id", { count: "exact", head: true }).eq("brand_id", brandId);
      const revived = [
        ...((count ?? 0) > 0 ? await reviveSkipped(admin, brandId, "storefront") : []),
        ...((indexed ?? 0) > 0 ? await reviveSkipped(admin, brandId, "sources") : []),
      ];

      return {
        ok: true, platform: "structured", base,
        products: count ?? 0,
        ...(revived.length ? { revived } : {}),
        record_defaults: defaults.filled,
        record_notes: defaults.notes,
        embedded_this_run: Number(r.embedded ?? 0),
        images_remaining: remaining,
        pages_read: Number(r.pages_read ?? 0),
        pages_remaining: pagesLeft,
        // How far through the site this pass is. The stage carries a long read across many
        // invocations by re-queueing itself, and without these the only thing the screen
        // could say between batches was that something was waiting to start.
        pages_done: Number(r.pages_done ?? 0),
        pages_total: Number(r.pages_total ?? 0),
        note: `no Shopify feed — reading the catalogue out of the site's own schema.org data, ${count ?? 0} products so far`,
        // Come back for the rest of the site as well as for the rest of the images. Reading
        // every page in one call is what killed the worker.
        continue: remaining > 0 || pagesLeft > 0,
      };
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
    // Same as the structured path: the focus and the claim tiles come from the catalogue.
    const defaults = (count ?? 0) > 0 ? await fillRecordDefaults(admin, brandId) : { filled: [], notes: [] };

    return {
      ok: true,
      platform: "shopify",
      base: detected.base,
      products: count ?? 0,
      record_defaults: defaults.filled,
      record_notes: defaults.notes,
      embedded_this_run: Number(r.embedded ?? 0),
      images_remaining: remaining,
      // The runner re-queues rather than finishing, so progress is visible and
      // no single call has to carry the whole catalogue.
      continue: remaining > 0,
    };
  }

  if (stage === "intro_deck") {
    const out = await callFn("brand-deck", { brand_id: brandId }) as Record<string, unknown>;
    if (out.ok === false) return out;
    return {
      ok: true,
      slots_filled: out.slots_filled, slots_total: out.slots_total,
      slides_cobranded: out.slides_cobranded, logo_source: out.logo_source,
      review: out.review,
    };
  }

  if (stage === "ops_deck") {
    // Needs nothing but the brand's name — the booklet is the same for every
    // client, which is exactly why nobody should be building it by hand.
    const out = await callFn("build-collateral", { brand_id: brandId, kind: "operations" }) as Record<string, unknown>;
    if (out.ok === false || out.error) return { ok: false, reason: String(out.reason ?? out.error) };
    return { ok: true, file_name: out.file_name, review: out.review };
  }

  if (stage === "data_request") {
    // The legal entity and address come off the brand record; build-collateral
    // falls back to them when they are not passed, and says in its review notes
    // which fields went out blank.
    const out = await callFn("build-collateral", { brand_id: brandId, kind: "data_request" }) as Record<string, unknown>;
    if (out.ok === false || out.error) return { ok: false, reason: String(out.reason ?? out.error) };
    return { ok: true, file_name: out.file_name, unmatched: out.unmatched, review: out.review };
  }

  if (stage === "demo_data") {
    // Re-checked here, not only at the door: run_queued reaches this from the cron
    // tick with a stage row that was queued before anything was flagged.
    if (!demoAllowedForBrand(brand)) return { ok: true, skipped: true, reason: demoBlockedForBrandReason(brand) };
    const { data, error } = await admin.rpc("generate_brand_demo_data", {
      p_brand_id: brandId,
      p_customers: options.customers ?? 40,
      p_policies: options.policies ?? 60,
      p_avg_ticket: options.avg_ticket ?? null,
    });
    if (error) throw new Error(error.message);

    // A demo catalogue built from indexed product PAGES has no images, and the
    // customer portal then shows a grid of empty grey squares — which reads as
    // broken, in the exact screen a prospect is shown during the demo. The
    // pages carry an og:image, so recover it.
    const pictures = await recoverCatalogueImages(admin, brandId);
    return { ...(data as Record<string, unknown>), pictures_recovered: pictures };
  }

  if (stage === "demo_users") {
    if (!demoAllowedForBrand(brand)) return { ok: true, skipped: true, reason: demoBlockedForBrandReason(brand) };
    return await createDemoUsers(admin, brand);
  }

  if (stage === "documents") {
    // Wait for the crawl. Documents written from a tenth of a website are
    // grounded in whatever happened to be fetched first — Pasquale Bruni's FAQ
    // came out based on Cannes press pages because the brand story had not been
    // reached yet. An assistant answer from a partial index is recoverable; a
    // document is an artifact someone sends to a client.
    const { count: pending } = await admin.from("knowledge_crawl_queue")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brandId).in("status", ["pending", "processing"]);

    if ((pending ?? 0) > 0) {
      // Unless the crawl has stalled — then waiting forever helps nobody, so
      // write them and say they came from a partial index.
      const { count: recent } = await admin.from("knowledge_crawl_queue")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId).eq("status", "done")
        .gte("processed_at", new Date(Date.now() - 20 * 60_000).toISOString());

      if ((recent ?? 0) > 0) {
        return {
          ok: true,
          waiting_for_crawl: pending,
          continue: true,
          note: `holding until the site is indexed — ${pending} pages left, so the drafts are written from the whole brand rather than the first tenth of it`,
        };
      }
    }

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

  // The legal entity and the registered office are read from the site's OWN legal pages,
  // and `branding` is queued before the crawl — so on a brand's first pass those pages did
  // not exist yet and the two fields the data-request workbook needs came back empty.
  // Ferragamo sat like that: no legal name, no street, no postcode, while
  // "Salvatore Ferragamo S.p.A. with registered offices at Via de' Tornabuoni 2, 50123,
  // Firenze" was in its indexed privacy policy the whole time.
  //
  // The site is indexed by the time this line runs, so send branding back for them. It is
  // guarded on the fields still being empty and this stage no longer re-queueing itself,
  // which is what keeps it a single extra pass rather than a loop — and branding without
  // `force` fills only what is blank, so nothing an admin set by hand is touched.
  const crawlDone = (pending ?? 0) === 0;
  const legalMissing = !String(brand.legal_name ?? "").trim() || !String(brand.hq_address ?? "").trim();
  let legal_requeued = false;
  if (crawlDone && legalMissing) {
    const { error } = await admin.rpc("queue_onboarding_stages", {
      p_brand_id: brandId, p_stages: ["branding"],
    });
    // Not a failure of this stage: the assistant is fine either way, and the fields can
    // still be filled by hand or by re-running branding from the panel.
    if (error) console.error("[onboard-brand] could not re-queue branding", error.message);
    else legal_requeued = true;
  }

  return {
    ok: true,
    knowledge_chunks: chunks,
    products: products ?? 0,
    customers: customers ?? 0,
    pages_still_crawling: pending ?? 0,
    legal_requeued,
    continue: (pending ?? 0) > 0,
  };
}

// Fill in missing product photos from the brand's own product pages. Bounded and
// best-effort: a demo with most of its images beats a demo with none, and a
// failure here must never fail the stage.
async function recoverCatalogueImages(
  admin: ReturnType<typeof createClient>, brandId: number,
): Promise<number> {
  const { data: rows } = await admin.from("catalogues")
    .select("id, name").eq("brand_id", brandId).is("picture", null).limit(60);
  if (!rows?.length) return 0;

  const { data: docs } = await admin.from("brand_knowledge_docs")
    .select("title, source_url").eq("brand_id", brandId).eq("category", "product")
    .not("source_url", "is", null).limit(500);
  const urlByTitle = new Map<string, string>();
  for (const d of (docs ?? []) as { title: string; source_url: string }[]) {
    if (!urlByTitle.has(d.title)) urlByTitle.set(d.title, d.source_url);
  }

  const found = new Map<number, string>();
  for (const row of rows as { id: number; name: string }[]) {
    const url = urlByTitle.get(row.name);
    if (!url) continue;
    try {
      const res = await fetch(url, { headers: { "User-Agent": AION_UA } });
      if (!res.ok) continue;
      const html = await res.text();
      const img = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];
      if (!img) continue;
      found.set(row.id, img);
    } catch { /* one missing photo is not a failed stage */ }
  }

  // A URL that comes back for several products is the site's social card, not a
  // product photo. Better an empty tile than the same logo on every piece.
  const uses = new Map<string, number>();
  for (const url of found.values()) uses.set(url, (uses.get(url) ?? 0) + 1);

  let filled = 0;
  for (const [id, url] of found) {
    if ((uses.get(url) ?? 0) > 2) continue;
    const { error } = await admin.from("catalogues").update({ picture: url }).eq("id", id);
    if (!error) filled++;
  }
  return filled;
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

  // The client account has to OWN something. A demo login with an empty account
  // is worse than no login: the customer-side review is a step in the sales
  // cycle, and "here is your portal" showing no covers, no claims and no
  // history undoes the demo. So rather than minting an empty profile, attach
  // the login to a generated client who already has a book — the one with the
  // most covers, so their portal has the most to show.
  // A set-returning RPC comes back as an ARRAY of rows — reading .profile_id
  // straight off it yields undefined, which silently falls through to minting
  // the empty profile this is meant to avoid. (Third time today this shape has
  // bitten: the failure is always silent, because undefined is a valid-looking
  // "nothing found".)
  const { data: picked } = await admin.rpc("pick_demo_client_profile", { p_brand_id: brandId });
  const pickedRow = Array.isArray(picked) ? picked[0] : picked;
  const clientProfileId = (pickedRow as { profile_id?: string } | null)?.profile_id ?? null;

  for (const p of people) {
    const password = demoPassword(slug, p.key);

    const { data: existing } = await admin.from("profiles").select("id, user_id").eq("email", p.email).maybeSingle();
    let profileId = existing?.id as string | undefined;

    // For the client: adopt the generated customer with the fullest history
    // instead of creating an empty one.
    if (!profileId && p.key === "customer" && clientProfileId) {
      const { error } = await admin.from("profiles")
        .update({ email: p.email, first_name: p.first, last_name: p.last })
        .eq("id", clientProfileId);
      if (!error) profileId = clientProfileId;
    }
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
/**
 * Stages that gave up waiting for something that has since arrived.
 *
 * A stage skips TERMINALLY when what it needs is not there and the stage that produces it
 * has already finished — "no pictures in this brand's catalogue", "nothing indexed yet".
 * That is the right call at the time and the wrong one five minutes later, because the two
 * things it waits on both arrive LONG after the stage that produces them reports done: the
 * crawl indexes pages on its own tick for an hour, and the catalogue read walks a hundred
 * and seventy-nine pages twelve at a time.
 *
 * So Messika's teaser deck and demo book skipped while the catalogue was empty, the
 * catalogue then filled up to a hundred and seventy-nine pages of real products, and nothing
 * anywhere was going to reconsider. The sweeper only rescues stages that HUNG.
 *
 * Re-queueing is safe: queue_onboarding_stages resets the row, and a stage whose reason
 * still holds simply skips again.
 */
async function reviveSkipped(
  admin: ReturnType<typeof createClient>, brandId: number, after: StageName,
): Promise<string[]> {
  const downstream = blockedBy(after);
  if (!downstream.length) return [];
  const { data } = await admin.from("brand_onboarding")
    .select("stage")
    .eq("brand_id", brandId).eq("status", "skipped").in("stage", downstream);
  const stages = ((data ?? []) as { stage: string }[]).map((r) => r.stage);
  if (!stages.length) return [];
  const { error } = await admin.rpc("queue_onboarding_stages", { p_brand_id: brandId, p_stages: stages });
  if (error) { console.error("[onboard-brand] could not revive", error.message); return []; }
  return stages;
}

async function detectShopify(base: string, deadline: number): Promise<{ base: string; keepUntyped: boolean } | null> {
  const host = base.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const candidates = host.startsWith("www.")
    ? [`https://${host}`, `https://${host.slice(4)}`]
    : [`https://${host}`, `https://www.${host}`];

  for (const c of candidates) {
    if (Date.now() > deadline) return null;
    try {
      // NO timeout here was the bug. A host that accepts the connection and then stalls
      // hangs this until the platform kills the whole invocation — and the stage row is
      // already 'running', so it stays 'running' with nothing written and nobody told.
      const res = await fetch(`${c}/products.json?limit=20`, {
        headers: { "User-Agent": AION_UA },
        redirect: "follow",
        signal: AbortSignal.timeout(Math.min(12_000, Math.max(1_000, deadline - Date.now()))),
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

// Is there a catalogue in the page's structured data? One fetch of the homepage
// is enough to tell: a storefront that publishes Product JSON-LD anywhere
// publishes it on its landing and category pages.
/**
 * Is there a product feed at this URL?
 *
 * Tried on a URL an admin typed in, which is the point at which a house has told us where
 * its catalogue is. One request, and the CONTENT decides the format — a feed is served as
 * text/plain, application/octet-stream and text/xml by different hosts for the same file.
 */
async function detectFeed(url: string, deadline: number): Promise<number> {
  if (!/^https?:\/\//i.test(url)) return 0;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": AION_UA,
        "Accept": "application/xml,text/xml,text/csv,text/plain,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.min(20_000, Math.max(2_000, deadline - Date.now()))),
    });
    if (!res.ok) return 0;
    return parseProductFeed(await res.text()).length;
  } catch {
    return 0;
  }
}

/**
 * The catalogue a sitemap gives up when no page can be read.
 *
 * Runs only after the page readers have both failed. damiani.com refuses every plain request
 * and answers the renderer with a Cloudflare interstitial, so schema.org and OpenGraph both
 * come back with nothing — while the sitemap it does serve lists 1,243 product URLs and
 * 1,314 packshots, each carrying the item code that joins them. 844 pieces, 598 of them
 * photographed, without one page being fetched.
 *
 * No PRICE: that lives on the page. Everything downstream that needs one already says so —
 * the demo book skips for want of prices, and step 2's data request is the conversation
 * where they arrive. What this buys is the teaser deck, the claim tiles, the product focus
 * and a Catalogues tab with the house's actual pieces in it, instead of a dead end.
 */
async function salvageFromSitemap(
  admin: ReturnType<typeof createClient>, brandId: number, base: string,
): Promise<{ products: number; photographed: number } | { why: string }> {
  let found: Awaited<ReturnType<typeof collectSitemap>>;
  // A rendered sitemap takes about thirty seconds. Starting one with less than that left
  // means the invocation is killed mid-read and the row is written by nobody.
  try {
    found = await collectSitemap(new URL(base), 4000, 24, JINA_API_KEY);
  } catch (e) { return { why: `the sitemap could not be read: ${(e as Error).message}` }; }
  if (!found.images.length && !found.pages.length) {
    return { why: found.rendererError ?? "the site named no sitemap, and none of the usual paths answered" };
  }

  const products = productsFromSitemap(found);
  if (!products.length) {
    return { why: `the sitemap names ${found.pages.length} pages and ${found.images.length} pictures, none of which look like products` };
  }

  const now = new Date().toISOString();
  const rows = products.map((p) => ({
    brand_id: brandId,
    handle: p.handle,
    sku: p.sku,
    name: p.name,
    category: p.category,
    // Deliberately null, not zero: a missing price has to read as missing everywhere
    // downstream, and a zero would quietly value a diamond necklace at nothing.
    price: null,
    available: true,
    image_url: p.imageUrl,
    product_url: p.productUrl,
    updated_at: now,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("storefront_products")
      .upsert(rows.slice(i, i + 200), { onConflict: "brand_id,handle", ignoreDuplicates: false });
    if (error) return { why: `storage refused the rows: ${error.message}` };
  }
  return { products: rows.length, photographed: rows.filter((r) => r.image_url).length };
}

/**
 * What a refusal looks like.
 *
 * damiani.com sits behind Cloudflare's interstitial: every product page answers 403 to a
 * plain fetch and hands the RENDERER a "Just a moment…" challenge page with a 200. Both are
 * refusals, and neither is evidence about whether the house has a catalogue — it publishes
 * six hundred and forty-three product pages in its own sitemap. Reporting that as "no
 * structured product data on this site" told an admin the brand has nothing to sell; the
 * true answer is that we are locked out, and the next move is to ask the client for a feed.
 */
function looksBlocked(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const head = body.slice(0, 2000);
  return /just a moment|cf-browser-verification|challenge-platform|captcha-delivery|px-captcha|incapsula|access denied|are you a robot/i.test(head);
}

async function detectStructured(
  admin: ReturnType<typeof createClient>, brandId: number, base: string, deadline: number,
): Promise<{ found: number; tried: number; refused: number }> {
  // Ask the pages the CRAWLER actually found, not three guessed paths.
  //
  // This used to try base, /shop and /collections/all. Ferragamo's listing pages are at
  // /shop/us/en/women/handbags — none of those three exists — so it reported "no structured
  // product data on this site" about a site with 103 indexed product pages sitting in our
  // own database. sync-storefront has always read the catalogue out of knowledge_crawl_queue;
  // detection now samples the same list, so the two cannot disagree about whether a brand
  // has a catalogue.
  // EVERY url the crawl has DISCOVERED, whatever it has done with it.
  //
  // This asked for status='done' — pages the knowledge crawl had already fetched — and that
  // is a different question from "which pages does this site have". The sitemap gives up the
  // whole list in the first minute; the crawl then works through it at eight pages a tick,
  // and on a 520-page site the product pages are hours down that queue. Buccellati's
  // catalogue was in the queue from the start and detection could not see it: it sampled the
  // hundred-odd pages already fetched, which were all categories and editorial, and recorded
  // a house with a full catalogue as having none.
  //
  // The reader fetches these pages itself, so it never needed the crawl to have read them
  // first — only to have found them.
  const { data: queued } = await admin.from("knowledge_crawl_queue")
    .select("url").eq("brand_id", brandId).limit(400);
  const crawled = rankCatalogueUrls(((queued ?? []) as { url: string }[]).map((r) => r.url));

  // Guessed paths last: they are the only hope before the crawl has run, and worthless
  // after it.
  const candidates = [...crawled, base, `${base}/shop`, `${base}/collections/all`]
    .filter((u, i, all) => all.indexOf(u) === i);

  const left = () => deadline - Date.now();
  const window = (cap: number) => Math.min(cap, Math.max(1_000, left()));

  // Cheap pass first. On a site that blocks us this costs almost nothing — a 403 comes back
  // immediately — and on a site that does not, it answers without paying for a render.
  // A SPREAD of eight, not the first eight. The ranked list is sorted by score and then
  // alphabetically, so a contiguous slice is a run of near-identical pages — see
  // catalogueSample, and the Barcelona terms that convinced this function Messika had no
  // catalogue.
  let tried = 0;
  let refused = 0;

  for (const url of catalogueSample(candidates, 8)) {
    if (left() < 3_000) return { found: 0, tried, refused };
    try {
      tried++;
      const res = await fetch(url, {
        headers: { "User-Agent": AION_UA },
        signal: AbortSignal.timeout(window(6_000)),
      });
      const body = res.ok ? await res.text() : "";
      if (looksBlocked(res.status, body)) { refused++; continue; }
      if (!res.ok) continue;
      const found = extractProducts(body, url).length;
      if (found > 0) return { found, tried, refused };
    } catch { /* a timeout is not a refusal; try the next candidate */ }
  }

  // Then the renderer, on the few most likely to be listings. One page of a luxury site
  // routinely carries sixty products, so this converges fast when it converges at all.
  if (!JINA_API_KEY) return { found: 0, tried, refused };
  for (const url of catalogueSample(candidates, 4, 2)) {
    if (left() < 20_000) break;
    try {
      tried++;
      const html = await jinaHtml(url);
      // A renderer answers 200 carrying the challenge page itself, so the status tells us
      // nothing here and the body tells us everything.
      if (looksBlocked(200, html)) { refused++; continue; }
      const found = extractProducts(html, url).length;
      if (found > 0) return { found, tried, refused };
    } catch { /* try the next candidate */ }
  }
  return { found: 0, tried, refused };
}




async function jinaHtml(url: string): Promise<string> {
  // HTML, not markdown: the structured data lives in <script> tags that a
  // markdown conversion discards.
  const res = await fetch("https://r.jina.ai/" + url, {
    headers: { "Authorization": `Bearer ${JINA_API_KEY}`, "X-Return-Format": "html", "Accept": "text/plain" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`jina HTTP ${res.status}`);
  return await res.text();
}

function normaliseBase(website: string): string | null {
  const w = website.trim();
  if (!w) return null;
  return (w.startsWith("http") ? w : `https://${w}`).replace(/\/+$/, "");
}

// ── Status: derived from the real tables, not from a status column ───────────
// The pages where a company states its own legal identity: the privacy policy, the legal
// notice, the terms. Read out of what the crawl already indexed rather than fetched again —
// the crawl has been over the whole site and these pages are always in it.
//
// The phrases are the fixed forms these houses publish in. Values are QUOTED because
// PostgREST splits or() on commas BEFORE unescaping, so an unquoted value containing one
// does not error — it silently becomes two broken filters. None of these carry a comma
// today; quoting them means the next phrase added cannot reintroduce the bug.
const LEGAL_PHRASES = [
  "registered office", "sede legale", "siège social", "domicilio social", "Geschäftsanschrift",
];

async function readLegalPages(admin: ReturnType<typeof createClient>, brandId: number): Promise<string> {
  const clauses = LEGAL_PHRASES
    .map((phrase) => `content.ilike."%${phrase.replace(/["\\]/g, (ch) => `\\${ch}`)}%"`)
    .join(",");

  const { data, error } = await admin
    .from("brand_knowledge_chunks")
    // Joined through the DOCUMENT: a soft delete sets deleted_at there and leaves the chunks
    // in place, so querying chunks alone lets a page somebody deleted keep answering.
    .select("content, brand_knowledge_docs!inner(deleted_at)")
    .eq("brand_id", brandId)
    .is("brand_knowledge_docs.deleted_at", null)
    .or(clauses)
    .limit(12);

  // An error is not "the brand has no legal pages". Returning "" either way would turn a
  // permission problem into a confident "this house does not state a registered office".
  if (error) {
    console.error("[onboard-brand] legal pages", error.message);
    return "";
  }
  return ((data ?? []) as { content: string | null }[]).map((r) => r.content ?? "").join("\n\n");
}

async function status(admin: ReturnType<typeof createClient>, brandId: number) {
  const [stages, chunks, docs, queued, products, customers, policies, shops, users, src] = await Promise.all([
    // queued_at is what tells a caller the difference between "never run" and
    // "waiting for the tick". Leaving it out of the select made every queued
    // stage look idle: the panel stopped polling the moment it queued the work,
    // so a run that was progressing fine appeared frozen until someone hit
    // Refresh by hand.
    admin.from("brand_onboarding")
      .select("stage, status, detail, error, started_at, finished_at, queued_at, attempts")
      .eq("brand_id", brandId),
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

/**
 * The half of a brand record that is not a picture.
 *
 * Product focus, the customer FAQ, the fee rates and the Chubb policy prefix were all left
 * empty by onboarding and typed in by hand for every house — and half of them were then
 * forgotten, which is how a brand reached a demo with a blank FAQ tab, no activation fee and
 * no policy prefix to put in a bordereau.
 *
 * Only ever fills what is EMPTY. A rate somebody negotiated, a prefix somebody agreed with
 * Chubb and an FAQ somebody edited all outrank a default, silently overwriting any of them
 * would be worse than leaving them blank, and this runs more than once per brand.
 */
/**
 * The brand's own pieces, for the four tile slots.
 *
 * The two hero slots — the sign-in background and the portal banner — want atmosphere, and
 * a homepage campaign shot is the right thing there. The four TILES do not: "my piece was
 * stolen", "my piece was damaged", the FAQ and the feedback prompt each sit beside a small
 * picture, and a catalogue shot of an actual piece on white is what reads correctly at that
 * size. Left to the homepage, Buccellati's tiles came out as a watercolour illustration of
 * fish and a navy poster for a goldsmithing school — both real pictures on their site,
 * neither of them a piece of jewellery.
 *
 * Most valuable first, distinct, and only where the catalogue has been read.
 */
async function claimTilePieces(
  admin: ReturnType<typeof createClient>, brandId: number, want = 2,
): Promise<string[]> {
  const { data } = await admin.from("storefront_products")
    .select("image_url, price")
    .eq("brand_id", brandId)
    .not("image_url", "is", null)
    .order("price", { ascending: false, nullsFirst: false })
    .limit(24);
  const out: string[] = [];
  for (const row of (data ?? []) as { image_url: string | null }[]) {
    if (row.image_url && !out.includes(row.image_url)) out.push(row.image_url);
    if (out.length === want) break;
  }
  return out;
}

async function fillRecordDefaults(
  admin: ReturnType<typeof createClient>, brandId: number,
): Promise<{ filled: string[]; notes: string[] }> {
  const notes: string[] = [];
  // EVERY column, deliberately.
  //
  // This listed the columns it needed and missed two of them — faq_image and feedback_image
  // — while still testing them for emptiness below. A column that was never selected reads
  // as undefined, undefined reads as empty, and "only fill what is empty" quietly became
  // "overwrite it": the live brand's two uploaded portal images were replaced with hotlinks
  // to its Shopify CDN, and the go-live checklist noticed before anybody else did. One row,
  // thirty-four columns; there is nothing to save here and a whole class of bug to avoid.
  const { data: row } = await admin.from("brands").select("*").eq("id", brandId).maybeSingle();
  const brand = row as Record<string, unknown> | null;
  if (!brand) return { filled: [], notes };

  const name = String(brand.name ?? "").trim();
  if (!name) return { filled: [], notes };

  // What the catalogue says this house sells. Evidence, not marketing — see productFocus.
  const { data: products } = await admin.from("storefront_products")
    .select("name, category, collection, image_url, price")
    .eq("brand_id", brandId).limit(400);
  const rows = (products ?? []) as { name: string | null; category: string | null; collection: string | null; image_url: string | null; price: number | null }[];
  const evidence = {
    categories: rows.flatMap((r) => [r.category, r.collection]),
    names: rows.map((r) => r.name),
    description: brand.description as string | null,
  };

  const patch: Record<string, unknown> = {};
  const isEmpty = (key: string) => {
    // A key that is not on the row at all is not "empty" — it is unknown, and filling an
    // unknown is how the bug above overwrote real values. With select("*") this cannot
    // happen; the guard stays because the next person to narrow that select will not read
    // this far.
    if (!(key in brand)) return false;
    const v = brand[key];
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  };

  // ── What they sell ──
  if (isEmpty("product_focus")) {
    const focus = productFocus(evidence);
    if (focus) {
      patch.product_focus = focus;
      notes.push(`product focus read from the catalogue: ${focus}`);
    } else if (rows.length === 0) {
      notes.push("product focus left blank — no catalogue to read it from yet");
    }
  }

  // ── The prefix every policy number carries ──
  //
  // Filled when empty, and ALSO when it still ends in XX and the country has since been
  // found. XX is what this writes when it does not know where a house is registered — it is
  // never something a person would choose — and it sits in a Chubb bordereau key that
  // nothing downstream flags, because the go-live check only asks whether a prefix is set.
  // Messika was MESXX on an address reading 75008 Paris.
  const currentPrefix = String(brand.chubb_policy_prefix ?? "");
  const country = (patch.hq_country ?? brand.hq_country) as string | null;
  const placeholder = /XX\d*$/.test(currentPrefix) && Boolean(country);
  if (isEmpty("chubb_policy_prefix") || placeholder) {
    const { data: others } = await admin.from("brands").select("chubb_policy_prefix").neq("id", brandId);
    const taken = ((others ?? []) as { chubb_policy_prefix: string | null }[])
      .map((o) => o.chubb_policy_prefix ?? "").filter(Boolean);
    const next = policyPrefix(name, country, taken);
    if (next !== currentPrefix) {
      patch.chubb_policy_prefix = next;
      notes.push(placeholder
        ? `policy prefix ${next}, replacing the ${currentPrefix} placeholder now that the country is known — confirm it with Chubb before the first bordereau`
        : `policy prefix ${next} — confirm it with Chubb before the first bordereau`);
    }
  }

  // ── Fee rates ──
  const rateKeys = Object.keys(STANDARD_FEE_RATES) as (keyof typeof STANDARD_FEE_RATES)[];
  const ratesFilled = rateKeys.filter((k) => isEmpty(k));
  for (const key of ratesFilled) patch[key] = STANDARD_FEE_RATES[key];
  if (ratesFilled.length) {
    notes.push(`${ratesFilled.join(", ")} set to the programme's standard terms — the formal quotation replaces the insurance rate`);
  }

  // ── The address a customer writes to ──
  // The harvester reads the homepage, and these houses put no address there — they have a
  // contact form. It is on the client-service page, which the crawl has indexed. Buccellati
  // publishes info@ there, alongside a dozen boutique addresses and its sales people's
  // personal ones; only a role prefix on the brand's own domain is taken.
  if (isEmpty("email") && String(brand.website ?? "").trim()) {
    const { data: chunks } = await admin.from("brand_knowledge_chunks")
      .select("content")
      .eq("brand_id", brandId)
      .ilike("content", `%@%`)
      .limit(400);
    const text = ((chunks ?? []) as { content: string | null }[])
      .map((c) => c.content ?? "").join(" \n");
    const email = customerServiceEmail(text, String(brand.website));
    if (email) {
      patch.email = email;
      notes.push(`customer-service address ${email}, found on their own site — check it is the one they want clients to use`);
    }
  }

  // ── The customer FAQ ──
  if (isEmpty("faq_en") || isEmpty("faq_it")) {
    const faqs = renderFaqs({
      brand: name,
      minCoveredValue: (patch.min_covered_value ?? brand.min_covered_value) as number | null,
      maxCoveredValue: (patch.max_covered_value ?? brand.max_covered_value) as number | null,
      supportEmail: (patch.email ?? brand.email) as string | null,
      evidence,
    });
    if (isEmpty("faq_en")) patch.faq_en = faqs.en;
    if (isEmpty("faq_it")) patch.faq_it = faqs.it;
    notes.push(
      `${faqs.en.length} FAQ entries drafted in English and Italian from the approved wording. ` +
      "The launch date and the boutiques in scope are deliberately general — fill them in before publishing.",
    );
  }

  // ── The two claim tiles want a PIECE, not a campaign crop ──
  const tiles = await claimTilePieces(admin, brandId, 4);
  const tileSlots = ["theft_image", "damage_image", "faq_image", "feedback_image"] as const;
  tileSlots.forEach((slot, i) => { if (tiles[i] && isEmpty(slot)) patch[slot] = tiles[i]; });
  if (tileSlots.some((slot) => patch[slot])) {
    notes.push("the claim, FAQ and feedback tiles now show their own pieces rather than homepage photography");
  }

  if (!Object.keys(patch).length) return { filled: [], notes };
  const { error } = await admin.from("brands").update(patch).eq("id", brandId);
  if (error) {
    notes.push(`could not write the record defaults: ${error.message}`);
    return { filled: [], notes };
  }
  return { filled: Object.keys(patch), notes };
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
