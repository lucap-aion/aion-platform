import { jsonLdNodes } from "./product-extract.ts";
import { customerServiceEmail } from "./brand-defaults.ts";
import {
  imageCandidates, assignPortalImages, namedColours, dominantUsableColour,
  canCarryWhiteText, frequentColours, googleFontsFrom, declaredFontFamilies,
  servableDeclaredFonts, dimensionsFromHeader, sizeFromUrl, type SizedImage,
} from "./brand-appearance.ts";
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
  // The four claim/FAQ/feedback slots. Never attempted before, so every onboarded brand
  // arrived at the Record tab with four empty upload boxes.
  theft_image?: string;
  damage_image?: string;
  faq_image?: string;
  feedback_image?: string;
  theme_settings?: Record<string, string>;
  // The registered office, when the house publishes it as structured data. The legal-page
  // reader in brand-legal.ts is the other source; this one is free and more often right,
  // because it is what the site hands Google.
  hq_address?: string;
  hq_postcode?: string;
  hq_city?: string;
  hq_country?: string;
  found: string[];
  notes: string[];
};

const UA = "Mozilla/5.0 (AION brand onboarding)";

export async function harvestBrandIdentity(website: string, jinaKey = ""): Promise<BrandIdentity> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  const out: BrandIdentity = { found: [], notes: [] };

  // `let`, because the renderer branch below reassigns it. It was `const`, and every house
  // that refuses a plain fetch crashed the branding stage with "Assignment to constant
  // variable" — never caught, because nothing typechecks the edge functions and
  // typescript-eslint switches no-const-assign off on the grounds that TypeScript will.
  let html = await fetchText(base) ?? "";
  let markdown = "";
  // Two different ways a luxury homepage yields no pictures to a plain fetch, and both are
  // normal. Some refuse it outright — ferragamo.com answers 403 to anything that is not a
  // browser. Others answer with a JavaScript shell: stylesheets and meta tags, and not one
  // <img> tag, because the photography is loaded client-side.
  //
  // The crawl already goes through a renderer for exactly this reason, so borrow it. Its
  // markdown carries a ![](…) for every image the page actually shows, which is the one
  // source of brand photography that works on either kind of site.
  if (jinaKey && !html) {
    // HTML, not markdown. Markdown carries the pictures and throws away everything else, so
    // a house that refuses a plain fetch — most of them — had no colour, no typeface, no
    // declared logo and no structured data: "imagery only, no colours or fonts" was a
    // limitation of the request, not of the site.
    html = await fetchRendered(base, jinaKey, "html");
    if (html) out.notes.push("the homepage refused a direct fetch, so it was read through the renderer");
    else {
      markdown = await fetchRendered(base, jinaKey, "markdown");
      if (markdown) out.notes.push("the homepage could only be read as text through the renderer — imagery only, no colours or fonts");
    }
  }
  if (!html && !markdown) { out.notes.push("could not fetch the homepage"); return out; }

  // The site's own stylesheets, which is where the colours and the typefaces live on any
  // site built this decade. Reading only the inline <style> blocks worked for the houses
  // that ship one enormous inline sheet and found nothing at all on the rest — Buccellati
  // came out of onboarding with AION's gold as its primary and a handwriting font.
  const css = html ? `${inlineStyles(html)}\n${await fetchStylesheets(html, base)}` : "";

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

  // A contact address the brand publishes itself — and only a ROLE address on the house's
  // own domain. The old rule preferred those and then fell back to `emails[0]`, which is
  // whatever appeared first in the markup: one house ended up with boutique.milano@ on its
  // record, an address that would have gone into a customer FAQ as where to send a claim.
  // Same rule as the crawl-wide search in brand-defaults, so both agree.
  const contact = customerServiceEmail(html, base);
  if (contact) { out.email = contact; out.found.push("email"); }

  // ── Marks ─────────────────────────────────────────────────────────────────
  // Every picture the page offers, best first, handed out one per slot.
  //
  // This used to be og:image alone, copied into two of the six slots and nothing in the
  // other four — so a house that declared no share image (Ferragamo declares none) got no
  // portal imagery at all, and one that did got the same photograph twice.
  let photos = imageCandidates({ html, markdown, origin });
  if (!photos.length && html && jinaKey) {
    // The fetch worked and still produced nothing: a rendered shell. Ask the renderer.
    markdown = await fetchRendered(base, jinaKey);
    photos = imageCandidates({ html, markdown, origin });
    if (photos.length) out.notes.push("the homepage renders its photography in JavaScript, so the images were read through the renderer");
  }
  // Measured, so each slot can be given a picture the right shape for it rather than the
  // next one in document order. See assignPortalImages.
  const sized = await measureImages(photos.slice(0, 14));
  const portal = assignPortalImages(sized);
  Object.assign(out, portal);
  const slotsFilled = Object.keys(portal).length;
  if (slotsFilled) {
    out.found.push(`${slotsFilled} portal image${slotsFilled === 1 ? "" : "s"}`);
    const measured = sized.filter((c) => c.width).length;
    out.notes.push(
      `${slotsFilled} of 6 portal slots filled from ${photos.length} usable picture${photos.length === 1 ? "" : "s"} on the homepage, ` +
      `chosen by shape (${measured} of ${sized.length} measured) — a wide one behind the sign-in form, square ones in the claim tiles. ` +
      "Worth a look before a client sees them.",
    );
  } else {
    out.notes.push("no usable photography on the homepage — the six portal images have to be collected by hand");
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

  // ── Where the company is ──────────────────────────────────────────────────
  // schema.org PostalAddress, which a house publishes for Google's local results. Free —
  // the JSON-LD is already parsed — and it is the same fact the legal-page reader goes
  // hunting for in the privacy policy. Empty nodes are common (Pomellato publishes
  // `address: {"@type":"PostalAddress"}` and nothing else), so every field is optional.
  const postal = jsonLdNodes(html)
    .map((n) => n.address as unknown)
    .flatMap((a) => (Array.isArray(a) ? a : [a]))
    .find((a): a is Record<string, unknown> => !!a && typeof a === "object"
      && Object.keys(a).some((k) => /streetAddress|postalCode|addressLocality/.test(k)));
  if (postal) {
    const str = (k: string) => {
      const v = postal[k];
      return typeof v === "string" && v.trim() ? clean(v).slice(0, 200) : undefined;
    };
    out.hq_address = str("streetAddress");
    out.hq_postcode = str("postalCode");
    out.hq_city = str("addressLocality");
    out.hq_country = str("addressCountry");
    const parts = [out.hq_address, out.hq_postcode, out.hq_city].filter(Boolean);
    if (parts.length) out.found.push(`registered office, declared (${parts.join(", ")})`);
  }

  // ── Colour ────────────────────────────────────────────────────────────────
  // A custom property the site NAMED for its brand is the one stylesheet signal that is not
  // a guess — somebody wrote `--brand-gold` on purpose. theme-color is the fallback, and it
  // is usually white or black because it exists to tint mobile browser chrome: Pasquale
  // Bruni declares #ffffff, and taking that repaints the entire portal white.
  //
  // Everything beyond those two stays a suggestion. A wrong primary is worse than none.
  const theme: Record<string, string> = {};
  const named = namedColours(`${html}\n${css}`);
  const themeColor = meta(html, "theme-color");

  // Whatever the site names for a role goes to that role. Ferragamo names one thing —
  // `--bg-color: #DEDACB`, its sand — and reading only brand/primary/accent threw it away.
  const setColour = (slot: string, hex: string | undefined, why: string) => {
    const hsl = hex ? toHsl(hex) : null;
    if (!hsl) return false;
    theme[slot] = hsl;
    out.found.push(`${why} (${hex})`);
    return true;
  };
  setColour("background_hsl", named.background, "background colour, named by the site");
  setColour("foreground_hsl", named.foreground, "text colour, named by the site");

  // The primary, in order of how much the site meant it.
  const themeColorUsable = themeColor && canCarryWhiteText(themeColor.trim()) ? themeColor.trim() : null;
  const dominant = dominantUsableColour(`${html}\n${css}`);
  const primary = (named.primary && canCarryWhiteText(named.primary) ? named.primary : null)
    ?? themeColorUsable
    ?? dominant;

  if (primary && setColour("primary_hsl", primary,
    primary === named.primary ? "primary colour, named by the site"
      : primary === themeColorUsable ? "primary colour, from theme-color"
      : "primary colour, the one this site uses most")) {
    if (primary === dominant) {
      out.notes.push(`the site names no brand colour, so the primary was taken as ${primary} — the colour its stylesheet uses most that can still carry white text. Check it.`);
    }
  } else {
    // theme-color is usually white because it exists to tint mobile browser chrome, and
    // taking that repaints the whole portal white. Pasquale Bruni declares #ffffff.
    if (themeColor) out.notes.push(`theme-color is ${themeColor} — too light to carry white text, so it is browser chrome rather than a brand colour`);
    const suggestions = frequentColours(`${html}\n${css}`);
    out.notes.push(suggestions.length
      ? `no usable brand colour anywhere; the stylesheet leans on ${suggestions.join(", ")}, none of which can carry white text — pick the primary by hand`
      : "no brand colour declared anywhere — pick the primary by hand");
  }

  // ── Typefaces ─────────────────────────────────────────────────────────────
  // Only when they can actually be served. A house's own typeface is licensed and
  // self-hosted, so putting its name in the record sets a font-family the portal cannot
  // load and every heading falls back silently — worse than the empty field, which at least
  // asks somebody to look.
  // What the site LOADS from Google first, then what it NAMES that Google happens to serve.
  // The second case is the common one: these houses self-host their licensed faces, and the
  // family is very often a free one anyway — Buccellati sets Cormorant.
  const fonts = googleFontsFrom(html, css) ?? servableDeclaredFonts(`${html}\n${css}`);
  if (fonts) {
    Object.assign(theme, fonts);
    out.found.push(`fonts (${fonts.heading_font}${fonts.body_font !== fonts.heading_font ? ` / ${fonts.body_font}` : ""})`);
  } else {
    const named = declaredFontFamilies(`${html}\n${css}`);
    out.notes.push(named.length
      ? `the site sets ${named.join(", ")} — licensed faces it hosts itself and none of them is a family Google serves, so they cannot be loaded here; pick a near match by hand`
      : "no loadable typeface declared — set the fonts by hand");
  }

  if (Object.keys(theme).length) out.theme_settings = theme;

  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────
// The crawl's renderer, used here only when a direct fetch was refused. HTML by preference:
// it carries the stylesheets, the structured data and the <img> tags, so a site that blocks
// us still yields a colour, a typeface and a declared logo. Markdown is the fallback and is
// enough for imagery alone.
async function fetchRendered(url: string, jinaKey: string, format: "html" | "markdown"): Promise<string> {
  try {
    const res = await fetch("https://r.jina.ai/" + url, {
      headers: {
        ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
        Accept: "text/plain",
        "X-Return-Format": format,
      },
      signal: AbortSignal.timeout(45000),
    });
    return res.ok ? await res.text() : "";
  } catch { return ""; }
}

/** Every <style> block on the page, concatenated. */
function inlineStyles(html: string): string {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

// Enough of the site's own CSS to find a brand colour in, and no more: three sheets, a
// megabyte each. A luxury homepage links a dozen, most of them a cookie banner or a carousel
// library, and the brand tokens are in the first one or two the page loads.
const MAX_SHEETS = 3;
const MAX_SHEET_BYTES = 1_000_000;

async function fetchStylesheets(html: string, base: string): Promise<string> {
  let origin: string;
  try { origin = new URL(base).origin; } catch { return ""; }

  const hrefs: string[] = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["'][^"']*stylesheet/i.test(tag[0])) continue;
    const href = getAttr(tag[0], "href");
    if (!href) continue;
    let abs: string;
    try { abs = new URL(href.replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
    // Same origin only. A third-party sheet is a cookie banner or a chat widget, and its
    // colours are not the brand's — those blues are exactly what the frequency rule used to
    // mistake for a primary.
    if (!abs.startsWith(origin)) continue;
    if (/fonts\.googleapis|fonts\.gstatic/.test(abs)) continue;
    hrefs.push(abs);
    if (hrefs.length >= MAX_SHEETS) break;
  }
  if (!hrefs.length) return "";

  const sheets = await Promise.all(hrefs.map(async (href) => {
    try {
      const res = await fetch(href, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) return "";
      const text = await res.text();
      return text.length > MAX_SHEET_BYTES ? text.slice(0, MAX_SHEET_BYTES) : text;
    } catch { return ""; }
  }));
  return sheets.join("\n");
}

/**
 * The shape of each candidate picture.
 *
 * A URL that states its own size answers for free. For the rest, ask for the first two
 * kilobytes — the header of a PNG, JPEG, GIF or WebP carries the dimensions — and fall back
 * to unknown, which the slot assignment treats as "neither good nor bad" rather than
 * discarding.
 */
async function measureImages(urls: string[]): Promise<SizedImage[]> {
  return await Promise.all(urls.map(async (url) => {
    const stated = sizeFromUrl(url);
    if (stated) return { url, ...stated };
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Range: "bytes=0-2047" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok && res.status !== 206) return { url };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const dims = dimensionsFromHeader(bytes);
      return dims ? { url, ...dims } : { url };
    } catch { return { url }; }
  }));
}

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
