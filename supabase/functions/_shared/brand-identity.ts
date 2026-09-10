import { jsonLdNodes } from "./product-extract.ts";
// Harvest a brand's visual identity from its own website.
//
// A brand record starts almost empty: name, website, maybe a country. Everything
// that makes the platform look like THEIRS — the logo on the login screen, the
// primary colour, the description, the hero imagery — was typed in by hand from
// the site. All of it is sitting in the site's markup.
//
// Nothing here overwrites a value an admin has already set unless explicitly
// asked to: a hand-picked logo beats a scraped one every time.

export type BrandIdentity = {
  description?: string;
  email?: string;
  logo_big?: string;
  logo_small?: string;
  top_banner_image?: string;
  auth_background_image?: string;
  theme_settings?: Record<string, string>;
  found: string[];
  notes: string[];
};

const UA = "Mozilla/5.0 (AION brand onboarding)";

export async function harvestBrandIdentity(website: string): Promise<BrandIdentity> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  const out: BrandIdentity = { found: [], notes: [] };

  const html = await fetchText(base);
  if (!html) { out.notes.push("could not fetch the homepage"); return out; }

  const origin = new URL(base).origin;
  const abs = (u: string | null | undefined) => {
    if (!u) return undefined;
    try { return new URL(u, origin).toString(); } catch { return undefined; }
  };

  // ── Copy ──────────────────────────────────────────────────────────────────
  // Organization.description first. og:description and <meta name=description>
  // are written for search results — Ferragamo's is "Shop the latest Ferragamo
  // collection for women & men at Ferragamo.com", which is shop copy, not a
  // description of the house.
  const declaredDesc = jsonLdNodes(html)
    .filter((n) => {
      const t = n["@type"];
      const types = Array.isArray(t) ? t.map(String) : [String(t)];
      return types.some((x) => ["Organization", "Corporation", "Brand", "WebSite", "OnlineStore"].includes(x));
    })
    .map((n) => (typeof n.description === "string" ? n.description : undefined))
    .find((d) => d && d.trim().length > 30);

  const description = declaredDesc ?? meta(html, "og:description") ?? meta(html, "description");
  if (description) {
    out.description = clean(description).slice(0, 600);
    out.found.push(declaredDesc ? "description (declared)" : "description (SEO metadata)");
    if (!declaredDesc) {
      out.notes.push("the description came from the page's SEO metadata, which is written for search results rather than about the house — worth rewriting");
    }
  }

  // A contact address the brand publishes itself. Skip the obvious noise.
  const emails = [...html.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)].map((m) => m[0].toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/sentry|wixpress|example|domain\.com/.test(e));
  const contact = emails.find((e) => /^(info|customercare|customer\.?service|clientservice|contact|hello|care)@/.test(e)) ?? emails[0];
  if (contact) { out.email = contact; out.found.push("email"); }

  // ── Marks ─────────────────────────────────────────────────────────────────
  // og:image is the brand's own chosen share image — the best single hero we
  // can get without judgement. The icons are the reliable small mark.
  const ogImage = abs(meta(html, "og:image"));
  if (ogImage) {
    out.top_banner_image = ogImage;
    out.auth_background_image = ogImage;
    out.found.push("hero image");
  }

  // LARGEST icon, not the first one in the document. Ferragamo lists 57x57
  // before 114x114, so taking the first gave a 57px favicon — which then went
  // into the brand tile AND, once the deck learned to co-brand, onto nine slides.
  const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:apple-touch-)?icon[^"']*["'][^>]*>/gi)]
    .map((m) => m[0])
    .map((tag) => ({
      href: getAttr(tag, "href"),
      size: Number((getAttr(tag, "sizes") ?? "").split("x")[0]) || 0,
    }))
    .filter((i) => i.href)
    .sort((a, b) => b.size - a.size);
  const icon = abs(icons[0]?.href);
  if (icon) {
    out.logo_small = icon;
    out.found.push(icons[0].size ? `icon ${icons[0].size}px` : "icon");
    if (icons[0].size && icons[0].size < 120) {
      out.notes.push(`the largest icon this site declares is only ${icons[0].size}px — fine for a browser tab, too small for a deck, so set the full logo by hand`);
    }
  }

  // The logo the site DECLARES, before the logo we go looking for. schema.org
  // Organization.logo is the canonical answer and is what Google reads; the
  // markup search below only ever found logos that happened to be <img> tags
  // with a helpful class, which missed every site using a CSS background or an
  // inline SVG. Ferragamo publishes it and we were ignoring it.
  const declaredLogo = abs(
    jsonLdNodes(html)
      .filter((n) => {
        const t = n["@type"];
        const types = Array.isArray(t) ? t.map(String) : [String(t)];
        return types.some((x) => ["Organization", "Corporation", "Brand", "WebSite", "OnlineStore"].includes(x));
      })
      .map((n) => {
        const l = n.logo as unknown;
        if (typeof l === "string") return l;
        if (l && typeof l === "object") return (l as Record<string, unknown>).url as string | undefined;
        return undefined;
      })
      .find(Boolean),
  );

  // Failing that, an <img> whose class, id, alt or filename says logo.
  const logoImg = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    .find((tag) => /logo|brand-?mark|wordmark/i.test(tag) && !/sprite|placeholder|payment|card/i.test(tag));
  const logo = declaredLogo ?? abs(logoImg ? (getAttr(logoImg, "src") ?? getAttr(logoImg, "data-src")) : undefined);
  if (logo) { out.logo_big = logo; out.found.push(declaredLogo ? "logo (declared)" : "logo (markup)"); }
  else { out.notes.push("no logo found — the deck will carry only AION's mark until one is set on the record"); }

  // ── Colour ────────────────────────────────────────────────────────────────
  // theme-color is the one colour a site declares about itself. Anything more
  // (parsing stylesheets, averaging pixels) guesses, and a wrong primary colour
  // is worse than none because it repaints the whole portal.
  const themeColor = meta(html, "theme-color");
  const hsl = themeColor ? toHsl(themeColor.trim()) : null;
  if (hsl && isUsablePrimary(hsl)) {
    out.theme_settings = { primary_hsl: hsl };
    out.found.push("primary colour");
  } else if (hsl) {
    // Most sites set theme-color to white or black for the mobile browser
    // chrome. Taking that as the brand's primary repaints the entire portal in
    // it — worse than leaving the default. Pasquale Bruni declares #ffffff.
    out.notes.push(`theme-color is ${themeColor} — browser chrome, not a brand colour; set the primary by hand`);
  } else {
    out.notes.push("no theme-color declared — pick the primary colour by hand");
  }

  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function meta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  return attr(html, re, "content");
}

function attr(html: string, tagRe: RegExp, name: string): string | undefined {
  const tag = html.match(tagRe)?.[0];
  return tag ? getAttr(tag, name) : undefined;
}

function getAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

function clean(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}

// A primary colour has to be able to carry white text on a button. Near-white,
// near-black and fully desaturated values cannot.
function isUsablePrimary(hsl: string): boolean {
  const [, sat, light] = hsl.match(/^(\d+) (\d+)% (\d+)%$/)?.map(Number) ?? [];
  if (sat === undefined || light === undefined) return false;
  return light >= 12 && light <= 88 && sat >= 12;
}

// The platform stores colours as "H S% L%" (shadcn CSS variables), not hex.
function toHsl(color: string): string | null {
  const hex = color.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
    : ((r - g) / d + 4) / 6;
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
