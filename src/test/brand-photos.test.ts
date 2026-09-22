import { describe, it, expect } from "vitest";
import {
  rankPages, imageUrlsFrom, plausiblePhotoUrl, findBrandPhotos, pickForFrame,
} from "../../supabase/functions/_shared/brand-photos.ts";

// The URLs are real ones out of a crawled site, because the whole module is a bet on how
// these houses file their material. A fixture invented to match the patterns would prove the
// patterns match themselves.
const PRADA_PAGES = [
  { url: "https://www.prada.com/ww/en/info/gift-card-store-credit.html" },
  { url: "https://www.prada.com/ww/en/info/gift-card_store-credit-qa.html" },
  { url: "https://www.prada.com/ww/en/pradasphere/campaigns/2017/365-ss-woman.html" },
  { url: "https://www.prada.com/tr/tr/pradasphere/campaigns/2017/365-ss-woman.html" },
  { url: "https://www.prada.com/ww/en/store-locator/store-directory.html" },
  { url: "https://www.prada.com/ie/en/store-locator.html" },
  { url: "https://www.prada.com/ie/en/mens/mens-collection/c/10527EU" },
  { url: "https://www.prada.com/ww/en/contact-us.html" },
];

describe("which page to open", () => {
  it("finds the store pages, and prefers the shallower one", () => {
    const got = rankPages(PRADA_PAGES, "store", 3).map((p) => p.url);
    expect(got[0]).toContain("store-locator");
    // "gift-card-store-credit" matches the word "store" and is not a boutique. It may appear
    // below the real ones, but never above them.
    expect(got[0]).not.toContain("gift-card");
  });

  it("finds campaign photography", () => {
    const got = rankPages(PRADA_PAGES, "ambassador", 3).map((p) => p.url);
    expect(got.some((u) => u.includes("/campaigns/"))).toBe(true);
  });

  it("does not open the same page once per market", () => {
    // These sites publish every page per locale. /ww/en and /tr/tr of one campaign is two
    // requests for one photograph.
    const got = rankPages(PRADA_PAGES, "ambassador", 6).map((p) => p.url);
    const campaigns = got.filter((u) => u.includes("365-ss-woman"));
    expect(campaigns).toHaveLength(1);
  });

  it("says nothing rather than opening pages at random", () => {
    expect(rankPages([{ url: "https://x.com/terms" }, { url: "https://x.com/privacy" }], "store")).toHaveLength(0);
  });
});

describe("reading the pictures off a page", () => {
  const html = `
    <html><head>
      <meta property="og:image" content="/media/campaign-hero.jpg">
    </head><body>
      <img src="/assets/logo.svg" alt="Brand">
      <img src="/assets/icon-search.png">
      <img srcset="/media/look-400.jpg 400w, /media/look-1600.jpg 1600w" src="/media/look-400.jpg" alt="Look">
      <source srcset="/media/store-2000.jpg 2000w">
      <div style="background-image:url('/media/boutique-facade.jpg')"></div>
      <img data-src="/media/lazy-editorial.jpg" src="data:image/gif;base64,R0lGOD">
    </body></html>`;

  it("takes og:image, img, the largest srcset candidate, and CSS backgrounds", () => {
    const urls = imageUrlsFrom(html, "https://brand.com/world/campaign");
    expect(urls[0]).toBe("https://brand.com/media/campaign-hero.jpg");
    // The first srcset entry is the phone's; the deck wants the big one.
    expect(urls).toContain("https://brand.com/media/look-1600.jpg");
    expect(urls).toContain("https://brand.com/media/store-2000.jpg");
    expect(urls).toContain("https://brand.com/media/boutique-facade.jpg");
    // A lazy-loaded page puts a placeholder in src and the real file in data-src.
    expect(urls).toContain("https://brand.com/media/lazy-editorial.jpg");
    // A data: URI is not a picture anybody can fetch.
    expect(urls.some((u) => u.startsWith("data:"))).toBe(false);
  });

  it("reads a framework-bound lazy attribute", () => {
    // Verbatim from prada.com's campaign page. Vue and Alpine write the value quoted INSIDE
    // the attribute quotes, and a pattern looking for data-src="([^"']+)" sees the inner
    // quote and matches nothing — silently. That page carries thirty-eight pictures written
    // this way and the deck reported "no usable picture on the ambassador pages".
    const bound = `<img :class="['js-picture-image', 'card__img', 'js-lazyLoad']" ` +
      `:src="''" :data-src="'/content/dam/pradanux/pradasphere/2017/campaigns/ss-woman/Asset/Hero_Banner_BIG_DT.jpg'" :alt="''">`;
    const urls = imageUrlsFrom(bound, "https://www.prada.com/ww/en/pradasphere/campaigns/2017/365-ss-woman.html");
    expect(urls).toEqual([
      "https://www.prada.com/content/dam/pradanux/pradasphere/2017/campaigns/ss-woman/Asset/Hero_Banner_BIG_DT.jpg",
    ]);
    // The bound empty placeholder in src must not become a URL of its own.
    expect(urls).toHaveLength(1);
  });

  it("refuses the things that are on every page and are never the photograph", () => {
    // A logo is the one that matters: it is on every page, it is often the biggest PNG in the
    // markup, and a "boutique photograph" that is the brand's wordmark is worse than the
    // stock image it replaced.
    expect(plausiblePhotoUrl("https://brand.com/assets/logo.svg")).toBe(false);
    expect(plausiblePhotoUrl("https://brand.com/assets/header-logo.png")).toBe(false);
    expect(plausiblePhotoUrl("https://brand.com/i/icon-search.png")).toBe(false);
    expect(plausiblePhotoUrl("https://brand.com/i/payment-visa.png")).toBe(false);
    expect(plausiblePhotoUrl("https://brand.com/media/boutique-facade.jpg")).toBe(true);
  });
});

// ── End to end, with the network faked ──────────────────────────────────────────────────
const png = (w: number, h: number) => {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w); dv.setUint32(20, h);
  return b;
};
const avif = () => {
  const b = new Uint8Array(32);
  b.set([...("ftypavif")].map((c) => c.charCodeAt(0)), 4);
  return b;
};

describe("finding a house's own photographs", () => {
  const pages = [
    { url: "https://brand.com/en/store-locator" },
    { url: "https://brand.com/en/world/campaign-2026" },
  ];
  const markup: Record<string, string> = {
    "https://brand.com/en/store-locator":
      `<img src="/m/logo.png"><img src="/m/boutique-milan.jpg"><img src="/m/tiny-map.jpg">`,
    "https://brand.com/en/world/campaign-2026":
      `<meta property="og:image" content="/m/campaign-portrait.jpg"><img src="/m/banner-strip.jpg">`,
  };
  const heads: Record<string, Uint8Array> = {
    "https://brand.com/m/boutique-milan.jpg": png(2000, 1400),
    "https://brand.com/m/tiny-map.jpg": png(300, 200),
    "https://brand.com/m/campaign-portrait.jpg": png(1600, 2000),
    "https://brand.com/m/banner-strip.jpg": png(2400, 500),   // a hero strip, not a photograph
  };
  const io = {
    readPage: (u: string) => Promise.resolve(markup[u] ?? null),
    readImageHead: (u: string) => Promise.resolve(heads[u] ?? null),
  };

  it("gets a boutique and a portrait, from the pages that hold them", async () => {
    const { photos } = await findBrandPhotos({ pages, roles: ["store", "ambassador"], ...io });
    const store = photos.find((p) => p.role === "store");
    const amb = photos.find((p) => p.role === "ambassador");
    expect(store?.url).toBe("https://brand.com/m/boutique-milan.jpg");
    expect(amb?.url).toBe("https://brand.com/m/campaign-portrait.jpg");
    // Which page it came from travels with it — a picture nobody can trace is a picture
    // nobody will put in front of a client.
    expect(store?.page).toBe("https://brand.com/en/store-locator");
  });

  it("throws out the thumbnail and the banner", async () => {
    const { photos } = await findBrandPhotos({ pages, roles: ["store", "ambassador"], ...io });
    const urls = photos.map((p) => p.url);
    expect(urls).not.toContain("https://brand.com/m/tiny-map.jpg");
    expect(urls).not.toContain("https://brand.com/m/banner-strip.jpg");
  });

  it("refuses AVIF here rather than at embed time", async () => {
    // Measuring it and then refusing it later wastes the slot: another candidate could have
    // had it. This is the format one of the houses actually publishes.
    const { photos, notes } = await findBrandPhotos({
      pages: [pages[0]], roles: ["store"],
      readPage: io.readPage,
      readImageHead: (u) => Promise.resolve(u.includes("boutique") ? avif() : heads[u] ?? null),
    });
    expect(photos).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/none was a usable photograph/);
  });

  it("says so when the site has no such page", async () => {
    const { photos, notes } = await findBrandPhotos({
      pages: [{ url: "https://brand.com/terms" }], roles: ["store"], ...io,
    });
    expect(photos).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/no page on this site reads as store photography/);
  });
});

describe("which photograph belongs in which frame", () => {
  // The three that were actually on Prada's site when slide 10 came back letterboxed: the
  // site banner won on pixels, and 1.11:1 is that slot's frame.
  const BANNER = { url: "b", role: "lifestyle", page: "p", width: 2000, height: 600, format: "jpeg", score: 1.2 + 1 } as const;
  const PORTRAIT = { url: "p1", role: "lifestyle", page: "p", width: 1200, height: 1500, format: "jpeg", score: 1.8 } as const;
  const SQUARE = { url: "s", role: "lifestyle", page: "p", width: 900, height: 900, format: "jpeg", score: 0.81 } as const;

  it("passes over the bigger banner for a picture the frame can hold", () => {
    expect(pickForFrame([BANNER, PORTRAIT, SQUARE], 1.11)?.url).toBe("p1");
  });

  it("takes the banner when the frame is a banner", () => {
    expect(pickForFrame([BANNER, PORTRAIT, SQUARE], 3.2)?.url).toBe("b");
  });

  it("falls back to the ranking when the frame could not be measured", () => {
    expect(pickForFrame([BANNER, PORTRAIT], undefined)?.url).toBe("b");
    expect(pickForFrame([BANNER, PORTRAIT], 0)?.url).toBe("b");
  });

  it("has nothing to give when nothing is left", () => {
    expect(pickForFrame([], 1.11)).toBeNull();
  });

  it("ignores a candidate whose dimensions never got read", () => {
    const unmeasured = { ...PORTRAIT, url: "x", width: 0, height: 0, score: 99 };
    expect(pickForFrame([unmeasured, SQUARE], 1.11)?.url).toBe("s");
  });
});
