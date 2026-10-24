import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonLdNodes } from "../../supabase/functions/_shared/product-extract";
import { harvestBrandIdentity, inlineSvgLogo, isPlatformPlaceholderLogo, logoSpriteFiles, pickLogoImg, svgIsLight } from "../../supabase/functions/_shared/brand-identity";

const html = readFileSync(join(__dirname, "fixtures/ferragamo-home.html"), "utf8");

describe("brand identity, from what the site declares", () => {
  it("finds the logo the site publishes for Google", () => {
    const logo = jsonLdNodes(html)
      .filter((n) => {
        const t = n["@type"];
        const types = Array.isArray(t) ? t.map(String) : [String(t)];
        return types.some((x) => ["Organization", "Corporation", "Brand", "WebSite", "OnlineStore"].includes(x));
      })
      .map((n) => (typeof n.logo === "string" ? n.logo : (n.logo as Record<string, unknown> | undefined)?.url))
      .find(Boolean);
    // Ferragamo declares it; the old harvester only looked at <img> tags and
    // therefore stored nothing, leaving the deck with AION's mark alone.
    expect(logo).toMatch(/^https:\/\/cdn\.ferragamo\.com\/.+logo.+\.png$/i);
  });

  it("picks the LARGEST icon, not the first in the document", () => {
    const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:apple-touch-)?icon[^"']*["'][^>]*>/gi)]
      .map((m) => m[0])
      .map((tag) => ({
        href: tag.match(/href=["']([^"']+)["']/i)?.[1],
        size: Number((tag.match(/sizes=["']([^"']+)["']/i)?.[1] ?? "").split("x")[0]) || 0,
      }))
      .filter((i) => i.href)
      .sort((a, b) => b.size - a.size);
    expect(icons.length).toBeGreaterThan(1);
    // The document lists 57x57 first, which is what got stored.
    expect(icons[0].size).toBeGreaterThan(57);
  });
});

describe("brand identity, when the site's own claims are wrong", () => {
  it("knows a shop platform's placeholder logo from the house's own", () => {
    // What brunellocucinelli.com declares as its Organization logo.
    const sfcc = `<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg"><title>2016sf_CommerceCloud_logo_RGB</title><path d="M0"/></svg>`;
    expect(isPlatformPlaceholderLogo("https://www.example.com/images/logo.svg", sfcc)).toBe(true);
    const house = `<svg width="199" height="62" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="#262626"><path d="M0"/></g></svg>`;
    expect(isPlatformPlaceholderLogo("https://www.example.com/images/logo-black.svg", house)).toBe(false);
  });

  it("takes the dark header logo over the white one that comes first", () => {
    const html = `
      <img class="cc-logo__img cc-logo__img--white" src="/images/logo-white.svg" alt="Home" />
      <img class="cc-logo__img cc-logo__img--black" src="/images/logo-black.svg" alt="Home" />`;
    expect(pickLogoImg(html)).toMatch(/logo-black/);
  });

  it("still takes a white logo when it is the only one", () => {
    expect(pickLogoImg(`<img class="logo" src="/logo-white.png">`)).toMatch(/logo-white/);
  });

  it("does not take a photo labelled 'No Logo' for the logo", () => {
    // messika.com's hero, verbatim. It went on the record as Messika's logo.
    const hero = `<img alt src="https://www.messika.com/media-cms/Messika - Worldwide Campaign - Kiko Mizuhara - Key Visual - 169 - No Logo - 150 DPI.jpg" class="h-full w-full object-cover">`;
    expect(pickLogoImg(hero)).toBeUndefined();
    expect(pickLogoImg(hero.replace(/ /g, "%20"))).toBeUndefined();
    expect(pickLogoImg(`${hero}<img class="site-logo" src="/m.svg">`)).toMatch(/m\.svg/);
  });
});

describe("a logo drawn inline", () => {
  // messika.com's header: the logo is a <use> of a sprite symbol, inside the link home.
  const messika = `
    <svg class="hidden"><symbol id="messika-logo-2025" viewBox="0 0 464.88 105.82667"><path d="M0 0h464v78H0z"/></symbol>
      <symbol id="icon-bag" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></symbol></svg>
    <a href="https://www.messika.com/en/cart"><svg viewBox="0 0 24 24"><use href="#icon-bag"></use></svg></a>
    <a class data-astro-prefetch="viewport" href="https://www.messika.com/en/" aria-label="Home"><svg class="h-7" aria-hidden="true" viewBox="0 0 464.88 105.82667"><use href="#messika-logo-2025"></use></svg></a>`;

  it("resolves a <use> to its symbol and returns a standalone SVG", () => {
    const url = inlineSvgLogo(messika);
    expect(url).toMatch(/^data:image\/svg\+xml/);
    const svg = decodeURIComponent(url!.split(",").slice(1).join(","));
    expect(svg).toContain('viewBox="0 0 464.88 105.82667"');
    expect(svg).toContain('<path d="M0 0h464v78H0z"/>');
    expect(svg).not.toContain("<use");
  });

  it("does not take an icon for the logo", () => {
    expect(inlineSvgLogo(`<a href="/cart"><svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg></a>`)).toBeUndefined();
    // Square and linked home, but nothing calls it a logo: still an icon.
    expect(inlineSvgLogo(`<a href="/" aria-label="Home"><svg viewBox="0 0 32 32"><path d="M0 0"/></svg></a>`)).toBeUndefined();
  });

  it("takes a wide inline wordmark in the link home", () => {
    expect(inlineSvgLogo(`<a href="/"><svg viewBox="0 0 300 40"><path d="M0 0h300v40H0z"/></svg></a>`)).toBeDefined();
  });
});

describe("a white logo", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // eberhard-co-watches.ch: two header logos, the white one first, neither named "white".
  const DARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 235 121"><rect width="235" height="121" fill="none"/><path d="M0 0" fill="#001834"/><path d="M1 1" fill="#001834"/></svg>`;
  const WHITE = DARK.replace(/#001834/g, "#fff");

  it("is told from a dark one by the colours it paints", () => {
    expect(svgIsLight(WHITE)).toBe(true);
    expect(svgIsLight(DARK)).toBe(false);
    // Nothing declared paints black; currentColor follows the page.
    expect(svgIsLight(`<svg><path d="M0 0"/></svg>`)).toBe(false);
    expect(svgIsLight(`<svg><path fill="currentColor" d="M0 0"/></svg>`)).toBe(false);
    // Through CSS, in rgb(), and a white mark on a dark tile is not a white logo.
    expect(svgIsLight(`<svg><style>.a{fill:rgb(250, 250, 250)}</style><path class="a"/></svg>`)).toBe(true);
    expect(svgIsLight(`<svg><rect fill="#111"/><path fill="#fff"/></svg>`)).toBe(false);
    expect(svgIsLight("")).toBe(false);
  });

  it("is passed over for the dark one in the header", async () => {
    const page = `<html><head><title>Eberhard</title></head><body><header>
      <img width="800" height="413" src="https://www.eberhard.example/uploads/logo-2.svg" class="attachment-large size-large wp-image-34" alt="">
      </header><footer><img width="235" height="121" src="https://www.eberhard.example/uploads/logo.svg" class="attachment-full size-full wp-image-13" alt=""></footer></body></html>`;
    const files: Record<string, string> = {
      "https://www.eberhard.example/": page,
      "https://www.eberhard.example/uploads/logo-2.svg": WHITE,
      "https://www.eberhard.example/uploads/logo.svg": DARK,
    };
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const body = files[String(input)];
      return Promise.resolve(body == null ? new Response("", { status: 404 }) : new Response(body, { status: 200 }));
    }));
    const id = await harvestBrandIdentity("https://www.eberhard.example/");
    expect(id.logo_big).toBe("https://www.eberhard.example/uploads/logo.svg");
  });

  it("is still taken when it is the only logo there is, and says so", async () => {
    const page = `<html><body><img class="logo" src="https://www.solo.example/logo.svg"></body></html>`;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => Promise.resolve(
      String(input) === "https://www.solo.example/" ? new Response(page)
        : String(input).endsWith("/logo.svg") ? new Response(WHITE)
        : new Response("", { status: 404 }),
    )));
    const id = await harvestBrandIdentity("https://www.solo.example/");
    expect(id.logo_big).toBe("https://www.solo.example/logo.svg");
    expect(id.notes.join(" ")).toMatch(/white one/);
  });
});

describe("a declared logo that is the site icon", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("gives way to the header's wordmark, and is kept as the monogram", async () => {
    // WordPress publishes its site icon as the Organization logo — Eberhard's did.
    const page = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Eberhard","logo":"https://www.wp.example/uploads/cropped-favico-eb.png"}</script></head>
      <body><img class="site-logo" src="https://www.wp.example/uploads/logo.svg"></body></html>`;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const u = String(input);
      if (u === "https://www.wp.example/") return Promise.resolve(new Response(page));
      if (u.endsWith("/logo.svg")) return Promise.resolve(new Response(`<svg viewBox="0 0 235 57"><path fill="#001834" d="M0 0"/></svg>`));
      return Promise.resolve(new Response("", { status: 404 }));
    }));
    const id = await harvestBrandIdentity("https://www.wp.example/");
    expect(id.logo_big).toBe("https://www.wp.example/uploads/logo.svg");
    expect(id.logo_small).toBe("https://www.wp.example/uploads/cropped-favico-eb.png");
  });
});

describe("a logo drawn from a sprite file", () => {
  // oris.ch: the header logo is <use href="/_nuxt/…/sprite-default.svg#logo-with-byline">.
  const page = `<a href="/en-IT" title="Go to homepage"><svg xmlns="http://www.w3.org/2000/svg" data-symbol="logo-with-byline" class="oris-logo h-40 w-[100px]"><use href="/_nuxt/nuxt-svg-icon-sprite/sprite-default.abc.svg#logo-with-byline"></use></svg></a>
    <a href="/en-IT/product/watch" title="Watch Finder"><svg data-symbol="search"><use href="/_nuxt/nuxt-svg-icon-sprite/sprite-default.abc.svg#search"></use></svg></a>`;
  const sprite = `<svg><symbol id="search" viewBox="0 0 24 24"><path d="M1 1"/></symbol><symbol id="logo-with-byline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 283.46 112.62"><path d="M0 0h283v112H0z"/></symbol></svg>`;

  it("names only the sprite the logo uses", () => {
    expect(logoSpriteFiles(page)).toEqual(["/_nuxt/nuxt-svg-icon-sprite/sprite-default.abc.svg"]);
  });

  it("resolves the logo from the fetched sprite", () => {
    expect(inlineSvgLogo(page)).toBeUndefined(); // nothing to draw without the file
    const svg = decodeURIComponent(inlineSvgLogo(page, sprite)!.split(",").slice(1).join(","));
    expect(svg).toContain('viewBox="0 0 283.46 112.62"');
    expect(svg).toContain("M0 0h283v112H0z");
  });
});

describe("a white PNG logo", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is passed over for the coloured one, as an SVG would be", async () => {
    const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f));
    const page = `<html><body>
      <img class="header-logo" src="https://www.pb.example/logo_test_light.png">
      <img class="footer-logo" src="https://www.pb.example/logo_test.png"></body></html>`;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const u = String(input);
      if (u === "https://www.pb.example/") return Promise.resolve(new Response(page));
      if (u.endsWith("/logo_test_light.png")) return Promise.resolve(new Response(fx("logo-white.png")));
      if (u.endsWith("/logo_test.png")) return Promise.resolve(new Response(fx("logo-red.png")));
      return Promise.resolve(new Response("", { status: 404 }));
    }));
    const id = await harvestBrandIdentity("https://www.pb.example/");
    expect(id.logo_big).toBe("https://www.pb.example/logo_test.png");
  });
});
