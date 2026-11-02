// ==============================|| BRAND IMAGERY, HELD BY US ||============================== //
//
// Onboarding harvests a house's logo and portal imagery off its own site, and used to store
// the address it found them at. That works until the day the brand redesigns — and every one
// of these houses redesigns — at which point a client opens the portal to a broken monogram
// and six grey boxes, and nothing in AION knows it happened.
//
// So the bytes come to us. Each slot is downloaded once, written to the same bucket and path
// the admin form would have written it to, and the record keeps OUR url. The picture is
// identical; only the host changes. It also settles the go-live item that asks for exactly
// this ("every logo and image is served from AION storage rather than hotlinked").
//
// Idempotent on purpose: the object name is fixed per brand and slot, and the cache-buster is
// a hash of the bytes, so re-running the branding stage on unchanged imagery produces the
// same url and therefore no write. That matters because this runs on every pass.

import { splitPngLogo, splitSvgLogo, initialFromPng, initialFromSvg, repaintPngDark } from "./logo-split.ts";
import { svgIsLight, repaintSvgDark } from "./brand-identity.ts";
import { rasteriseSvg, unavailable as rasterUnavailable } from "./svg-raster.ts";
import { dimensionsFromHeader } from "./brand-appearance.ts";

export type ImageSlot =
  | "logo_big" | "logo_small"
  | "auth_background_image" | "top_banner_image"
  | "theft_image" | "damage_image" | "faq_image" | "feedback_image";

/**
 * Where each slot lives, matching src/pages/admin/_components/BrandRecordForm.tsx exactly.
 *
 * Deliberately the same path as the upload widget: an admin who later drops a better logo in
 * by hand replaces this object rather than orphaning it, and the bucket does not accumulate a
 * copy per pass.
 */
const SLOT_STORAGE: Record<ImageSlot, { bucket: string; name: string }> = {
  logo_big:              { bucket: "brand_logos", name: "full" },
  logo_small:            { bucket: "brand_logos", name: "icon" },
  auth_background_image: { bucket: "brand_media", name: "auth-bg" },
  top_banner_image:      { bucket: "brand_media", name: "top-banner" },
  theft_image:           { bucket: "brand_media", name: "theft" },
  damage_image:          { bucket: "brand_media", name: "damage" },
  faq_image:             { bucket: "brand_media", name: "faq" },
  feedback_image:        { bucket: "brand_media", name: "feedback" },
};

/** Every slot, in the order the branding stage walks them. */
export const IMAGE_SLOTS = Object.keys(SLOT_STORAGE) as ImageSlot[];

/** What a browser will actually render, keyed to the extension we save it under. */
const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** 10 MB. A hero image above this is a mistake on the brand's side, not something to mirror. */
const MAX_BYTES = 10 * 1024 * 1024;

// Hotlink protection keys on these two, and a fetch that looks like a script gets a 403 from
// exactly the CDNs these houses use. The referer is the brand's own site because that is
// where the picture was found.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** Is this already served by us? Covers public urls, signed urls and bare storage paths. */
export function servedByAion(url: string | null | undefined): boolean {
  const v = String(url ?? "").trim();
  if (!v) return false;
  return v.includes("/storage/v1/object/");
}

/** What the bytes actually are, when the server's content-type is wrong or missing. */
function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  const ascii = (from: number, len: number) =>
    String.fromCharCode(...b.subarray(from, from + len));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  // The major brand of an avif is "avif", but an image sequence says "avis" and a still from
  // a phone often says "mif1", all in the same ftyp box.
  if (ascii(4, 4) === "ftyp" && /avif|avis|mif1/.test(ascii(8, 16))) return "image/avif";
  // An SVG is text, and the declaration may be preceded by an xml prologue or a comment.
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) {
    if (head.includes("<svg")) return "image/svg+xml";
  }
  return null;
}

/** Eight hex characters of sha-256 — enough to change the url when, and only when, the bytes do. */
async function shortHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).subarray(0, 4))
    .map((n) => n.toString(16).padStart(2, "0")).join("");
}

export type MirrorOutcome =
  | {
    slot: ImageSlot; status: "mirrored"; url: string; bytes: number; crest_url?: string; split?: boolean; repainted?: boolean; note?: string;
    /** The bytes as stored (a logo's NAME, after a lockup is cut) and what they are — for the
     *  monogram that is cut out of them when the site offers none. */
    data?: Uint8Array; format?: string;
  }
  | { slot: ImageSlot; status: "already_ours" }
  | { slot: ImageSlot; status: "skipped"; reason: string };

type AdminClient = {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array | Blob, opts?: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
};

/**
 * Copy ONE image into our storage and return the url to keep.
 *
 * Returns the original url untouched on any failure. A brand with a picture we could not
 * download is better off pointing at the brand's own copy than at nothing: this is a
 * durability improvement, never a reason to lose an image.
 */
export async function mirrorImage(
  admin: AdminClient,
  brandId: number | string,
  slot: ImageSlot,
  sourceUrl: string,
  referer?: string | null,
): Promise<MirrorOutcome> {
  const url = String(sourceUrl ?? "").trim();
  if (!url) return { slot, status: "skipped", reason: "no url" };
  if (servedByAion(url)) return { slot, status: "already_ours" };

  const where = SLOT_STORAGE[slot];
  if (!where) return { slot, status: "skipped", reason: `unknown slot ${slot}` };

  // A logo the page draws inline (brand-identity's inlineSvgLogo) arrives as a data: URL —
  // there is nothing to download, only bytes to keep.
  if (/^data:image\//i.test(url)) {
    const comma = url.indexOf(",");
    const head = url.slice(0, comma);
    let bytes: Uint8Array;
    try {
      bytes = /;base64/i.test(head)
        ? Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(url.slice(comma + 1)));
    } catch {
      return { slot, status: "skipped", reason: "the inline image could not be decoded" };
    }
    return await keep(admin, brandId, slot, where, bytes, "inline");
  }
  if (!/^https?:\/\//i.test(url)) {
    return { slot, status: "skipped", reason: "not an http url" };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8",
        ...(referer ? { "Referer": referer } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { slot, status: "skipped", reason: `could not be fetched (${(e as Error).message})` };
  }
  if (!res.ok) return { slot, status: "skipped", reason: `the brand's server answered ${res.status}` };

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return { slot, status: "skipped", reason: `${Math.round(declared / 1024 / 1024)} MB is too large to hold` };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) return { slot, status: "skipped", reason: "the response was empty" };
  if (bytes.length > MAX_BYTES) {
    return { slot, status: "skipped", reason: `${Math.round(bytes.length / 1024 / 1024)} MB is too large to hold` };
  }

  // The BYTES decide, and the header is only ever reported back. Two real failures sit on
  // either side of this line: a CDN serving a png as application/octet-stream, which the
  // header would have thrown away, and a hotlink block answering 200 with an HTML "access
  // denied" page labelled image/jpeg, which the header would have saved as the brand's logo
  // and left broken in the portal forever. Every format the portal can render is sniffable,
  // so nothing legitimate is lost by refusing to take the label's word for it.
  const headerType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return await keep(admin, brandId, slot, where, bytes, `served as ${headerType || "no content type"}`);
}

/**
 * The largest PNG frame inside a .ico, or null. A favicon.ico is often the only icon a house
 * declares (oris.ch: `<link rel="icon" href="/favicon.ico">`), and a browser cannot show an
 * .ico in an <img> reliably, so it was skipped and the record kept a hotlink to it. Modern
 * .ico files carry their big frames as embedded PNGs, which are kept as they are; a
 * BMP-only (old, small) .ico still yields nothing.
 */
export function pngFromIco(b: Uint8Array): Uint8Array | null {
  if (b.length < 6 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = view.getUint16(4, true);
  let best: { size: number; bytes: Uint8Array } | null = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    if (o + 16 > b.length) break;
    const w = b[o] || 256;
    const len = view.getUint32(o + 8, true);
    const at = view.getUint32(o + 12, true);
    if (at + len > b.length || len < 8) continue;
    const frame = b.subarray(at, at + len);
    const isPng = frame[0] === 0x89 && frame[1] === 0x50 && frame[2] === 0x4e && frame[3] === 0x47;
    if (isPng && (!best || w > best.size)) best = { size: w, bytes: frame };
  }
  return best?.bytes ?? null;
}

/** Sniff, store under the slot's fixed path, and return our url — the half of mirroring
 *  that does not care where the bytes came from. */
async function keep(
  admin: AdminClient,
  brandId: number | string,
  slot: ImageSlot,
  where: { bucket: string; name: string },
  bytes: Uint8Array,
  origin: string,
): Promise<MirrorOutcome> {
  bytes = pngFromIco(bytes) ?? bytes;
  let contentType = sniff(bytes);
  if (!contentType) {
    return {
      slot,
      status: "skipped",
      reason: `what came back is not an image the portal can render (${origin})`,
    };
  }

  // What the bytes ARE, not only that they are an image. Two logos that were "images" and
  // went on the record all the same: mystylebags.it's 32px favicon as the monogram, a smudge
  // in the collapsed sidebar and unusable on a slide; and a 418×768 JPEG still from a series,
  // "…-logo-…" in its name, as lgrworld.com's wordmark. A monogram under 96px is a browser-tab
  // icon, and the collapsed sidebar shows the house's initial instead; a JPEG that is not
  // clearly wider than tall is a photograph — a wordmark is wide, and a JPEG has no
  // transparency for a crest to sit on.
  const dims = dimensionsFromHeader(bytes);
  if (slot === "logo_small" && dims && Math.max(dims.width, dims.height) < 96) {
    return { slot, status: "skipped", reason: `it is only ${dims.width}×${dims.height} — a browser-tab icon, not a monogram` };
  }
  if (slot === "logo_big" && contentType === "image/jpeg" && dims && dims.width < dims.height * 1.4 && Math.min(dims.width, dims.height) >= 200) {
    return { slot, status: "skipped", reason: `it is a ${dims.width}×${dims.height} photograph, not a wordmark` };
  }

  // A WHITE logo — drawn for a transparent header over the hero picture — is invisible on
  // the portal's white header and the deck's cream slides. An SVG is repainted by its colour
  // words, a PNG cut-out pixel by pixel; the shape is the house's, only the ink changes.
  let repainted = false;
  if (slot === "logo_big" && contentType === "image/svg+xml") {
    const svg = new TextDecoder().decode(bytes);
    if (svgIsLight(svg)) { bytes = new TextEncoder().encode(repaintSvgDark(svg)); repainted = true; }
  } else if (slot === "logo_big" && contentType === "image/png") {
    const dark = await repaintPngDark(bytes).catch(() => null);
    if (dark) { bytes = dark; repainted = true; }
  }

  let crestUrl: string | undefined;
  let split = false;
  let rasterNote: string | undefined;
  const up = (name: string, b: Uint8Array, type: string) => admin.storage.from(where.bucket)
    .upload(`brands/${brandId}-${name}.${EXTENSION[type]}`, b, { contentType: type, upsert: true, cacheControl: "31536000" });
  const publicUrl = async (name: string, b: Uint8Array, type: string) =>
    `${admin.storage.from(where.bucket).getPublicUrl(`brands/${brandId}-${name}.${EXTENSION[type]}`).data.publicUrl}?v=${await shortHash(b)}`;

  if (slot === "logo_big" && (contentType === "image/png" || contentType === "image/svg+xml")) {
    const cut = contentType === "image/png"
      ? await splitPngLogo(bytes)
      : (() => {
        const r = splitSvgLogo(new TextDecoder().decode(bytes));
        return r && { name: new TextEncoder().encode(r.name), crest: r.crest ? new TextEncoder().encode(r.crest) : undefined };
      })();
    let crest: Uint8Array | undefined;
    let crestType = contentType;
    if (cut) {
      const lockup = await up("lockup", bytes, contentType);
      if (!lockup.error) {
        crest = cut.crest;
        bytes = cut.name;
        split = true;
      }
    }
    // An SVG becomes a PNG as well. PowerPoint will not embed an SVG, so the deck fell back to
    // the favicon and said "NO BRAND LOGO"; and the monogram below is cut by pixels. The SVG
    // is kept beside it (-full.svg) for anything that can draw it.
    if (contentType === "image/svg+xml") {
      const svg = new TextDecoder().decode(bytes);
      const png = await rasteriseSvg(svg, 1600);
      if (!png) rasterNote = `the logo is an SVG and could not be rendered to a PNG for the decks (${rasterUnavailable() ?? "it has no frame"}) — kept as SVG`;
      if (png) {
        await up("full", bytes, "image/svg+xml");
        bytes = png;
        contentType = "image/png";
        if (crest) {
          const crestPng = await rasteriseSvg(new TextDecoder().decode(crest), 512);
          if (crestPng) { crest = crestPng; crestType = "image/png"; }
        }
      }
    }
    if (crest) {
      const stored = await up("crest", crest, crestType);
      if (!stored.error) crestUrl = await publicUrl("crest", crest, crestType);
    }
  }

  const path = `brands/${brandId}-${where.name}.${EXTENSION[contentType]}`;
  const { error } = await admin.storage.from(where.bucket).upload(path, bytes, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) return { slot, status: "skipped", reason: `storage refused it (${error.message})` };

  const { data } = admin.storage.from(where.bucket).getPublicUrl(path);
  return {
    slot,
    status: "mirrored",
    url: `${data.publicUrl}?v=${await shortHash(bytes)}`,
    bytes: bytes.length,
    data: bytes,
    format: contentType,
    ...(split ? { split: true } : {}),
    ...(repainted ? { repainted: true } : {}),
    ...(rasterNote ? { note: rasterNote } : {}),
    ...(crestUrl ? { crest_url: crestUrl } : {}),
  };
}

/** The monogram cut out of the name: the first glyph, as a square PNG. Null when the name
 *  has no clean first glyph (a connected script, a two-line name with no first) or the
 *  renderer an SVG needs is unavailable. */
export async function monogramFrom(data: Uint8Array, format: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (format === "image/png") {
    const png = await initialFromPng(data);
    return png ? { bytes: png, type: "image/png" } : null;
  }
  if (format === "image/svg+xml") {
    const initial = initialFromSvg(new TextDecoder().decode(data));
    if (!initial) return null;
    // Rendered when the renderer is there; the SVG itself otherwise — the sidebar draws it.
    const png = await rasteriseSvg(initial, 512);
    return png ? { bytes: png, type: "image/png" } : { bytes: new TextEncoder().encode(initial), type: "image/svg+xml" };
  }
  return null;
}

/**
 * Copy every slot we were given, one at a time.
 *
 * Sequential rather than parallel: eight simultaneous downloads from one storefront is what
 * gets an onboarding IP rate-limited, and the whole set is a few seconds either way.
 *
 * `logo_candidates` are the other logos the harvest found, best first (brand-identity's
 * logo_candidates). The logo slot takes the first that copies in AS a logo: the one the site
 * declares can answer 404, the one its markup names can be a photograph, and each of those
 * used to be the end of it.
 */
export async function mirrorBrandImages(
  admin: AdminClient,
  brandId: number | string,
  values: Partial<Record<ImageSlot, string | null | undefined>>,
  referer?: string | null,
  options: { logo_candidates?: string[] } = {},
): Promise<{ urls: Partial<Record<ImageSlot, string>>; notes: string[]; mirrored: number; failed: number }> {
  const urls: Partial<Record<ImageSlot, string>> = {};
  const failures: string[] = [];
  let mirrored = 0;
  let logo: { data: Uint8Array; format: string } | null = null;

  const splitNotes: string[] = [];
  for (const slot of IMAGE_SLOTS) {
    const source = values[slot];
    if (slot === "logo_small" && urls.logo_small && (!source || /fav-?icon|favico|\.ico(?:[?#]|$)|apple-touch|site-?icon|cropped-/i.test(String(source)))) {
      continue;
    }
    const sources = slot === "logo_big"
      ? [source, ...(options.logo_candidates ?? [])].filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
      : source ? [String(source)] : [];
    if (!sources.length) continue;
    const refused: string[] = [];
    let outcome: MirrorOutcome | null = null;
    for (const candidate of sources) {
      outcome = await mirrorImage(admin, brandId, slot, candidate, referer);
      if (outcome.status !== "skipped") break;
      refused.push(outcome.reason);
    }
    if (!outcome) continue;
    if (outcome.status === "mirrored") {
      urls[slot] = outcome.url;
      mirrored += 1;
      if (slot === "logo_big" && outcome.data && outcome.format) logo = { data: outcome.data, format: outcome.format };
      if (refused.length) {
        splitNotes.push(`the logo the site offered first was not one (${refused[0]}) — took the next it offers`);
      }
      if (outcome.split) {
        splitNotes.push("the logo the site uses is a lockup — cut to the house's name for the portal, the full lockup kept as -lockup in storage");
      }
      if (outcome.repainted) {
        splitNotes.push("the site's logo is white, for its dark header — repainted dark for the portal and the decks");
      }
      if (outcome.note) splitNotes.push(outcome.note);
      if (outcome.crest_url) {
        urls.logo_small = outcome.crest_url; // provisional: a declared icon below may replace it
        splitNotes.push("its crest became the monogram for the collapsed sidebar");
      }
    } else if (outcome.status === "skipped") {
      failures.push(`${slot}: ${outcome.reason}`);
    }
  }

  // No monogram worth the name — none offered, or a favicon refused above — and a name to
  // cut one from: its initial, in the house's own letterform.
  if (!urls.logo_small && logo) {
    const initial = await monogramFrom(logo.data, logo.format).catch(() => null);
    if (initial) {
      const where = SLOT_STORAGE.logo_small;
      const path = `brands/${brandId}-${where.name}.${EXTENSION[initial.type]}`;
      const { error } = await admin.storage.from(where.bucket).upload(path, initial.bytes, { contentType: initial.type, upsert: true, cacheControl: "31536000" });
      if (!error) {
        urls.logo_small = `${admin.storage.from(where.bucket).getPublicUrl(path).data.publicUrl}?v=${await shortHash(initial.bytes)}`;
        mirrored += 1;
        splitNotes.push("the site offers no monogram, so the wordmark's own initial is the monogram for the collapsed sidebar");
      }
    }
  }

  const notes: string[] = [...splitNotes];
  if (mirrored) {
    notes.push(`${mirrored} ${mirrored === 1 ? "image is" : "images are"} now held in AION storage rather than hotlinked from the brand's site`);
  }
  if (failures.length) {
    notes.push(`still pointing at the brand's own site: ${failures.join("; ")}`);
  }
  return { urls, notes, mirrored, failed: failures.length };
}
