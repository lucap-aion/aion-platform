// The bytes of an image, read rather than trusted.
//
// Every one of these questions — what format is this, how big is it — has an answer in the
// file's own first bytes and a DIFFERENT, unreliable answer in the Content-Type header or the
// URL's extension. A hotlink block answers 200 with an HTML page labelled image/jpeg; a CDN
// serves AVIF from a path ending .jpg; a brand's own storage holds a WebP wordmark under a
// name nothing recognised. Each of those has cost a deck a picture or a logo, so the reading
// lives here on its own, where it is unit tested against real files.

/**
 * What this file ACTUALLY is, from its first bytes.
 *
 * Not from the Content-Type, which lies: a hotlink block answers 200 with an HTML page
 * labelled image/jpeg, and a CDN serving AVIF under a .jpg path is routine. And not from the
 * extension, which lies in the other direction. The bytes are the only honest answer, and
 * getting this wrong writes the wrong magic number into a part named .jpeg, which PowerPoint
 * reports as a corrupt presentation rather than as one bad picture.
 */
export function sniffFormat(b: Uint8Array): "png" | "jpeg" | "gif" | "webp" | "avif" | null {
  if (b.length < 16) return null;
  const ascii = (at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  // ISO-BMFF: "....ftyp<brand>". AVIF and HEIF share the container; both are unusable here.
  if (ascii(4, 4) === "ftyp" && /^(avif|avis|heic|heix|mif1|msf1)/.test(ascii(8, 4))) return "avif";
  return null;
}

/**
 * Formats a .pptx can carry, and the one it cannot.
 *
 * PNG and JPEG are safe everywhere. GIF and WebP are fine in current PowerPoint provided the
 * package DECLARES them — see declareMedia. AVIF and HEIC are not supported by any version of
 * PowerPoint, and there is no rasteriser in this runtime to convert them, so they are refused
 * with a reason rather than embedded as a file that renders as a grey box with a red cross.
 *
 * This is not hypothetical. Prada's brand record holds a WebP wordmark and an AVIF campaign
 * shot — both mirrored into AION storage by onboarding, which keeps whatever the house
 * published. The deck read the WebP as "not a readable PNG or JPEG", fell back to the small
 * logo, and put a black triangle (a chevron scraped off the site's navigation) on nine slides.
 */
export const EMBEDDABLE = new Set(["png", "jpeg", "gif", "webp"]);

/** The media types a package must declare for the parts it carries. */
export const MEDIA_TYPES: Record<string, string> = {
  png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

// Intrinsic pixel dimensions, straight from the file header. PNG keeps them in
// the IHDR chunk; JPEG in whichever SOF marker comes first; WebP in one of three chunk
// layouts depending on how it was encoded.
//
// WebP is here because these houses publish it. Without it the co-branding read Prada's
// 960×149 wordmark as "not a readable PNG or JPEG" and fell back to the small logo — which
// for Prada is a chevron scraped off the site navigation, and it went on nine slides.
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 30 && String.fromCharCode(...b.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...b.slice(8, 4 + 8)) === "WEBP") {
    const chunk = String.fromCharCode(...b.slice(12, 16));
    // Extended: the canvas size is stored as two 24-bit little-endian values, minus one.
    if (chunk === "VP8X") {
      return {
        w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
        h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
      };
    }
    // Lossy: a VP8 keyframe header, 14 bits each after the 3-byte start code.
    if (chunk === "VP8 " && b.length > 30) {
      return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    }
    // Lossless: 14 bits width-1 then 14 bits height-1, packed little-endian after the
    // 0x2f signature byte.
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
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

/**
 * Is this PNG a white (or near-white) logo on transparency?
 *
 * The SVG version of this question reads the colours the file declares (brand-identity's
 * svgIsLight); a PNG declares nothing, so its pixels are decoded — zlib through the platform's
 * DecompressionStream, then the five PNG row filters — and sampled. White on transparency is
 * the only shape of "white logo" there is: a JPEG has no alpha, and an opaque PNG carries its
 * own background, so either one answers false.
 *
 * True when a real share of the picture is transparent and nearly all of the ink is light.
 * Interlaced or malformed files answer false: no claim either way.
 */
export async function pngIsLight(b: Uint8Array): Promise<boolean> {
  const px = await decodePng(b).catch(() => null);
  if (!px) return false;
  const { width, height, rgba } = px;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000))); // ~40k samples
  let transparent = 0, ink = 0, light = 0, seen = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      seen++;
      if (rgba[i + 3] < 32) { transparent++; continue; }
      ink++;
      if (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] > 0.85 * 255) light++;
    }
  }
  return transparent / seen > 0.2 && ink > 0 && light / ink > 0.9;
}

/** RGBA pixels of a non-interlaced PNG, any colour type, bit depth 8 or 16 (or ≤8 for grey/palette). */
export async function decodePng(b: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array } | null> {
  if (sniffFormat(b) !== "png") return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= b.length;) {
    const len = dv.getUint32(o);
    const kind = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const data = b.subarray(o + 8, o + 8 + len);
    if (kind === "IHDR") {
      width = dv.getUint32(o + 8); height = dv.getUint32(o + 12);
      depth = b[o + 16]; type = b[o + 17]; interlace = b[o + 20];
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    o += 12 + len;
  }
  if (!width || !height || interlace !== 0 || width * height > 25_000_000) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return null;

  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((at, d) => { joined.set(d, at); return at + d.length; }, 0);
  const raw = new Uint8Array(await new Response(
    new Response(joined).body!.pipeThrough(new DecompressionStream("deflate")),
  ).arrayBuffer());

  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per pixel, for the filters
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < height * (stride + 1)) return null;
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const rgba = new Uint8Array(width * height * 4);
  const maxv = (1 << Math.min(depth, 8)) - 1;
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      cur[i] = v & 255;
    }
    // One sample per channel, scaled to 0–255.
    const sample = (x: number, ch: number): number => {
      if (depth === 16) return cur[(x * channels + ch) * 2];
      if (depth === 8) return cur[x * channels + ch];
      const bit = (x * channels + ch) * depth;
      return (cur[bit >> 3] >> (8 - depth - (bit & 7))) & maxv;
    };
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const idx = sample(x, 0);
        rgba[o] = palette?.[idx * 3] ?? 0; rgba[o + 1] = palette?.[idx * 3 + 1] ?? 0; rgba[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
        continue;
      }
      const scale = depth < 8 ? 255 / maxv : 1;
      if (type === 0 || type === 4) {
        const g = Math.round(sample(x, 0) * scale);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = type === 4 ? sample(x, 1) : 255;
      } else {
        rgba[o] = sample(x, 0); rgba[o + 1] = sample(x, 1); rgba[o + 2] = sample(x, 2);
        rgba[o + 3] = type === 6 ? sample(x, 3) : 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, rgba };
}
