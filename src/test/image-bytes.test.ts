import { describe, it, expect } from "vitest";
import { sniffFormat, imageSize, EMBEDDABLE, MEDIA_TYPES } from "../../supabase/functions/_shared/image-bytes.ts";

// Real headers, byte for byte, because the whole point of this module is that headers and
// extensions lie and only the bytes do not. A fixture built from what the code expects would
// prove nothing.

/** A PNG: signature, then IHDR declaring 150 × 150. */
const png = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

/** A JPEG: SOI, an APP0 to be skipped over, then SOF0 carrying the dimensions. */
const jpeg = (w: number, h: number) => {
  const b = new Uint8Array(40);
  const dv = new DataView(b.buffer);
  b.set([0xff, 0xd8, 0xff], 0);
  b.set([0xff, 0xe0], 2); dv.setUint16(4, 8);          // APP0, 8 bytes of payload
  b.set([0xff, 0xc0], 12); dv.setUint16(14, 17);       // SOF0
  b[16] = 8;                                           // sample precision
  dv.setUint16(17, h); dv.setUint16(19, w);
  return b;
};

/** Lossy WebP: RIFF/WEBP, a "VP8 " chunk, dimensions 14 bits each. */
const webpLossy = (w: number, h: number) => {
  const b = new Uint8Array(40);
  const dv = new DataView(b.buffer);
  b.set([...("RIFF" as string)].map((c) => c.charCodeAt(0)), 0);
  b.set([...("WEBP" as string)].map((c) => c.charCodeAt(0)), 8);
  b.set([...("VP8 " as string)].map((c) => c.charCodeAt(0)), 12);
  dv.setUint16(26, w, true);
  dv.setUint16(28, h, true);
  return b;
};

/** Extended WebP: a VP8X chunk with 24-bit canvas dimensions, minus one. */
const webpExtended = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([...("RIFF" as string)].map((c) => c.charCodeAt(0)), 0);
  b.set([...("WEBP" as string)].map((c) => c.charCodeAt(0)), 8);
  b.set([...("VP8X" as string)].map((c) => c.charCodeAt(0)), 12);
  const put24 = (at: number, v: number) => { b[at] = v & 0xff; b[at + 1] = (v >> 8) & 0xff; b[at + 2] = (v >> 16) & 0xff; };
  put24(24, w - 1);
  put24(27, h - 1);
  return b;
};

/** AVIF: the ISO-BMFF container, brand "avif". */
const avif = () => {
  const b = new Uint8Array(40);
  b.set([...("ftypavif" as string)].map((c) => c.charCodeAt(0)), 4);
  return b;
};

describe("what an image file actually is", () => {
  it("reads the format off the bytes, not off the label", () => {
    expect(sniffFormat(png(1, 1))).toBe("png");
    expect(sniffFormat(jpeg(1, 1))).toBe("jpeg");
    expect(sniffFormat(webpLossy(1, 1))).toBe("webp");
    expect(sniffFormat(avif())).toBe("avif");
  });

  it("calls an HTML error page what it is", () => {
    // The failure that put a "403 Forbidden" page on a brand record as its logo: the server
    // answered 200 with HTML and a Content-Type of image/jpeg.
    const html = new TextEncoder().encode("<!doctype html><html><body>Access denied</body></html>");
    expect(sniffFormat(html)).toBe(null);
  });

  it("knows which formats a .pptx can actually carry", () => {
    // AVIF is the one that matters: PowerPoint has never supported it, there is no rasteriser
    // in the functions runtime, and a brand's own campaign shot arrives as one.
    expect(EMBEDDABLE.has("avif")).toBe(false);
    for (const f of ["png", "jpeg", "webp", "gif"]) {
      expect(EMBEDDABLE.has(f), f).toBe(true);
      // Anything embeddable needs a media type to declare in [Content_Types].xml, or the
      // package is invalid rather than the picture being wrong.
      expect(MEDIA_TYPES[f], `${f} media type`).toBeTruthy();
    }
  });
});

describe("how big it is", () => {
  it("reads PNG and JPEG dimensions", () => {
    expect(imageSize(png(960, 149))).toEqual({ w: 960, h: 149 });
    expect(imageSize(jpeg(1600, 900))).toEqual({ w: 1600, h: 900 });
  });

  it("reads WebP dimensions, in both of the layouts these houses publish", () => {
    // Without this the co-branding read a 960×149 WebP wordmark as unreadable and fell back
    // to the small logo — which for one house is a chevron off the site navigation, and it
    // went on nine slides.
    expect(imageSize(webpLossy(960, 149))).toEqual({ w: 960, h: 149 });
    expect(imageSize(webpExtended(1200, 400))).toEqual({ w: 1200, h: 400 });
  });

  it("says nothing rather than guessing", () => {
    // A guessed aspect ratio stretches a monogram into a wordmark's slot, which is worse
    // than leaving the logo off.
    expect(imageSize(avif())).toBe(null);
    expect(imageSize(new Uint8Array(8))).toBe(null);
  });
});
