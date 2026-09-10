import { describe, it, expect } from "vitest";
import {
  looksLikePhoto, widestFromSrcset, imageCandidates, assignPortalImages,
  brandColourFrom, frequentColours, googleFontsFrom, declaredFontFamilies,
  namedColours, dominantUsableColour, canCarryWhiteText,
} from "../../supabase/functions/_shared/brand-appearance.ts";

// What dresses a client's portal. The failure that matters here is not an empty field — it
// is a payment-card logo stretched across their sign-in screen, or the same photograph on
// all six slots, because both look like a bug the client will point at.

describe("telling a photograph from page furniture", () => {
  it("accepts the kind of image a luxury site puts on its homepage", () => {
    expect(looksLikePhoto("https://cdn.brand.com/media/hero-autumn-2026.jpg")).toBe(true);
    expect(looksLikePhoto("https://cdn.brand.com/image/campaign_1600x900.webp")).toBe(true);
    expect(looksLikePhoto("https://cdn.brand.com/dw/image/v2/lookbook?sw=1200&q=80")).toBe(true);
  });

  it("rejects the furniture that shares a page with it", () => {
    // Every one of these is an <img> on a luxury storefront, and every one of them would be
    // a visible defect behind a login form.
    expect(looksLikePhoto("https://cdn.brand.com/css/images/sprite-nav.png")).toBe(false);
    expect(looksLikePhoto("https://cdn.brand.com/icon/apple-touch-icon-57x57.png")).toBe(false);
    expect(looksLikePhoto("https://cdn.brand.com/footer/payment-visa.png")).toBe(false);
    expect(looksLikePhoto("https://cdn.brand.com/img/logo-header@2x.png")).toBe(false);
    expect(looksLikePhoto("https://cdn.brand.com/ui/spacer.gif")).toBe(false);
  });

  it("rejects a vector, whatever it is called", () => {
    // An SVG is a mark or an icon. Stretched to a page background it is either enormous or
    // invisible, never a photograph.
    expect(looksLikePhoto("https://cdn.brand.com/media/beautiful-campaign.svg")).toBe(false);
  });

  it("rejects an image the URL admits is small", () => {
    expect(looksLikePhoto("https://cdn.brand.com/media/hero_120x80.jpg")).toBe(false);
    expect(looksLikePhoto("https://cdn.brand.com/media/hero.jpg?w=64")).toBe(false);
    expect(looksLikePhoto("https://cdn.brand.com/media/hero.jpg?w=1600")).toBe(true);
  });

  it("takes the widest option a srcset offers", () => {
    // Taking the first would put the phone-sized crop on a desktop login page.
    expect(widestFromSrcset("small.jpg 400w, medium.jpg 900w, big.jpg 1800w")).toBe("big.jpg");
    expect(widestFromSrcset("only.jpg")).toBe("only.jpg");
    expect(widestFromSrcset("")).toBeNull();
  });
});

describe("collecting candidates from a page", () => {
  const origin = "https://www.brand.com";

  it("puts the brand's own share image first", () => {
    const html = `
      <meta property="og:image" content="/media/campaign-hero.jpg">
      <img src="/media/lookbook-01.jpg">
    `;
    expect(imageCandidates({ html, origin })[0]).toBe("https://www.brand.com/media/campaign-hero.jpg");
  });

  it("reads pictures out of srcset, data-src and CSS backgrounds", () => {
    const html = `
      <picture><source srcset="/media/a-800.jpg 800w, /media/a-1800.jpg 1800w"><img src="/media/a-800.jpg"></picture>
      <img data-src="/media/lazy-b.jpg">
      <div style="background-image:url('/media/hero-c.jpg')"></div>
    `;
    const out = imageCandidates({ html, origin });
    expect(out).toContain("https://www.brand.com/media/a-1800.jpg");
    expect(out).toContain("https://www.brand.com/media/lazy-b.jpg");
    expect(out).toContain("https://www.brand.com/media/hero-c.jpg");
  });

  it("reads them out of the renderer's markdown too", () => {
    // The path that works on a site whose bot protection refuses a plain fetch — which is
    // most of them. cleanMarkdown throws these away at index time; nothing else keeps them.
    const markdown = "Some copy\n\n![Autumn campaign](https://cdn.brand.com/media/campaign.jpg)\n\n![](/media/second.jpg)";
    const out = imageCandidates({ markdown, origin });
    expect(out).toEqual([
      "https://cdn.brand.com/media/campaign.jpg",
      "https://www.brand.com/media/second.jpg",
    ]);
  });

  it("counts the same picture once, however it is spelled", () => {
    const html = `
      <img src="/media/hero.jpg">
      <img src="/media/hero@2x.jpg">
      <img src="/media/hero.jpg?w=1600&q=80">
      <img src="/media/hero-1200x800.jpg">
    `;
    expect(imageCandidates({ html, origin })).toHaveLength(1);
  });

  it("keeps the furniture out", () => {
    const html = `
      <img src="/media/campaign.jpg">
      <img src="/img/logo.png">
      <img src="/footer/payment-visa.png">
      <img src="/ui/sprite.png">
    `;
    expect(imageCandidates({ html, origin })).toEqual(["https://www.brand.com/media/campaign.jpg"]);
  });
});

describe("handing images to the six slots", () => {
  const six = ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg"];

  it("dresses the screens a client sees first", () => {
    const out = assignPortalImages(six);
    expect(out.auth_background_image).toBe("a.jpg");
    expect(out.top_banner_image).toBe("b.jpg");
    expect(out.feedback_image).toBe("f.jpg");
  });

  it("leaves slots empty rather than repeating one picture six times", () => {
    // The same photograph behind the login form, across the dashboard banner and on all
    // four claim screens reads as a bug, not as a brand.
    const out = assignPortalImages(["only.jpg", "second.jpg"]);
    expect(out.auth_background_image).toBe("only.jpg");
    expect(out.top_banner_image).toBe("second.jpg");
    expect(out.theft_image).toBeUndefined();
    expect(Object.values(out)).toHaveLength(2);
  });

  it("hands nothing out when there is nothing", () => {
    expect(assignPortalImages([])).toEqual({});
  });
});

describe("the primary colour", () => {
  it("takes a colour the site names for itself", () => {
    expect(brandColourFrom(":root{--brand-gold:#c9a227;--grey:#888}")).toBe("#c9a227");
    expect(brandColourFrom(":root{--color-primary: #8b1a1a;}")).toBe("#8b1a1a");
  });

  it("ignores a named token set to a neutral", () => {
    // Pasquale Bruni declares #ffffff. Taking it repaints the whole portal white.
    // Expanded to six digits on the way out: the platform stores one form, not two.
    expect(brandColourFrom(":root{--primary:#ffffff;--brand-red:#a11}")).toBe("#aa1111");
    expect(brandColourFrom(":root{--primary:#fff}")).toBeNull();
  });

  it("reads a colour a build tool wrote as rgb()", () => {
    expect(brandColourFrom(":root{--brand-accent: rgb(201, 162, 39)}")).toBe("#c9a227");
    expect(brandColourFrom(":root{--brand:#C9A227}")).toBe("#c9a227");
    expect(brandColourFrom(":root{--brand:#c92}")).toBe("#cc9922");
  });

  it("says nothing when the site names nothing", () => {
    // A wrong primary is worse than none, because it repaints every screen. Frequency
    // across a stylesheet is a suggestion for a human, never an answer.
    expect(brandColourFrom("body{color:#333}.btn{background:#c9a227}")).toBeNull();
  });

  it("maps a colour to the role the site named it for", () => {
    // Ferragamo's homepage declares exactly one colour token — its sand — and reading only
    // brand/primary/accent names threw it away and left the portal on AION's defaults.
    expect(namedColours(":root{--bg-color:#DEDACB}")).toEqual({ background: "#dedacb" });
    expect(namedColours(":root{--text-color:#1d1d1b;--brand-gold:#c9a227}"))
      .toEqual({ foreground: "#1d1d1b", primary: "#c9a227" });
  });

  it("keeps white as a legitimate background but not as a brand colour", () => {
    expect(namedColours(":root{--bg-color:#ffffff}")).toEqual({ background: "#ffffff" });
    expect(namedColours(":root{--primary:#ffffff}")).toEqual({});
  });

  it("judges a primary on whether white text survives on it, not on how colourful it is", () => {
    // The rule this replaces demanded saturation >= 12% and lightness >= 12%. Ferragamo's
    // near-black is 4% and 11%, so it failed twice over and the house kept AION's gold —
    // while black buttons are the most common primary in the whole industry.
    expect(canCarryWhiteText("#1d1d1b")).toBe(true);
    expect(canCarryWhiteText("#000000")).toBe(true);
    expect(canCarryWhiteText("#8b1a1a")).toBe(true);
    expect(canCarryWhiteText("#ffffff")).toBe(false);
    expect(canCarryWhiteText("#dedacb")).toBe(false);
  });

  it("takes the most-used usable colour, never the most colourful one", () => {
    // Ferragamo's stylesheet offers its near-black first, then two blues belonging to an
    // embedded third-party widget. Preferring saturation would paint a Florentine house navy.
    const css = ".a{color:#1d1d1b}.b{color:#1d1d1b}.c{color:#1d1d1b}.d{color:#1d1d1b}"
      + ".e{color:#28356a}.f{color:#28356a}.g{color:#28356a}";
    expect(dominantUsableColour(css)).toBe("#1d1d1b");
  });

  it("skips colours too light to hold white text when choosing a primary", () => {
    const css = ".a{color:#dedacb}.b{color:#dedacb}.c{color:#dedacb}.d{color:#8b1a1a}.e{color:#8b1a1a}.f{color:#8b1a1a}";
    expect(dominantUsableColour(css)).toBe("#8b1a1a");
  });

  it("suggests the colours a stylesheet leans on, neutrals excluded", () => {
    const css = ".a{color:#c9a227}.b{border:1px solid #c9a227}.c{background:#c9a227}"
      + ".d{color:#ffffff}.e{color:#ffffff}.f{color:#ffffff}.g{color:#111111}";
    expect(frequentColours(css)).toEqual(["#c9a227"]);
  });
});

describe("the typefaces", () => {
  it("takes the families only when the URL that serves them is there too", () => {
    const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&amp;family=DM+Sans&amp;display=swap">`;
    expect(googleFontsFrom(html)).toEqual({
      font_url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans&display=swap",
      heading_font: "Playfair Display",
      body_font: "DM Sans",
    });
  });

  it("uses one family for both jobs when only one is loaded", () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400">`;
    expect(googleFontsFrom(html)).toMatchObject({ heading_font: "Inter", body_font: "Inter" });
  });

  it("answers nothing for a house that self-hosts its own typeface", () => {
    // Naming a licensed font the portal cannot serve makes every heading fall back
    // silently — worse than an empty field, which at least asks someone to look.
    expect(googleFontsFrom(`<style>@font-face{font-family:"Ferragamo Sans";src:url(/f.woff2)}</style>`)).toBeNull();
  });

  it("still reports what the page names, for a human to act on", () => {
    const css = `body{font-family:"Ferragamo Sans", Helvetica, sans-serif}h1{font-family:var(--display)}h2{font-family:Didot, serif}`;
    expect(declaredFontFamilies(css)).toEqual(["Ferragamo Sans", "Didot"]);
  });
});
