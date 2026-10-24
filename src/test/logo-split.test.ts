import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  splitPngLogo, splitSvgLogo, encodePng, pathPoints, pathSubpaths, chooseBands,
} from "../../supabase/functions/_shared/logo-split.ts";
import { decodePng } from "../../supabase/functions/_shared/image-bytes.ts";
import { mirrorBrandImages } from "../../supabase/functions/_shared/brand-images.ts";

// The houses' own logos, as their sites serve them. Every lockup here was cut by hand on
// 2026-10-24 (crest off Brunello's and Buccellati's, shield and tagline off Eberhard's, the
// line under Damiani's, Messika's and Oris's), and the cut below has to land where those did.
// The wordmarks are the other half: a one-line name is never touched.

const fx = (f: string) => readFileSync(join(__dirname, "fixtures/logos", f));
const viewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)![1].split(" ").map(Number);

describe("cutting a lockup to the name", () => {
  it("takes Brunello's crest off its name, and keeps the crest square", async () => {
    const cut = await splitPngLogo(new Uint8Array(fx("brunello-lockup.png")));
    expect(cut).not.toBeNull();
    const name = (await decodePng(cut!.name))!;
    // The name band is rows 412–490 of 496: a wide strip, not the 1592×496 lockup.
    expect(name.width / name.height).toBeGreaterThan(12);
    const crest = (await decodePng(cut!.crest!))!;
    expect(crest.width).toBe(crest.height);
  });

  it("cuts the header SVG brunellocucinelli.com actually serves", () => {
    // No viewBox (only width="199" height="62"), crest and name in the SAME <path>, and arcs
    // written with run-together flags ("0 01-.531") — all three defeated the first version.
    const cut = splitSvgLogo(fx("brunello-header.svg").toString())!;
    expect(cut).not.toBeNull();
    const [, y, w, h] = viewBox(cut.name);
    expect(y).toBeGreaterThan(45);   // the name sits at the bottom of 62
    expect(w / h).toBeGreaterThan(12);
    expect(cut.crest).toBeDefined();
    expect(cut.name).not.toMatch(/\swidth=/);
  });

  it("drops the line under Damiani's name", async () => {
    const cut = await splitPngLogo(new Uint8Array(fx("damiani-lockup.png")));
    const name = (await decodePng(cut!.name))!;
    expect(name.height).toBeLessThan(200); // the name is rows 7–182; the tagline was at 244
    expect(cut!.crest).toBeUndefined();
  });

  it("re-frames an SVG lockup on its name, so it stays vector", () => {
    // Buccellati: crest above (y 0–55), name below (y 75–127).
    const b = splitSvgLogo(fx("buccellati-lockup.svg").toString())!;
    const [, y, , h] = viewBox(b.name);
    expect(y).toBeGreaterThan(65);
    expect(y + h).toBeGreaterThan(125);
    expect(b.crest).toBeDefined();
    // Eberhard: shield, then the name (y ~41–98), then a script tagline.
    const e = splitSvgLogo(fx("eberhard-lockup.svg").toString())!;
    const [, ey, , eh] = viewBox(e.name);
    expect(ey).toBeGreaterThan(35);
    expect(ey + eh).toBeLessThan(102);
    expect(e.crest).toBeDefined();
  });

  it("drops a small line under the name", () => {
    for (const f of ["messika-lockup.svg", "oris-byline.svg"]) {
      const cut = splitSvgLogo(fx(f).toString());
      const [, , w, h] = viewBox(cut!.name);
      expect(w / h, f).toBeGreaterThan(3.2); // the lockups are 4.4:1 and 2.5:1 whole
    }
  });

  it("never touches a one-line wordmark", async () => {
    for (const f of ["ferragamo-wordmark.png", "luisa-beccaria-wordmark.png", "pomellato-wordmark.png"]) {
      expect(await splitPngLogo(new Uint8Array(fx(f))), f).toBeNull();
    }
    expect(splitSvgLogo(fx("pasquale-bruni-wordmark.svg").toString())).toBeNull();
  });

  it("does not cut a two-line name in half", () => {
    // Two wide bands of the same height are one name on two lines.
    const two = chooseBands([
      { top: 0, bottom: 40, left: 0, right: 300 },
      { top: 60, bottom: 100, left: 10, right: 290 },
    ], 100);
    expect(two).toBeNull();
  });
});

describe("the pieces it is built from", () => {
  it("writes a PNG it can read back, pixel for pixel", async () => {
    const rgba = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) % 256);
    const back = await decodePng(await encodePng(3, 2, rgba));
    expect(back).toMatchObject({ width: 3, height: 2 });
    expect([...back!.rgba]).toEqual([...rgba]);
  });

  it("follows a path along its curves, not out to its control points", () => {
    // A curve from (0,0) to (10,0) pulled toward y=100: its ink reaches y=75, never 100.
    const ys = pathPoints("M0 0 C0 100 10 100 10 0").map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(75.01);
    expect(Math.max(...ys)).toBeGreaterThan(70);
    // Arc flags need no separator: "0 01-.531" is rotation 0, flags 0 and 1, then the point.
    expect(pathPoints("M10 10 a5 5 0 01-2-1").at(-1)).toEqual([8, 9]);
    // One path, two shapes: each M starts its own.
    expect(pathSubpaths("M0 0 L10 0 M0 50 L10 50")).toHaveLength(2);
    // Relative commands and implicit repeats.
    expect(pathPoints("m10 10 l5 0 5 0").at(-1)).toEqual([20, 10]);
  });
});

describe("when onboarding copies the logo in", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("stores the name, keeps the lockup, and puts the crest in for a favicon", async () => {
    const uploads: { path: string }[] = [];
    const admin = {
      storage: {
        from(bucket: string) {
          return {
            upload(path: string) { uploads.push({ path }); return Promise.resolve({ error: null }); },
            getPublicUrl(path: string) { return { data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/${bucket}/${path}` } }; },
          };
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(fx("brunello-lockup.png")))));
    const out = await mirrorBrandImages(admin, 17, {
      logo_big: "https://www.brunellocucinelli.com/images/logo-black.png",
      logo_small: "https://www.brunellocucinelli.com/favicon.ico",
    });
    expect(uploads.map((u) => u.path)).toEqual(expect.arrayContaining([
      "brands/17-lockup.png", "brands/17-crest.png", "brands/17-full.png",
    ]));
    expect(out.urls.logo_small).toContain("brands/17-crest.png");
    // The favicon was never fetched or stored: the crest is the better monogram.
    expect(uploads.some((u) => u.path.startsWith("brands/17-icon"))).toBe(false);
    expect(out.notes.join(" ")).toMatch(/lockup/);
  });
});
