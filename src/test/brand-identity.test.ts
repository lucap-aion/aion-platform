import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonLdNodes } from "../../supabase/functions/_shared/product-extract";
import { isPlatformPlaceholderLogo, pickLogoImg } from "../../supabase/functions/_shared/brand-identity";

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
});
