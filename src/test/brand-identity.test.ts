import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonLdNodes } from "../../supabase/functions/_shared/product-extract";
import { inlineSvgLogo, isPlatformPlaceholderLogo, pickLogoImg } from "../../supabase/functions/_shared/brand-identity";

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
