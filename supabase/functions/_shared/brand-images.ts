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
  | { slot: ImageSlot; status: "mirrored"; url: string; bytes: number }
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
  if (!/^https?:\/\//i.test(url)) {
    return { slot, status: "skipped", reason: "not an http url" };
  }

  const where = SLOT_STORAGE[slot];
  if (!where) return { slot, status: "skipped", reason: `unknown slot ${slot}` };

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
  const contentType = sniff(bytes);
  if (!contentType) {
    return {
      slot,
      status: "skipped",
      reason: `what came back is not an image the portal can render (served as ${headerType || "no content type"})`,
    };
  }

  const ext = EXTENSION[contentType];
  const path = `brands/${brandId}-${where.name}.${ext}`;
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
  };
}

/**
 * Copy every slot we were given, one at a time.
 *
 * Sequential rather than parallel: eight simultaneous downloads from one storefront is what
 * gets an onboarding IP rate-limited, and the whole set is a few seconds either way.
 */
export async function mirrorBrandImages(
  admin: AdminClient,
  brandId: number | string,
  values: Partial<Record<ImageSlot, string | null | undefined>>,
  referer?: string | null,
): Promise<{ urls: Partial<Record<ImageSlot, string>>; notes: string[]; mirrored: number; failed: number }> {
  const urls: Partial<Record<ImageSlot, string>> = {};
  const failures: string[] = [];
  let mirrored = 0;

  for (const slot of IMAGE_SLOTS) {
    const source = values[slot];
    if (!source) continue;
    const outcome = await mirrorImage(admin, brandId, slot, String(source), referer);
    if (outcome.status === "mirrored") {
      urls[slot] = outcome.url;
      mirrored += 1;
    } else if (outcome.status === "skipped") {
      failures.push(`${slot}: ${outcome.reason}`);
    }
  }

  const notes: string[] = [];
  if (mirrored) {
    notes.push(`${mirrored} ${mirrored === 1 ? "image is" : "images are"} now held in AION storage rather than hotlinked from the brand's site`);
  }
  if (failures.length) {
    notes.push(`still pointing at the brand's own site: ${failures.join("; ")}`);
  }
  return { urls, notes, mirrored, failed: failures.length };
}
