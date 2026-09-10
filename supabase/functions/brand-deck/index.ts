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
// Auth: AION admin, or batch. Body: { brand_id, template_key?, image_urls?, dry_run? }

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const BUCKET = "decks";
// 16:9 at 13.33in — the teaser's own slide size, used to mirror across the page.
const SLIDE_W = 12192000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Slot = { media: string; slide: number; role: string; note?: string };
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

  const { data: brand } = await admin.from("brands").select("id, name, slug, logo_big, logo_small").eq("id", brandId).maybeSingle();
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  const { data: tpl } = await admin.from("deck_templates").select("*").eq("key", templateKey).maybeSingle();
  if (!tpl) return json({ error: `template ${templateKey} not found` }, 404);

  const slots = (tpl.slots ?? []) as Slot[];
  const textSlots = (tpl.text_slots ?? []) as TextSlot[];

  // ── Pick the pieces ────────────────────────────────────────────────────────
  const picked = Array.isArray(body.image_urls) && body.image_urls.length
    ? (body.image_urls as string[])
    : await pickBrandImages(admin, brandId, slots.length);

  if (picked.length === 0) {
    return json({ ok: false, reason: "no catalogue images for this brand yet — run the storefront stage, or pass image_urls explicitly" });
  }

  const plan = slots.map((s, i) => ({ ...s, image_url: picked[i % picked.length] }));
  if (body.dry_run === true) return json({ ok: true, brand: brand.name, plan });

  // ── Rewrite the deck ───────────────────────────────────────────────────────
  const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(tpl.storage_path);
  if (dlErr || !file) return json({ error: `template not readable: ${dlErr?.message ?? "missing"}` }, 500);

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const filled: { media: string; slide: number; image_url: string; bytes: number }[] = [];

  for (const [i, s] of plan.entries()) {
    try {
      const img = await fetchImage(s.image_url);
      if (!img) continue;

      const ext = img.ext;
      const oldName = s.media.replace("ppt/media/", "");
      const newName = `brand${brandId}_${i}.${ext}`;

      // Same extension → overwrite in place, no relationship surgery needed.
      if (oldName.split(".").pop()?.toLowerCase() === ext) {
        zip.file(s.media, img.bytes);
      } else {
        zip.file(`ppt/media/${newName}`, img.bytes);
        const relPath = `ppt/slides/_rels/slide${s.slide}.xml.rels`;
        const rels = await zip.file(relPath)?.async("string");
        if (!rels) continue;
        zip.file(relPath, rels.replaceAll(`../media/${oldName}`, `../media/${newName}`));
      }
      filled.push({ media: s.media, slide: s.slide, image_url: s.image_url, bytes: img.bytes.byteLength });
    } catch (e) {
      console.warn("[brand-deck] slot", s.media, e instanceof Error ? e.message : e);
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
  // service), the brand's logo is mirrored opposite it — the bottom-left /
  // bottom-right lockup a co-branded deck normally uses. Position and height are
  // read off the AION mark on each slide rather than hardcoded, so the template
  // can move without this drifting.
  const cobrand = await coBrandSlides(zip, tpl.logo_anchor ?? "ppt/media/image2.png", brand, brandId);

  // ── Optional text edits ────────────────────────────────────────────────────
  // A run of text is often split across several <a:t> elements, so only edits
  // that actually match a single run are applied — a partial replacement would
  // corrupt the slide, and a silent no-op is the safer failure.
  const applied: string[] = [];
  const requested = (body.text_edits ?? textSlots) as TextSlot[];
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
    slides_cobranded: cobrand.slides,
    logo_source: cobrand.source,
    text_edits: applied,
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
        ? `${brand.name}'s logo is on ${cobrand.slides} slide${cobrand.slides === 1 ? "" : "s"}, opposite the AION mark.` +
          (cobrand.source === "logo_small"
            ? " It used the small logo — usually the monogram rather than the wordmark, because the main logo is a vector. A wordmark reads better here: put a PNG or JPEG one on the brand record and rebuild."
            : " Check it reads well at that size.")
        : `NO BRAND LOGO on any slide — ${cobrand.reason}. The deck carries only AION's mark, which is most of what makes it look generic. Put a PNG or JPEG logo on the brand record and rebuild.`,
      `${filled.length} of ${slots.length} imagery slots filled from their catalogue. A deck branded by hand replaces around 37 images — the icons, diagrams, lifestyle photography and the pioneer logo wall on slide 9 are all still AION's originals and need doing by hand.`,
      "Check every swapped image on the slide — crops and aspect ratios differ from the originals.",
      "Neither this deck nor the hand-branded reference names the brand in text anywhere; the identity is carried by imagery, so the imagery is what has to be right.",
    ],
  });
});

// Put the brand's logo opposite the AION wordmark, on every slide that has one.
//
// Anchored off the AION mark itself: find the picture that embeds the anchor
// media on a slide, read its position and height, and mirror it across the slide
// with the SAME height and the same bottom edge. Width comes from the logo's own
// pixel dimensions, never from the anchor's box — a square monogram forced into
// the wordmark's 3.5:1 slot would be stretched to nearly twice its width, and a
// distorted logo is worse than no logo.
async function coBrandSlides(
  zip: JSZip, anchorMedia: string, brand: Record<string, unknown>, brandId: number,
): Promise<{ slides: number; source: string; reason: string }> {
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
    const img = await fetchImage(url);
    if (!img) { reason = `${field} could not be downloaded`; continue; }
    const size = imageSize(img.bytes);
    if (!size) { reason = `${field} is not a readable PNG or JPEG`; continue; }
    logo = { ...img, ...size }; source = field; break;
  }
  if (!logo) return { slides: 0, source: "", reason };

  const anchorName = anchorMedia.replace("ppt/media/", "");
  const logoName = `brand${brandId}_logo.${logo.ext}`;
  zip.file(`ppt/media/${logoName}`, logo.bytes);

  let placed = 0;
  for (let n = 1; n <= 60; n++) {
    const relPath = `ppt/slides/_rels/slide${n}.xml.rels`;
    const slidePath = `ppt/slides/slide${n}.xml`;
    const rels = await zip.file(relPath)?.async("string");
    const xml = await zip.file(slidePath)?.async("string");
    if (!rels || !xml) continue;

    const anchorRel = new RegExp(`Id="([^"]+)"[^>]*Target="[^"]*${anchorName.replace(".", "\\.")}"`).exec(rels)
      ?? new RegExp(`Target="[^"]*${anchorName.replace(".", "\\.")}"[^>]*Id="([^"]+)"`).exec(rels);
    if (!anchorRel) continue;

    const pic = (xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [])
      .find((p) => p.includes(`r:embed="${anchorRel[1]}"`));
    if (!pic) continue;
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(pic);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
    if (!off || !ext) continue;

    const ax = Number(off[1]), ay = Number(off[2]);
    const acx = Number(ext[1]), acy = Number(ext[2]);
    // Same height, own aspect ratio, right edge mirroring the anchor's left margin.
    const cy = acy;
    const cx = Math.round(cy * (logo.w / logo.h));
    const x = Math.max(ax + acx + cy, SLIDE_W - ax - cx);

    const relId = `rIdLogo${n}`;
    zip.file(relPath, rels.replace("</Relationships>",
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${logoName}"/></Relationships>`));
    zip.file(slidePath, xml.replace("</p:spTree>",
      `<p:pic><p:nvPicPr><p:cNvPr id="${900 + n}" name="Brand logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${x}" y="${ay}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>`));
    placed++;
  }
  return { slides: placed, source, reason: placed ? "" : "no slide carries the AION wordmark to mirror" };
}

// Intrinsic pixel dimensions, straight from the file header. PNG keeps them in
// the IHDR chunk; JPEG in whichever SOF marker comes first.
function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      // SOF0-SOF15, excluding the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}

// Hero slots want a tall editorial shot; product slots want the pieces that
// carry the house. Both come from the brand's own catalogue.
async function pickBrandImages(admin: ReturnType<typeof createClient>, brandId: number, want: number): Promise<string[]> {
  const { data } = await admin.from("storefront_products")
    .select("image_url, price, available, category")
    .eq("brand_id", brandId)
    .not("image_url", "is", null)
    .neq("category", "HOME")
    .order("price", { ascending: false, nullsFirst: false })
    .limit(Math.max(want * 4, 24));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of (data ?? []) as { image_url: string }[]) {
    if (seen.has(r.image_url)) continue;
    seen.add(r.image_url);
    out.push(r.image_url);
    if (out.length >= want) break;
  }
  return out;
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (AION deck builder)" } });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = type.includes("png") ? "png"
    : type.includes("webp") ? "webp"
    : type.includes("jpeg") || type.includes("jpg") ? "jpeg"
    : url.split("?")[0].split(".").pop()?.toLowerCase() === "png" ? "png" : "jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1024) return null; // a tracking pixel or an error page
  return { bytes, ext };
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
