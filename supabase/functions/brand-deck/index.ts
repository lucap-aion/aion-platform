// brand-deck: the intro teaser, rebranded for a prospect.
//
// The commercial cycle opens with the same 12-slide deck every time, rebranded
// by hand. This automates the part of that work which can be automated, and is
// explicit in its output about the part which cannot.
//
// An earlier version of this comment claimed the work was narrow — "34 of 47
// media files never change". That was wrong, and measuring it properly is what
// prompted the rewrite. Diffing AION_Teaser_New.pptx against the deck a human
// actually branded for Pasquale Bruni: they REPLACED 23 media files and ADDED
// 14 more. Thirty-seven, against the six imagery slots this fills.
//
// The other half of the measurement matters more. NEITHER deck names the brand
// in text on any slide — not the master, not the hand-branded one. The entire
// identity is carried by imagery, and above all by the wordmark that recurs
// bottom-left on nine of the twelve slides: AION's in the master, the BRAND's in
// the branded deck. A generated deck that leaves that mark alone is an AION deck
// with a few of the prospect's products in it, which is exactly what it looked
// like. So the logo is now placed automatically, and the review notes say
// honestly how much imagery is still an art-direction job.
//
// The pieces come from the brand's OWN catalogue, which onboarding has already
// scraped, chosen for what each slot needs: a tall editorial shot for a hero,
// the most valuable pieces for the product slots.
//
// A replacement image keeps its own format: rather than writing JPEG bytes into
// a part named .png (PowerPoint trusts the extension and would fail to render
// it), the image is added as a new part and the slide's relationship is
// repointed at it.
//
// Auth: AION admin, or batch.
// Body: { brand_id, template_key?, dry_run?,
//         brief?: { categories?: string[],            // "for Prada it has to be bags"
//                   images?: [{ slide, url }] },      // an exact photograph for one slide
//         image_urls?, text_edits? }

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";
import { focusMatcher } from "../_shared/brand-defaults.ts";
import { sniffFormat, imageSize, EMBEDDABLE, MEDIA_TYPES } from "../_shared/image-bytes.ts";
import { findBrandPhotos, pickForFrame, type FoundPhoto, type PhotoRole } from "../_shared/brand-photos.ts";
import { fitPictureInSlide, frameOf, PACKSHOT, PHOTOGRAPH } from "../_shared/picture-fit.ts";
import { fetchSite } from "../_shared/fetch-site.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") ?? "";
const BUCKET = "decks";
// 16:9 at 13.33in × 7.5in — the teaser's own slide size, used to place the co-branding
// lockup and to refuse a placement that would run off the page.
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
// Half a centimetre. Nothing is placed closer to an edge than the AION mark itself sits.
const MARGIN = 180000;
// The deck's ink. Same value as the generated decks in build-collateral.
const LOCKUP_INK = "262626";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// What a slot is FOR, which is what decides where its picture comes from.
//   product      a piece from the catalogue, filtered to the brief's categories
//   ambassador   the face of the house — campaign photography
//   lifestyle    people wearing the pieces — campaign photography
//   store        a boutique with the sign legible; nothing can derive this, so it is asked for
//   hero         the older, unspecific role. Treated as `product`.
type SlotRole = "product" | "ambassador" | "lifestyle" | "store" | "hero";
type Slot = { media: string; slide: number; role: SlotRole | string; note?: string };
type TextSlot = { find: string; replace_with: string; note?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

  const brandId = Number(body.brand_id ?? 0);
  if (!brandId) return json({ error: "brand_id required" }, 400);
  const templateKey = String(body.template_key ?? "intro_teaser");

  // A read that failed is not a brand that does not exist — see the same fix in
  // onboard-brand. 503 says "try again", which is what the tick does.
  const { data: brand, error: brandErr } = await admin.from("brands")
    .select("id, name, slug, logo_big, logo_small, product_focus, top_banner_image, auth_background_image")
    .eq("id", brandId).maybeSingle();
  if (brandErr) return json({ error: `could not read brand ${brandId}: ${brandErr.message}` }, 503);
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  const { data: tpl, error: tplErr } = await admin.from("deck_templates").select("*").eq("key", templateKey).maybeSingle();
  if (tplErr) return json({ error: `could not read the ${templateKey} template: ${tplErr.message}` }, 503);
  if (!tpl) return json({ error: `template ${templateKey} not found` }, 404);

  const slots = (tpl.slots ?? []) as Slot[];
  const textSlots = (tpl.text_slots ?? []) as TextSlot[];

  // ── The template, opened before anything is chosen ─────────────────────────
  // The frames are in the file, and which photograph belongs in a slot depends on the shape
  // of the frame it has to fill: a 3.3:1 site banner is the wrong picture for slide 10's
  // near-square tile however good it is, because the best that can be done with it there is
  // to shrink the frame around it and leave a gap. So the deck is opened first and the slots
  // are measured, and the picker below is told what shape each one wants.
  const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(tpl.storage_path);
  if (dlErr || !file) return json({ error: `template not readable: ${dlErr?.message ?? "missing"}` }, 500);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const frames = await slotFrames(zip, slots);

  // ── The imagery brief ──────────────────────────────────────────────────────
  //
  // A slot is not "an image": slide 4 wants a boutique with the sign above the door, slide 9
  // wants people wearing the pieces, slides 2 and 10 want the face of the house. Filling all
  // six from the same ranked list of packshots is what made a generated deck read as a
  // catalogue with an AION cover on it.
  //
  // So each slot now says what it is for, and each ROLE is filled from a different place:
  //
  //   product      the catalogue, filtered to the categories the brief asks for. "For Prada
  //                they have to be images of bags" is this filter — a house's catalogue is
  //                mostly whatever the crawler reached, so the brief, not the ranking,
  //                decides which part of it the deck shows.
  //   ambassador   campaign photography, which for these houses is the homepage shot that
  //                onboarding already mirrored into the brand's own storage.
  //   lifestyle    the same source. People wearing the pieces is campaign photography.
  //   store        NOTHING, ever, automatically. A boutique with a legible sign is not in a
  //                catalogue and is not on a homepage in any way this could recognise, and a
  //                packshot in that slot is worse than the stock photograph it replaces
  //                because it looks deliberate. It is named in the review notes instead.
  //
  // `images` overrides all of it, per slide: an admin who has the right photograph pastes it
  // and this gets out of the way. That is the input the brief above is a fallback for.
  const brief = (body.brief ?? {}) as {
    categories?: string[];
    images?: { slide: number; url: string }[];
  };
  // Defaults to the brand's own product focus, so "bags" does not have to be typed again for
  // a house whose record already says bags.
  const wanted = (brief.categories?.length
    ? brief.categories
    : String(brand.product_focus ?? "").split(",").map((c) => c.trim()).filter(Boolean))
    .map((c) => c.toLowerCase());

  const given = new Map<number, string>(
    (brief.images ?? []).filter((i) => i?.slide && i?.url).map((i) => [Number(i.slide), String(i.url)]));

  const products: Piece[] = Array.isArray(body.image_urls) && body.image_urls.length
    ? (body.image_urls as string[]).map((image_url) => ({ image_url, name: null }))
    : await pickBrandImages(admin, brandId, slots.length, wanted);
  const campaign = campaignImages(brand);

  // ── Photographs, off the house's own site ──────────────────────────────────
  // The portal's two hero images were the only non-packshot pictures available, and for a
  // house that publishes them as AVIF, or publishes none on its homepage, that is nothing —
  // which is how four of six slots on Prada's deck kept the template's stock photography.
  //
  // The crawl already knows where the rest are. It enqueues every page on the site, and these
  // houses file this material where the URL says so: /store-locator, /pradasphere/campaigns,
  // /world, /lookbook. Read the best few of those pages and take the photographs off them.
  //
  // Only when a role actually needs it, because each page and each measurement is a request.
  const photoRoles = [...new Set(slots
    .map((s) => (s.role ?? "product").toLowerCase())
    .filter((r): r is PhotoRole => r === "store" || r === "ambassador" || r === "lifestyle")
    // A role the brief has already answered for every one of its slots needs no searching.
    .filter((r) => slots.some((s) => (s.role ?? "").toLowerCase() === r && !given.has(s.slide))))];

  let found: FoundPhoto[] = [];
  const photoNotes: string[] = [];
  if (photoRoles.length && body.find_photos !== false) {
    // The crawl queue, not a fresh crawl: these URLs were discovered and robots-checked when
    // the site was indexed.
    const { data: crawled } = await admin.from("knowledge_crawl_queue")
      .select("url, title").eq("brand_id", brandId).limit(2000);
    const pages = (crawled ?? []) as { url: string; title: string | null }[];
    if (pages.length) {
      const out = await findBrandPhotos({
        pages, roles: photoRoles,
        readPage: async (url) => {
          const got = await fetchSite(url, { timeoutMs: 12_000 });
          const html = got.response?.ok ? await got.response.text().catch(() => null) : null;
          // A campaign page that renders its photography in JavaScript answers a plain fetch
          // with a shell: Prada's returned exactly one picture, and it was not a photograph.
          // The renderer is what the crawler already uses for these pages, and it answers in
          // markdown, whose image links imageUrlsFrom also reads.
          const thin = !html || (html.match(/<img\b/gi) ?? []).length < 3;
          if (thin && JINA_API_KEY) {
            const rendered = await fetchRendered(url);
            if (rendered) return (html ?? "") + "\n" + rendered;
          }
          return html;
        },
        // The HEADER, not the file. Dimensions and format live in the first bytes, and a
        // campaign page lists dozens of pictures — downloading each in full to measure it
        // would cost more than building the deck.
        readImageHead: async (url) => {
          const got = await fetchSite(url, { timeoutMs: 8_000, accept: "image/*,*/*" });
          const res = got.response;
          if (!res || (!res.ok && res.status !== 206)) return null;
          try { return new Uint8Array(await res.arrayBuffer()); } catch { return null; }
        },
      });
      found = out.photos;
      photoNotes.push(...out.notes);
    } else {
      photoNotes.push("nothing indexed for this brand yet, so there were no pages to look for photographs on");
    }
  }
  // Each slot takes a different picture: the same portrait three times is worse than two
  // slots left as the template had them.
  const takenPhotos = new Set<string>();
  // Not simply the best photograph left, but the best one for the shape of THIS slot's frame
  // — see pickForFrame. A slot whose frame could not be measured falls back to the ranking.
  const nextPhoto = (role: PhotoRole, frameAspect?: number): FoundPhoto | null =>
    pickForFrame(found.filter((p) => p.role === role && !takenPhotos.has(p.url)), frameAspect);

  let nextProduct = 0;
  const unfilled: string[] = [];
  const plan = slots.map((s, slotIndex) => {
    const role = (s.role ?? "product").toLowerCase();
    const explicit = given.get(s.slide);
    if (explicit) return { ...s, image_url: explicit, piece_name: null, from: "given" };

    if (role === "store" || role === "ambassador" || role === "lifestyle") {
      const photo = nextPhoto(role, frames.get(slotIndex));
      if (photo) {
        takenPhotos.add(photo.url);
        return { ...s, image_url: photo.url, piece_name: null, from: "site", source_page: photo.page };
      }
      // The portal's own hero images, for the two roles they can serve. A store is never one
      // of them — onboarding chooses those for a portal header, not for a boutique.
      if (role !== "store") {
        const url = campaign.length ? campaign[roleOrdinal(slots, s) % campaign.length] : null;
        if (url && !takenPhotos.has(url)) {
          takenPhotos.add(url);
          return { ...s, image_url: url, piece_name: null, from: "campaign" };
        }
      }
      unfilled.push(`slide ${s.slide}: ${
        role === "store" ? "a boutique photograph with the brand's sign legible"
          : role === "ambassador" ? "a campaign portrait"
          : "people wearing the pieces"
      } — none found on this house's own site, so supply one`);
      return { ...s, image_url: null, piece_name: null, from: "none" };
    }
    const piece = products.length ? products[nextProduct++ % products.length] : null;
    if (!piece) unfilled.push(`slide ${s.slide}: a piece from the catalogue — none read yet`);
    return { ...s, image_url: piece?.image_url ?? null, piece_name: piece?.name ?? null, from: piece ? "catalogue" : "none" };
  });

  if (plan.every((p) => !p.image_url)) {
    return json({
      ok: false,
      reason: products.length === 0 && campaign.length === 0
        ? "nothing to put in this deck — no catalogue images and no campaign photography for this brand yet. Run the storefront stage, or pass brief.images explicitly."
        : "no slot could be filled from the brief",
      unfilled,
    });
  }

  if (body.dry_run === true) return json({ ok: true, brand: brand.name, categories: wanted, plan, unfilled });

  // ── Rewrite the deck ───────────────────────────────────────────────────────
  const filled: {
    media: string; slide: number; role: string; from: string;
    source_page: string | null; image_url: string; bytes: number; fit: string;
  }[] = [];
  // How each swapped picture had to be fitted, for the review notes: a centre-crop is worth
  // a glance, a shrunk frame leaves a gap somebody has to look at.
  const cropped: string[] = [];
  const shrunk: string[] = [];
  const unfitted: string[] = [];

  for (const [i, s] of plan.entries()) {
    if (!s.image_url) continue;   // a slot the brief could not fill — reported, not faked
    try {
      // A slot that cannot be filled says so. It used to `continue` in silence, which is how
      // a deck could come back "5 of 6 filled" with no hint that the sixth was an AVIF
      // nothing can embed — the slide kept the template's stock photograph and looked, to
      // anyone who did not count, like a finished deck.
      const got = await fetchImageOrWhyNot(s.image_url);
      if (!got.image) {
        unfilled.push(`slide ${s.slide}: ${s.from === "campaign" ? "the campaign photograph" : "the picture chosen for it"} was not usable — ${got.why ?? "unknown"}`);
        continue;
      }
      const img = got.image;

      const ext = img.ext;
      const oldName = s.media.replace("ppt/media/", "");
      const newName = `brand${brandId}_${i}.${ext}`;
      const relPath = `ppt/slides/_rels/slide${s.slide}.xml.rels`;
      const rels = await zip.file(relPath)?.async("string");
      if (!rels) { unfilled.push(`slide ${s.slide}: the slide has no relationships file to read`); continue; }
      // Which relationship the slide's picture embeds — read BEFORE any repointing, since
      // that is what ties the media part to the shape whose frame has to be re-fitted.
      const relId = new RegExp(`Id="([^"]+)"[^>]*Target="[^"]*${oldName.replace(".", "\\.")}"`).exec(rels)?.[1]
        ?? new RegExp(`Target="[^"]*${oldName.replace(".", "\\.")}"[^>]*Id="([^"]+)"`).exec(rels)?.[1] ?? null;

      // Same extension → overwrite in place, no relationship surgery needed.
      if (oldName.split(".").pop()?.toLowerCase() === ext) {
        zip.file(s.media, img.bytes);
      } else {
        // A part whose extension the package does not declare makes the whole file invalid,
        // not just this picture — PowerPoint offers to repair it.
        await declareMedia(zip, ext);
        zip.file(`ppt/media/${newName}`, img.bytes);
        zip.file(relPath, rels.replaceAll(`../media/${oldName}`, `../media/${newName}`));
      }

      // ── Fit it ─────────────────────────────────────────────────────────────
      // The frame and the crop on that slide were measured against the photograph that was
      // just replaced. Left alone they distort this one — see picture-fit.ts. This is the
      // whole of Giulio's "le immagini vengono stretchate in modo strano".
      let fitMode = "unfitted";
      const slidePath = `ppt/slides/slide${s.slide}.xml`;
      const slideXml = await zip.file(slidePath)?.async("string");
      if (!relId || !slideXml) {
        unfitted.push(`slide ${s.slide} (${!relId ? "its media part is in no relationship" : "the slide is unreadable"})`);
      } else {
        // A packshot and a campaign photograph want different crops — see picture-fit.ts.
        const fitted = fitPictureInSlide(slideXml, relId, imageSize(img.bytes),
          s.role === "ambassador" || s.role === "lifestyle" || s.role === "store" ? PHOTOGRAPH : PACKSHOT);
        zip.file(slidePath, fitted.xml);
        fitMode = fitted.fit?.mode ?? "unfitted";
        if (fitted.fit?.mode === "crop") cropped.push(`slide ${s.slide} (${Math.round(fitted.fit.cropped * 100)}%)`);
        else if (fitted.fit?.mode === "shrink") shrunk.push(`slide ${s.slide}`);
        else if (!fitted.fit) unfitted.push(`slide ${s.slide} (${fitted.why ?? "unknown"})`);
      }

      filled.push({
        media: s.media, slide: s.slide, role: s.role ?? "product", from: s.from,
        // Which page a photograph came off, so a choice nobody agrees with can be traced
        // and overridden rather than argued about.
        source_page: (s as { source_page?: string }).source_page ?? null,
        image_url: s.image_url, bytes: img.bytes.byteLength, fit: fitMode,
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.warn("[brand-deck] slot", s.media, why);
      unfilled.push(`slide ${s.slide}: ${why}`);
    }
  }

  // ── Co-brand every slide ───────────────────────────────────────────────────
  // The thing that made a generated deck read as generic. Diffing the master
  // against the deck a human actually branded for Pasquale Bruni: the human
  // touched 37 media files, this swapped 6 — and, more to the point, the ONE
  // recurring element on nine of twelve slides is the wordmark bottom-left, and
  // in the branded deck it is the BRAND's wordmark. Neither deck names the brand
  // in text anywhere; the identity is entirely carried by that mark.
  //
  // So rather than replace AION's mark (this is still AION's deck, about AION's
  // service), the brand's logo is set WITH it as one lockup: under it on the title
  // slide, beside it with a × between them on every other. See coBrandSlides.
  const cobrand = await coBrandSlides(zip, tpl.logo_anchor ?? "ppt/media/image2.png", brand, brandId);

  // ── Optional text edits ────────────────────────────────────────────────────
  // A run of text is often split across several <a:t> elements, so only edits
  // that actually match a single run are applied — a partial replacement would
  // corrupt the slide, and a silent no-op is the safer failure.
  // Tokens the template can ask for, resolved from what actually went into the deck.
  //
  // The teaser's phone mockup names a product — it shipped saying "Bee Pink Gold", which is
  // nobody's piece here — and nothing replaced it, so every prospect's deck showed their
  // photograph beside somebody else's product name. The name now follows the piece that
  // landed in the first product slot, so the screenshot is internally consistent.
  const firstPiece = shortProductName(
    plan.find((p) => p.from === "catalogue" && p.piece_name)?.piece_name ?? null);
  const tokens: Record<string, string | null> = {
    "{{PRODUCT_NAME}}": firstPiece,
    "{{BRAND_NAME}}": String(brand.name ?? "") || null,
  };

  const applied: string[] = [];
  const unresolved: string[] = [];
  const requested = ((body.text_edits ?? textSlots) as TextSlot[])
    .map((e) => {
      if (!e?.replace_with || !(e.replace_with in tokens)) return e;
      const value = tokens[e.replace_with];
      // A token with nothing behind it leaves the slide alone. Writing an empty string into
      // a product name would be worse than leaving the placeholder: an empty label reads as
      // a rendering fault, where a wrong one at least reads as a deck to finish.
      if (!value) { unresolved.push(`${e.find} (no ${e.replace_with.replace(/[{}]/g, "").toLowerCase().replace(/_/g, " ")} to use)`); return null; }
      return { ...e, replace_with: value };
    })
    .filter(Boolean) as TextSlot[];
  if (Array.isArray(requested) && requested.length) {
    for (let n = 1; n <= 60; n++) {
      const path = `ppt/slides/slide${n}.xml`;
      const xml = await zip.file(path)?.async("string");
      if (!xml) continue;
      let next = xml;
      for (const e of requested) {
        if (e?.find && e?.replace_with && next.includes(e.find)) {
          next = next.replaceAll(e.find, escapeXml(e.replace_with));
          applied.push(`${e.find} → ${e.replace_with} (slide ${n})`);
        }
      }
      if (next !== xml) zip.file(path, next);
    }
  }

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const slug = String(brand.slug ?? brand.name ?? brandId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Storage keys are ASCII-only and reject the punctuation a brand name carries
  // (an em dash here failed the upload), so the path is slugged and the pretty
  // filename is attached to the signed URL instead.
  const outPath = `brands/${brandId}/aion-x-${slug}-${templateKey}.pptx`;
  const fileName = `AION x ${brand.name} — teaser.pptx`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(outPath, out, {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    upsert: true,
  });
  if (upErr) return json({ error: `upload failed: ${upErr.message}` }, 500);

  await admin.from("brand_deck_outputs").upsert({
    brand_id: brandId, template_key: templateKey, storage_path: outPath,
    slots_filled: filled, generated_at: new Date().toISOString(),
  }, { onConflict: "brand_id,template_key" });

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(outPath, 60 * 60 * 24 * 7, { download: fileName });

  return json({
    ok: true,
    brand: brand.name,
    slug,
    slots_filled: filled.length,
    slots_total: slots.length,
    slots: filled,
    unfilled,
    categories: wanted,
    photos_found: found.length,
    slides_cobranded: cobrand.slides,
    logo_source: cobrand.source,
    anchor_found_by_shape: cobrand.foundByShape,
    anchor_matched_slides: cobrand.byAnchor,
    text_edits: applied,
    text_unresolved: unresolved,
    storage_path: outPath,
    file_name: fileName,
    download_url: signed?.signedUrl ?? null,
    // Say plainly what a human still has to do — this drafts the deck, it
    // doesn't art-direct it.
    // Say plainly what a human still has to do. The old version of this list
    // undersold it badly — it read as three small checks on a finished deck,
    // when in fact a hand-branded deck touches roughly six times as many images
    // as this fills.
    review: [
      cobrand.slides > 0
        ? `${brand.name}'s logo is on ${cobrand.slides} slide${cobrand.slides === 1 ? "" : "s"} — under the AION mark on the title slide, beside it as AION × ${brand.name} on the rest.` +
          (cobrand.source === "logo_small"
            ? " It used the small logo — usually the monogram rather than the wordmark, because the main logo is a vector. A wordmark reads better in a lockup: put a PNG or JPEG one on the brand record and rebuild."
            : " Check it reads well at that size.") +
          (cobrand.skipped.length ? ` Not placed on ${cobrand.skipped.join(", ")} — no room beside the mark there, so do those by hand.` : "") +
          // The old wording here read every shape match as evidence the anchor was stale, and
          // said so on every build: the cover's mark is a different, larger part BY DESIGN and
          // can never match the anchor, so the warning fired forever and meant nothing. Only
          // an anchor that matches NO slide is actually stale.
          (cobrand.byAnchor === 0
            ? ` The template's logo_anchor (${tpl.logo_anchor ?? "unset"}) matched no slide — every mark was identified by its shape and proportions instead. That anchor is stale: check it against the media in this template.`
            : cobrand.foundByShape
              ? ` On ${cobrand.foundByShape} of them the mark was identified by its proportions rather than by logo_anchor, which is normal — a deck stores the same wordmark at more than one size and the anchor can only name one of them.`
              : "")
        : `NO BRAND LOGO on any slide — ${cobrand.reason}. The deck carries only AION's mark, which is most of what makes it look generic. Put a PNG or JPEG logo on the brand record and rebuild.`,
      wanted.length
        ? `Product slots were filled from ${wanted.join(", ")}.` +
          (filled.some((f) => f.role === "product" && f.from === "catalogue") ? "" : " NOTE: too few pieces in those categories, so the whole catalogue was used instead — check what landed on the slides.")
        : "No categories asked for and none on the brand record, so product slots took the most valuable pieces in the catalogue. Give a focus if the deck should show one part of the range.",
      ...(filled.some((f) => f.from === "site")
        ? [`${filled.filter((f) => f.from === "site").length} photograph${filled.filter((f) => f.from === "site").length === 1 ? " was" : "s were"} taken off the house's own site — ` +
           filled.filter((f) => f.from === "site").map((f) => `slide ${f.slide} from ${f.source_page}`).join("; ") +
           ". Open each one on the slide: the page said what it was about, nothing here looked at the picture."]
        : []),
      ...(photoNotes.length ? [`Looking for photography: ${photoNotes.join("; ")}.`] : []),
      ...(unfilled.length
        ? [`${unfilled.length} slot${unfilled.length === 1 ? " is" : "s are"} still the template's own photograph: ${unfilled.join("; ")}. Supply them with brief.images and rebuild.`]
        : []),
      `${filled.length} of ${slots.length} imagery slots filled. A deck branded by hand replaces around 37 images — the icons, diagrams and the pioneer logo wall are all still AION's originals and need doing by hand.`,
      ...(unresolved.length
        ? [`Text left as the template had it: ${unresolved.join("; ")}. The deck names a product on the app mockup, and that name is still the template's own.`]
        : []),
      // What replaced the old blanket warning that crops "differ from the originals" — they
      // no longer differ by accident, so the note says what was actually done to each one.
      ...(cropped.length ? [`Centre-cropped to the frame: ${cropped.join(", ")} — the percentage is how much of the long edge went.`] : []),
      ...(shrunk.length
        ? [`Too far off the frame's shape to crop, so the frame was shrunk to the picture and centred on ${shrunk.join(", ")}. Nothing is distorted and nothing is cut, but there is slide background where the old picture reached — look at those slides.`]
        : []),
      ...(unfitted.length ? [`Not fitted, so still stretched to the template's frame: ${unfitted.join(", ")}.`] : []),
      "Neither this deck nor the hand-branded reference names the brand in text anywhere; the identity is carried by imagery, so the imagery is what has to be right.",
    ],
  });
});

/**
 * The shape of the frame each slot has to fill, by slot index.
 *
 * A slot names a media part; the media part is embedded by a picture; the picture has a
 * frame. Slots whose frame cannot be read are simply absent — the picker then falls back to
 * the ranking, which is what it did for every slot before.
 */
async function slotFrames(zip: JSZip, slots: Slot[]): Promise<Map<number, number>> {
  const aspects = new Map<number, number>();
  for (const [i, s] of slots.entries()) {
    const name = s.media.replace("ppt/media/", "");
    const rels = await zip.file(`ppt/slides/_rels/slide${s.slide}.xml.rels`)?.async("string");
    const xml = await zip.file(`ppt/slides/slide${s.slide}.xml`)?.async("string");
    if (!rels || !xml) continue;
    const relId = new RegExp(`Id="([^"]+)"[^>]*Target="[^"]*${name.replace(".", "\\.")}"`).exec(rels)?.[1]
      ?? new RegExp(`Target="[^"]*${name.replace(".", "\\.")}"[^>]*Id="([^"]+)"`).exec(rels)?.[1];
    if (!relId) continue;
    const pic = (xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []).find((p) => p.includes(`r:embed="${relId}"`));
    const frame = pic ? frameOf(pic) : null;
    if (frame && frame.cy > 0) aspects.set(i, frame.cx / frame.cy);
  }
  return aspects;
}

// Put the brand's logo with the AION wordmark, as one lockup, on every slide that has one.
//
// Anchored off the AION mark itself: find the picture that embeds the anchor media on a
// slide, read its position and height, and place the brand's logo against it. Position and
// height are read per slide rather than hardcoded, so the template can move without this
// drifting.
//
// Two placements, because the title slide is not the other eleven:
//
//   slide 1       the brand's logo UNDER AION's, centred on it and smaller. It is AION's
//                 deck and AION's title slide; the brand is who it is for.
//   every other   the brand's logo NEXT TO AION's along the bottom, with a × between them:
//                 the AION × Brand lockup a co-branded deck carries on every page.
//
// It used to MIRROR the brand's logo to the opposite side of the page, which is a normal
// co-branding layout and was the wrong one here: the two marks read as two unrelated
// sponsors, and on the slides where AION's mark sits inboard the mirrored copy landed on top
// of the slide number. Width still comes from the logo's own pixel dimensions, never from the
// anchor's box — a square monogram stretched into a wordmark's 3.5:1 slot is worse than no
// logo at all.
async function coBrandSlides(
  zip: JSZip, anchorMedia: string, brand: Record<string, unknown>, brandId: number,
): Promise<{
  slides: number; source: string; reason: string; skipped: string[];
  foundByShape: number; byAnchor: number;
}> {
  const candidates: [string, unknown][] = [["logo_big", brand.logo_big], ["logo_small", brand.logo_small]];
  let logo: { bytes: Uint8Array; ext: string; w: number; h: number } | null = null;
  let source = "";
  let reason = "the brand record has no logo on it";

  for (const [field, url] of candidates) {
    if (typeof url !== "string" || !url) continue;
    // PowerPoint cannot embed an SVG without a raster fallback, and there is no
    // rasteriser in this runtime. Say which field was unusable rather than
    // failing silently on the brand whose only logo is a vector.
    if (/\.svg(\?|$)/i.test(url)) { reason = `${field} is an SVG, which cannot be embedded without rasterising it`; continue; }
    const got = await fetchImageOrWhyNot(url);
    if (!got.image) { reason = `${field} was unusable: ${got.why ?? "unknown"}`; continue; }
    const size = imageSize(got.image.bytes);
    // Dimensions are not decoration here: the width of the logo in the lockup comes from its
    // own aspect ratio, and guessing one stretches a monogram into a wordmark's slot.
    if (!size) { reason = `${field} is a ${got.image.ext.toUpperCase()} whose dimensions could not be read`; continue; }
    logo = { ...got.image, ...size }; source = field; break;
  }
  if (!logo) return { slides: 0, source: "", reason, skipped: [], foundByShape: 0, byAnchor: 0 };

  const anchorName = anchorMedia.replace("ppt/media/", "");
  const logoName = `brand${brandId}_logo.${logo.ext}`;
  await declareMedia(zip, logo.ext);
  zip.file(`ppt/media/${logoName}`, logo.bytes);
  const aspect = logo.w / logo.h;

  // The mark's own proportions, read off the part `logo_anchor` names.
  //
  // One deck stores the SAME wordmark several times: this template has it at 1197×344 on the
  // cover, 512×147 in the corner of ten slides and 66×19 on the eleventh — three parts,
  // three names, one mark, all of them 3.48:1. `logo_anchor` can only name one of them, so
  // the other two used to be matched on placement alone ("wide, short, bottom-left") and
  // reported as evidence the anchor had gone stale, which it had not. Checking a
  // shape-matched picture against the anchor's own aspect ratio corroborates it as the same
  // wordmark rather than some other wide picture that happens to sit in the margin.
  const anchorBytes = await zip.file(`ppt/media/${anchorName}`)?.async("uint8array");
  const anchorAspect = anchorBytes ? (imageSize(anchorBytes) ?? null) : null;
  const markAspect = anchorAspect ? anchorAspect.w / anchorAspect.h : null;
  const mediaAspect = new Map<string, number | null>();
  const isTheMark = async (target: string): Promise<boolean> => {
    if (markAspect === null) return true;   // nothing to corroborate against; trust the shape
    const name = target.replace(/^.*\//, "");
    if (!mediaAspect.has(name)) {
      const b = await zip.file(`ppt/media/${name}`)?.async("uint8array");
      const size = b ? imageSize(b) : null;
      mediaAspect.set(name, size ? size.w / size.h : null);
    }
    const a = mediaAspect.get(name);
    return a !== null && a !== undefined && Math.abs(a / markAspect - 1) <= 0.03;
  };

  let placed = 0;
  let byAnchor = 0;
  let foundByShape = 0;
  const skipped: string[] = [];
  for (let n = 1; n <= 60; n++) {
    const relPath = `ppt/slides/_rels/slide${n}.xml.rels`;
    const slidePath = `ppt/slides/slide${n}.xml`;
    const rels = await zip.file(relPath)?.async("string");
    const xml = await zip.file(slidePath)?.async("string");
    if (!rels || !xml) continue;

    const pics = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];

    // The AION mark on this slide, by its relationship to a known media part.
    const anchorRel = new RegExp(`Id="([^"]+)"[^>]*Target="[^"]*${anchorName.replace(".", "\\.")}"`).exec(rels)
      ?? new RegExp(`Target="[^"]*${anchorName.replace(".", "\\.")}"[^>]*Id="([^"]+)"`).exec(rels);
    let pic = anchorRel ? pics.find((p) => p.includes(`r:embed="${anchorRel[1]}"`)) : undefined;
    if (pic) byAnchor++;

    // Failing that, by its SHAPE — corroborated by its proportions.
    //
    // `logo_anchor` names a media part — "ppt/media/image2.png" — and a media part's name is
    // an accident of whichever deck was uploaded. Swap the teaser for a new version and every
    // filename changes, so the anchor matches nothing, so the brand's logo silently stops
    // appearing on any slide and the deck goes back to looking exactly as generic as it did
    // before any of this was built. The failure is invisible: the build still succeeds.
    //
    // A wordmark in the corner of a slide is recognisable without knowing its name: it is
    // wide, it is short, and it sits in the bottom margin. That is a description of the thing
    // rather than of the file it happens to live in, so it survives the swap. What the
    // placement alone cannot tell you is whether the wide short thing in the margin is the
    // MARK, so the candidate's aspect ratio is checked against the anchor's before it is
    // accepted: the same wordmark at another size still matches, a stray banner does not.
    if (!pic) {
      for (const p of pics.filter(looksLikeCornerMark)) {
        const embed = /r:embed="([^"]+)"/.exec(p)?.[1];
        const target = embed ? new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] : null;
        if (target && !await isTheMark(target)) continue;
        pic = p; foundByShape++; break;
      }
    }

    // The title slide carries a different mark: AION large and centred, not small in the
    // corner — a separate media part, so the anchor never matches there and neither does the
    // corner test. Without this the one slide the brand's logo was explicitly asked for
    // ("below AION, smaller than AION") is the one slide that never got it.
    if (!pic && n === 1) { pic = pics.find(looksLikeTitleMark); if (pic) foundByShape++; }

    if (!pic) continue;
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(pic);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
    if (!off || !ext) continue;

    const anchor = { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) };
    const spot = n === 1 ? underTheMark(anchor, aspect, xml) : besideTheMark(anchor, aspect);
    if (!spot) {
      // Better a slide with only AION's mark than a logo half off the page or sitting on
      // top of the artwork. Named, so the review notes can say which slide to do by hand.
      skipped.push(`slide ${n}`);
      continue;
    }

    const relId = `rIdLogo${n}`;
    zip.file(relPath, rels.replace("</Relationships>",
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${logoName}"/></Relationships>`));
    zip.file(slidePath, xml.replace("</p:spTree>",
      (spot.cross ? crossXml(n, spot.cross) : "") +
      `<p:pic><p:nvPicPr><p:cNvPr id="${900 + n}" name="Brand logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${spot.x}" y="${spot.y}"/><a:ext cx="${spot.cx}" cy="${spot.cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>`));
    placed++;
  }
  return {
    slides: placed, source, skipped, foundByShape, byAnchor,
    reason: placed ? "" : "no slide carries the AION wordmark to place it against",
  };
}

/**
 * The big centred AION on a title slide.
 *
 * Same proportions as the corner mark — it is the same wordmark — but large and centred
 * horizontally. Centred within a tenth of the page, because the test has to reject a
 * photograph that merely happens to be wide, and the cover's other candidate is usually
 * nothing at all.
 */
function looksLikeTitleMark(picXml: string): boolean {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(picXml);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(picXml);
  if (!off || !ext) return false;
  const x = Number(off[1]), cx = Number(ext[1]), cy = Number(ext[2]);
  if (!cx || !cy) return false;
  const aspect = cx / cy;
  const centre = x + cx / 2;
  return (
    aspect >= 2 && aspect <= 8 &&
    cx >= SLIDE_W * 0.25 &&                          // large
    Math.abs(centre - SLIDE_W / 2) <= SLIDE_W * 0.1  // and on the page's centreline
  );
}

/**
 * Does this picture look like the wordmark in the corner of a slide?
 *
 * Wide, short, and in the bottom band of the page. Deliberately narrow: a photograph that
 * happens to be letterboxed is excluded by the height cap, and a picture in the middle of the
 * slide by the bottom-band test. Getting this wrong puts a brand logo next to a photograph in
 * the middle of a slide, so it would rather match nothing.
 */
function looksLikeCornerMark(picXml: string): boolean {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(picXml);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(picXml);
  if (!off || !ext) return false;
  const y = Number(off[2]), cx = Number(ext[1]), cy = Number(ext[2]);
  if (!cx || !cy) return false;
  const aspect = cx / cy;
  return (
    aspect >= 2 && aspect <= 8 &&        // a wordmark, not a monogram and not a banner
    cy <= SLIDE_H * 0.09 &&              // small
    cx <= SLIDE_W * 0.25 &&              // and narrow, in the page's terms
    y >= SLIDE_H * 0.82                  // in the bottom margin
  );
}

type Box = { x: number; y: number; cx: number; cy: number };
type Placement = Box & { cross?: Box };

/**
 * Title slide: under AION's mark, centred on it, smaller than it.
 *
 * "Under" means under the whole title block, not under the wordmark. The cover carries a
 * tagline in a full-width box below the mark, and a logo placed a fixed gap under the mark
 * itself lands on top of the words — which is what the first render did, PRADA straight
 * through "Global coverage for luxury products".
 *
 * "Smaller" is capped on WIDTH as well as height. At 55% of AION's height a 6.4:1 wordmark is
 * exactly as wide as AION, which does not read as smaller at all; the width cap is what makes
 * the two legible as a house and the house it is for.
 */
function underTheMark(anchor: Box, aspect: number, slideXml: string): Placement | null {
  const cy = Math.min(
    Math.round(anchor.cy * 0.55),
    Math.round((anchor.cx * 0.6) / aspect),
  );
  const cx = Math.round(cy * aspect);
  if (cy < 40000) return null;   // too small to read; better none than a smudge

  const gap = Math.round(anchor.cy * 0.35);
  const y = lowestEdgeBelow(slideXml, anchor) + gap;
  if (y + cy > SLIDE_H - MARGIN) return null;
  // Centred on the mark's centre, not on the page: the mark is what it hangs from.
  const x = Math.round(anchor.x + (anchor.cx - cx) / 2);
  if (x < MARGIN || x + cx > SLIDE_W - MARGIN) return null;
  return { x, y, cx, cy };
}

/**
 * The bottom of the lowest thing that belongs to the title block.
 *
 * Everything whose top edge sits at or below the mark's own top, which on a cover is the mark
 * and the tagline under it and nothing else. Anything above the mark is a header and is not
 * in the way.
 */
function lowestEdgeBelow(slideXml: string, anchor: Box): number {
  let lowest = anchor.y + anchor.cy;
  for (const shape of slideXml.match(/<p:(?:sp|pic|graphicFrame)>[\s\S]*?<\/p:(?:sp|pic|graphicFrame)>/g) ?? []) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(shape);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(shape);
    if (!off || !ext) continue;
    const y = Number(off[2]), cy = Number(ext[2]);
    // Ignore anything that starts above the mark, and anything running to the very bottom of
    // the page — a full-bleed background would otherwise leave nowhere to put anything.
    if (y < anchor.y || y > SLIDE_H * 0.9) continue;
    lowest = Math.max(lowest, y + cy);
  }
  return lowest;
}

/**
 * Every other slide: beside AION's mark, with a × between them.
 *
 * Slightly shorter than AION's mark and vertically centred on it, which is how an "A × B"
 * lockup reads as one object rather than as two logos that happen to be adjacent.
 */
function besideTheMark(anchor: Box, aspect: number): Placement | null {
  const cy = Math.round(anchor.cy * 0.85);
  const cx = Math.round(cy * aspect);
  const gap = Math.round(anchor.cy * 0.8);
  const crossW = Math.round(anchor.cy * 1.1);

  const crossX = anchor.x + anchor.cx + gap;
  const x = crossX + crossW + gap;
  if (x + cx > SLIDE_W - MARGIN) return null;

  const y = Math.round(anchor.y + (anchor.cy - cy) / 2);
  return {
    x, y, cx, cy,
    // The × box is as tall as the AION mark and shares its top edge; the glyph is centred
    // inside it, so it lands on the optical centre of both marks.
    cross: { x: crossX, y: anchor.y, cx: crossW, cy: anchor.cy },
  };
}

/**
 * A product name that fits the label it is going into.
 *
 * The placeholder it replaces is three words on one line. These catalogues are scraped in the
 * house's own market and describe rather than name — "Borsa Prada Buckle medium in pelle
 * scamosciata con cintura" — which wrapped to five lines and overflowed the card in the app
 * mockup. Whole words only, and no ellipsis: a product label ending in "…" reads as a
 * rendering fault rather than as a name.
 */
function shortProductName(name: string | null): string | null {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= 28) return clean;
  const words = clean.split(" ");
  let out = words[0];
  for (const w of words.slice(1)) {
    if ((out + " " + w).length > 28) break;
    out += " " + w;
  }
  // A name cut after a preposition reads as a sentence someone abandoned — "Borsa Prada
  // Buckle medium in". These catalogues describe the material after one ("in pelle", "en
  // cuir"), so the cut lands on one often.
  return out.replace(/\s+(?:in|di|da|con|per|a|e|ed|the|with|and|de|en|of|à|et|und|mit|y|con)$/i, "");
}

/** The × of "AION × Brand". A text box, so it takes the deck's own ink colour and font. */
function crossXml(n: number, box: Box): string {
  // Sized off the box rather than fixed: the mark is a different height on a title slide
  // than on a content slide, and a 12pt × next to a large wordmark reads as a smudge.
  // Close to the wordmark's own cap height. At half of it the glyph reads as a full stop
  // between two logos rather than as the × of a lockup — which is what the first proof
  // render showed.
  const sz = Math.max(900, Math.min(2400, Math.round((box.cy / 12700) * 100 * 0.95)));
  return `<p:sp><p:nvSpPr><p:cNvPr id="${940 + n}" name="Lockup x"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" rIns="0" tIns="0" bIns="0" anchor="ctr"/><a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-GB" sz="${sz}" dirty="0">` +
    `<a:solidFill><a:srgbClr val="${LOCKUP_INK}"/></a:solidFill>` +
    `<a:latin typeface="Montserrat"/><a:cs typeface="Montserrat"/></a:rPr>` +
    `<a:t>×</a:t></a:r></a:p></p:txBody></p:sp>`;
}



/**
 * One page, through the renderer.
 *
 * The same service the crawler uses for sites that answer a plain fetch with a shell. Asked
 * for markdown rather than html: for these sites the html it returns is as empty as the
 * original, and the markdown carries the picture URLs.
 */
async function fetchRendered(url: string): Promise<string> {
  try {
    const res = await fetch("https://r.jina.ai/" + url, {
      headers: {
        ...(JINA_API_KEY ? { Authorization: `Bearer ${JINA_API_KEY}` } : {}),
        Accept: "text/plain",
        "X-Return-Format": "markdown",
      },
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? await res.text() : "";
  } catch { return ""; }
}

/**
 * Campaign photography this house has published, as the brand record already holds it.
 *
 * Onboarding measures the homepage's imagery, keeps the two big editorial shots for the
 * portal's hero slots and mirrors the bytes into AION storage. Those two are the only
 * pictures of this house that are NOT packshots, so they are what an ambassador or a
 * lifestyle slot gets. The top banner first: it is the wider crop, and these slots are wide.
 */
function campaignImages(brand: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const url of [brand.top_banner_image, brand.auth_background_image]) {
    if (typeof url === "string" && url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Which one of its kind this slot is — the first ambassador slot, the second, and so on. */
function roleOrdinal(slots: Slot[], slot: Slot): number {
  const role = (slot.role ?? "product").toLowerCase();
  return slots.filter((s) => (s.role ?? "product").toLowerCase() === role).indexOf(slot);
}

// Hero slots want a tall editorial shot; product slots want the pieces that
// carry the house. Both come from the brand's own catalogue.
type Piece = { image_url: string; name: string | null };

async function pickBrandImages(
  admin: ReturnType<typeof createClient>, brandId: number, want: number, categories: string[] = [],
): Promise<Piece[]> {
  // Read wider than the slots need, because the category filter below throws most of it
  // away: asking for 24 rows and then keeping only the bags leaves a deck with two pictures.
  const { data } = await admin.from("storefront_products")
    .select("image_url, price, available, category, collection, name")
    .eq("brand_id", brandId)
    .not("image_url", "is", null)
    // `category <> 'HOME'` is NULL for a product with no category, and NULL is not TRUE, so
    // this filter quietly dropped every such row. A catalogue read out of a site's
    // OpenGraph tags has no category on any product — so Buccellati, with 35 pieces and a
    // picture on every one of them, was told "no catalogue images for this brand yet" and
    // its intro deck went red.
    .or("category.is.null,category.neq.HOME")
    .order("price", { ascending: false, nullsFirst: false })
    .limit(600);

  const rows = (data ?? []) as {
    image_url: string; category: string | null; collection: string | null; name: string | null;
  }[];

  // The brief's categories, as patterns. An unrecognised word is dropped with the others
  // still applied; if NOTHING is recognised the filter is not applied at all, because
  // returning an empty deck for a typo is the wrong failure.
  const matchers = categories.map(focusMatcher).filter(Boolean) as RegExp[];
  const inScope = matchers.length
    ? rows.filter((r) => matchers.some((m) =>
        m.test([r.category, r.collection].filter(Boolean).join(" ")) || m.test(r.name ?? "")))
    : rows;
  // A category the catalogue barely has is still the category that was asked for, but a deck
  // built from two pictures repeated six times is not a deck. Fall back, visibly: the caller
  // reports what each slot was filled from.
  const source = inScope.length >= Math.min(want, 3) ? inScope : rows;

  const seen = new Set<string>();
  const out: Piece[] = [];
  for (const r of source) {
    if (seen.has(r.image_url)) continue;
    seen.add(r.image_url);
    // The NAME travels with the picture. The deck names a product on the app mockup, and a
    // deck whose screenshot says one house's piece next to another house's photograph is
    // worse than one that names nothing.
    out.push({ image_url: r.image_url, name: r.name });
    if (out.length >= want) break;
  }
  return out;
}

/**
 * [Content_Types].xml has to name every extension in the package.
 *
 * A .webp part in a package that declares only png and jpeg is not a picture that fails to
 * render — it is an invalid package, and PowerPoint offers to repair the file. The teaser
 * declares what the teaser happens to contain, so anything new has to add itself.
 */
async function declareMedia(zip: JSZip, ext: string): Promise<void> {
  const type = MEDIA_TYPES[ext];
  if (!type) return;
  const path = "[Content_Types].xml";
  const xml = await zip.file(path)?.async("string");
  if (!xml) return;
  if (new RegExp(`<Default[^>]*Extension="${ext}"`, "i").test(xml)) return;
  zip.file(path, xml.replace(/<Types\b([^>]*)>/, `<Types$1><Default Extension="${ext}" ContentType="${type}"/>`));
}

type Fetched = { bytes: Uint8Array; ext: string };

async function fetchImage(url: string): Promise<Fetched | null> {
  return (await fetchImageOrWhyNot(url)).image;
}

/** The same, but able to say what was wrong — which is what the review notes need. */
async function fetchImageOrWhyNot(url: string): Promise<{ image: Fetched | null; why?: string }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (AION deck builder)" } });
  } catch (e) {
    return { image: null, why: `could not be downloaded (${e instanceof Error ? e.message : "network error"})` };
  }
  if (!res.ok) return { image: null, why: `the server answered ${res.status}` };

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1024) return { image: null, why: "it is under 1KB — a tracking pixel or an error page" };

  const format = sniffFormat(bytes);
  if (!format) return { image: null, why: "it is not an image file, whatever the server called it" };
  if (!EMBEDDABLE.has(format)) {
    return {
      image: null,
      why: `it is ${format.toUpperCase()}, which PowerPoint cannot display and nothing here can convert — ` +
        `re-save it as a PNG or JPEG on the brand record`,
    };
  }
  return { image: { bytes, ext: format } };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return new Response(JSON.stringify(payload), {
    status: code, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
