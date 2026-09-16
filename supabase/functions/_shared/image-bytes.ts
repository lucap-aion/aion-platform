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
