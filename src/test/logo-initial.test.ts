import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialFromPng, initialFromSvg } from "../../supabase/functions/_shared/logo-split.ts";
import { rasteriseSvg, svgFrame } from "../../supabase/functions/_shared/svg-raster.ts";
import { decodePng } from "../../supabase/functions/_shared/image-bytes.ts";
import { mirrorBrandImages } from "../../supabase/functions/_shared/brand-images.ts";
import { harvestBrandIdentity, logoImgCandidates, logoImgStrength } from "../../supabase/functions/_shared/brand-identity";

// Two houses onboarded on 2026-11-02 for a demo the same afternoon, and what each one taught:
// My Style Bags declares a logo that answers 404 and a 32px favicon, so the record had no
// wordmark and a smudge for a monogram; L.G.R's markup names a still from a series
// "…-logo-….jpg", so a press photograph went on the record and onto twelve slides, while the
// wordmark was drawn inline as SVG in the header the whole time.

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));
const MSB = new Uint8Array(fixture("msb-wordmark.png"));
const LGR = fixture("lgr-wordmark.svg").toString("utf8");
const FAVICON = new Uint8Array(fixture("favicon-32.webp"));
const PHOTO = new Uint8Array(fixture("photo-418x768.jpg"));

type Upload = { bucket: string; path: string; bytes: Uint8Array; contentType?: string };
function fakeAdmin() {
  const uploads: Upload[] = [];
  const admin = {
    storage: {
      from(bucket: string) {
        return {
          // deno-lint-ignore no-explicit-any
          upload(path: string, bytes: any, opts?: Record<string, unknown>) {
            uploads.push({ bucket, path, bytes, contentType: opts?.contentType as string });
            return Promise.resolve({ error: null });
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
        };
      },
    },
  };
  return { admin, uploads };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("the initial of a wordmark", () => {
  it("cuts the M out of MY STYLE BAGS as a square, transparent PNG", async () => {
    const png = await initialFromPng(MSB);
    expect(png).not.toBeNull();
    const px = await decodePng(png!);
    expect(px).not.toBeNull();
    expect(px!.width).toBe(px!.height);
    // The M is the first glyph of the name band: ~311 px wide, ~176 tall, so the square is
    // a little over the glyph's height and far smaller than the 2084 px wordmark.
    expect(px!.width).toBeGreaterThan(200);
    expect(px!.width).toBeLessThan(450);
    // Ink in the middle, transparency in the padding.
    let ink = 0;
    for (let i = 3; i < px!.rgba.length; i += 4) if (px!.rgba[i] >= 64) ink++;
    expect(ink).toBeGreaterThan(px!.width * px!.height * 0.05);
    expect(px!.rgba[3]).toBeLessThan(64);
  });

  it("re-frames an SVG wordmark on its first glyph", () => {
    const initial = initialFromSvg(LGR);
    expect(initial).not.toBeNull();
    const frame = svgFrame(initial!)!;
    // L.G.R is 653 wide; the L is the first ~90 units of it, framed square.
    expect(frame.w).toBe(frame.h);
    expect(frame.w).toBeGreaterThan(80);
    expect(frame.w).toBeLessThan(200);
    expect(frame.x).toBeLessThan(20);
  });

  it("leaves a one-piece script wordmark alone", () => {
    // One path the whole width of the frame: nothing in it is a first glyph.
    const script = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><path d="M0 50 C100 0 200 100 300 50 S500 0 600 50 L600 80 L0 80 Z"/></svg>`;
    expect(initialFromSvg(script)).toBeNull();
  });
});

describe("a name on two lines", () => {
  it("keeps MY STYLE over BAGS whole and drops only MILANO", async () => {
    const { splitSvgLogo } = await import("../../supabase/functions/_shared/logo-split.ts");
    const svg = readFileSync(join(__dirname, "fixtures", "msb-wordmark.svg"), "utf8");
    const cut = splitSvgLogo(svg);
    expect(cut).not.toBeNull();
    const frame = svgFrame(cut!.name)!;
    // The whole mark is 310 by 84; the name without MILANO is most of the height, not a third.
    expect(frame.h).toBeGreaterThan(84 * 0.55);
    expect(frame.h).toBeLessThan(84 * 0.9);
    expect(cut!.crest).toBeUndefined();
  });
});

describe("rasterising an SVG", () => {
  it("renders the L.G.R wordmark to a PNG of the asked width", async () => {
    const png = await rasteriseSvg(LGR, 800);
    expect(png).not.toBeNull();
    const px = await decodePng(png!);
    expect(px!.width).toBe(800);
    expect(px!.height).toBe(Math.round(800 * 125 / 653));
  });
});

describe("copying a logo in, judged by what the bytes are", () => {
  it("refuses a 32px favicon as the monogram and cuts the initial out of the wordmark instead", async () => {
    const { admin, uploads } = fakeAdmin();
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const u = String(input);
      if (u.endsWith("/wordmark.png")) return Promise.resolve(new Response(MSB as unknown as BodyInit, { headers: { "content-type": "image/png" } }));
      if (u.endsWith("/favicon.webp")) return Promise.resolve(new Response(FAVICON as unknown as BodyInit, { headers: { "content-type": "image/webp" } }));
      return Promise.resolve(new Response("", { status: 404 }));
    }));
    const out = await mirrorBrandImages(admin, 20, {
      logo_big: "https://msb.example/wordmark.png",
      logo_small: "https://msb.example/favicon.webp",
    });
    expect(out.urls.logo_big).toMatch(/brands\/20-full\.png\?v=/);
    expect(out.urls.logo_small).toMatch(/brands\/20-icon\.png\?v=/);
    expect(out.notes.join(" ")).toMatch(/initial is the monogram/);
    const icon = uploads.find((u) => u.path === "brands/20-icon.png")!;
    const px = await decodePng(icon.bytes);
    expect(px!.width).toBe(px!.height);
    expect(px!.width).toBeLessThan(450);
  });

  it("refuses a portrait JPEG as the wordmark and takes the next logo the site offers", async () => {
    const { admin, uploads } = fakeAdmin();
    const inline = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LGR.replace(/#FFF/g, "#000"))}`;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const u = String(input);
      if (u.endsWith("/maxton-hall-logo.jpg")) return Promise.resolve(new Response(PHOTO as unknown as BodyInit, { headers: { "content-type": "image/jpeg" } }));
      return Promise.resolve(new Response("", { status: 404 }));
    }));
    const out = await mirrorBrandImages(admin, 21, { logo_big: "https://lgr.example/maxton-hall-logo.jpg" }, null, {
      logo_candidates: ["https://lgr.example/maxton-hall-logo.jpg", inline],
    });
    // The SVG is kept beside a PNG the deck can embed, and the record gets the PNG.
    expect(out.urls.logo_big).toMatch(/brands\/21-full\.png\?v=/);
    expect(uploads.some((u) => u.path === "brands/21-full.svg")).toBe(true);
    expect(out.notes.join(" ")).toMatch(/photograph, not a wordmark/);
    // And with no icon offered, the L becomes the monogram.
    expect(out.urls.logo_small).toMatch(/brands\/21-icon\.png\?v=/);
  });

  it("stores a white SVG logo dark, as a PNG, with its initial for the monogram", async () => {
    const { admin, uploads } = fakeAdmin();
    const inline = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LGR)}`; // fill="#FFF"
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 404 }))));
    const out = await mirrorBrandImages(admin, 21, { logo_big: inline });
    expect(out.urls.logo_big).toMatch(/brands\/21-full\.png\?v=/);
    expect(out.notes.join(" ")).toMatch(/repainted dark/);
    const svg = new TextDecoder().decode(uploads.find((u) => u.path === "brands/21-full.svg")!.bytes);
    expect(svg).not.toMatch(/#FFF/i);
    const px = await decodePng(uploads.find((u) => u.path === "brands/21-full.png")!.bytes);
    // Ink is dark now: the first opaque pixel is near-black.
    let i = 0;
    while (i < px!.rgba.length && px!.rgba[i + 3] < 200) i += 4;
    expect(px!.rgba[i]).toBeLessThan(40);
    expect(out.urls.logo_small).toMatch(/brands\/21-icon\.png/);
  });

  it("still says so when every logo offered was refused", async () => {
    const { admin } = fakeAdmin();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 404 }))));
    const out = await mirrorBrandImages(admin, 9, { logo_big: "https://x.example/logo.png" }, null, { logo_candidates: ["https://x.example/other.png"] });
    expect(out.urls.logo_big).toBeUndefined();
    expect(out.failed).toBe(1);
  });
});

describe("which logo the site offers first", () => {
  it("knows an <img> that says logo in its own attributes from one that says it only in the file name", () => {
    expect(logoImgStrength(`<img class="header__logo" src="/x/mark.png">`)).toBe("strong");
    expect(logoImgStrength(`<img src="/uploads/logo_forbes-1102.png" alt="">`)).toBe("weak");
    expect(logoImgStrength(`<img src="/uploads/x.png" alt="Forbes logo">`)).toBe("strong");
    // WordPress writes the file name into alt: that is the file name twice, not a claim.
    expect(logoImgStrength(`<img class="sk-media__image" data-src="/uploads/2024/02/logo_forbes-1102.png" alt="logo_forbes-1102.png">`)).toBe("weak");
  });

  it("does not take a still from a series for the logo because its name mentions one", () => {
    const html = `<div class="carousel">
      <img src="https://www.lgr.example/wp-content/uploads/2026/02/9x16-Maxton-Hall-logo-Damian-Hardung-1-lowres-scaled-418x768.jpg">
      <img src="https://www.lgr.example/wp-content/uploads/2024/02/logo_forbes-1102.png" alt="">
      <img class="site-logo" src="https://www.lgr.example/wp-content/themes/lgr/logo.png"></div>`;
    const picked = logoImgCandidates(html);
    expect(picked[0]).toContain("themes/lgr/logo.png");
    expect(picked.join(" ")).not.toContain("Maxton");
  });

  it("takes the header's inline SVG over an <img> whose only claim is its file name", async () => {
    const page = `<html><body><header><div class="header__logo"><a href="/en/" title="L.G.R">${LGR}</a></div></header>
      <section class="about"><img src="https://www.lgr.example/uploads/logo_forbes-1102.png" alt=""></section></body></html>`;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => Promise.resolve(
      String(input) === "https://www.lgr.example/" ? new Response(page) : new Response("", { status: 404 }),
    )));
    const id = await harvestBrandIdentity("https://www.lgr.example/");
    // The header's wordmark is WHITE (fill="#FFF", for the dark bar) and still outranks the
    // badge: the copy-in repaints it.
    expect(id.logo_big).toMatch(/^data:image\/svg\+xml/);
    expect(id.found).toContain("logo (white — repainted dark)");
    // The badge is still there, after it, for the copy-in to fall back on.
    expect(id.logo_candidates?.[1]).toContain("logo_forbes");
  });

  it("puts a declared logo that does not download last, and reads the header instead", async () => {
    const page = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"MSB","logo":"https://msb.example/cdn/shop/t/2/assets/logo.png"}</script></head>
      <body><header><a href="/" class="header__center__logo"><svg width="310" height="84" viewBox="0 0 310 84" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 25H19L7 5V18C7 20 8 22 9 23H0V1H14L24 16L32 1H46V2H45V25H27V24H28V3L20 25Z"/></svg></a></header></body></html>`;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => Promise.resolve(
      String(input) === "https://msb.example/" ? new Response(page) : new Response("not found", { status: 404 }),
    )));
    const id = await harvestBrandIdentity("https://msb.example/");
    expect(id.logo_big).toMatch(/^data:image\/svg\+xml/);
    expect(id.logo_candidates?.at(-1)).toBe("https://msb.example/cdn/shop/t/2/assets/logo.png");
    expect(id.notes.join(" ")).toMatch(/did not download/);
  });
});
