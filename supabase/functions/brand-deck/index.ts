// brand-deck: the intro teaser, rebranded for a prospect.
//
// The commercial cycle opens with the same 12-slide deck every time, rebranded
// by hand. Diffing the master against a real branded output shows the work is
// narrow: 34 of 47 media files never change (the AION identity, the icons, the
// team, the pioneer logos) — only the product and lifestyle imagery does, plus a
// couple of figures. So this swaps exactly the slots the template declares and
// leaves everything else alone.
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
    text_edits: applied,
    storage_path: outPath,
    file_name: fileName,
    download_url: signed?.signedUrl ?? null,
    // Say plainly what a human still has to do — this drafts the deck, it
    // doesn't art-direct it.
    review: [
      "Check every swapped image on the slide — crops and aspect ratios differ from the originals.",
      "Slide 9 (pioneer programs) and the team slide are untouched by design.",
      "The brand's logo is not placed automatically; add it where the sample deck has it.",
    ],
  });
});

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
