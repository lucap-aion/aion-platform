import { jsonLdNodes } from "./product-extract.ts";
import { fetchSite } from "./fetch-site.ts";
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

import { AION_UA } from "./robots.ts";
const UA = AION_UA;

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
    // The format argument was missing here, so the renderer was asked for
    // "X-Return-Format: undefined" and this fallback never did what it says:
    // a house that renders its photography in JavaScript got no portal imagery
    // at all, which is the exact case the branch exists for.
    markdown = await fetchRendered(base, jinaKey, "markdown");
    photos = imageCandidates({ html, markdown, origin });
    if (photos.length) out.notes.push("the homepage renders its photography in JavaScript, so the images were read through the renderer");
  }
  // Measured, so each slot can be given a picture the right shape for it rather than the
  // next one in document order. See assignPortalImages.
  // 14 was chosen when measuring mostly failed; it now succeeds, and it is a
  // 2KB range request per picture, run in parallel. It matters because an
  // UNMEASURED candidate is not judged by a slot's shape floor — so with 88
  // pictures and 14 measured, the other 74 walked into the banner slot through
  // the gap marked "unknown".
  const sized = await measureImages(photos.slice(0, 40));
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
  let declaredLogo = abs(
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

  // A declared logo can be the shop platform's own. brunellocucinelli.com declares
  // /images/logo.svg, which is the Salesforce Commerce Cloud template's placeholder — the
  // site's header draws the real crest from logo-black.svg — and it went on the brand record
  // and into the intro deck.
  //
  // And any logo can be the WHITE one — drawn for the transparent header over the hero
  // picture, invisible on the portal's white header and the deck's cream slides. A filename
  // that says "white" is caught by pickLogoImg; eberhard-co-watches.ch's says "logo-2.svg"
  // and paints everything #fff, so an SVG is also judged by the colours it declares
  // (svgIsLight). A light logo is kept only when there is no other.
  //
  // A declared logo can also be the site's ICON. WordPress publishes its site icon as the
  // Organization logo — eberhard-co-watches.ch declares cropped-favico-eb.png, the "E"
  // shield — and it went on the record as the logo the open sidebar shows by name. A
  // wordmark is never square, so a square one (or one named as an icon) gives way to the
  // header's logo, and is kept as the monogram if the site declared no bigger one.
  let lightLogo: string | undefined;
  let siteIcon: string | undefined;
  if (declaredLogo) {
    const body = (await fetchText(declaredLogo)) ?? "";
    if (isPlatformPlaceholderLogo(declaredLogo, body)) {
      out.notes.push(`the logo the site declares (${declaredLogo}) is its shop platform's placeholder, not the house's — took the one in the page header instead`);
      declaredLogo = undefined;
    } else if (svgIsLight(body)) {
      lightLogo = declaredLogo;
      declaredLogo = undefined;
    } else if (await isSiteIcon(declaredLogo, body)) {
      siteIcon = declaredLogo;
      declaredLogo = undefined;
      if (!out.logo_small) out.logo_small = siteIcon;
    }
  }

  // Failing that, an <img> whose class, id, alt or filename says logo — and failing that,
  // the logo the header draws inline as SVG.
  let markupLogo: string | undefined;
  if (!declaredLogo) {
    // A few, not all: each SVG candidate costs a fetch, and the header's are first.
    for (const tag of logoImgCandidates(html).slice(0, 4)) {
      const url = abs(getAttr(tag, "src") ?? getAttr(tag, "data-src"));
      if (!url) continue;
      if (/\.svg(?:[?#]|$)/i.test(url) && svgIsLight((await fetchText(url)) ?? "")) {
        lightLogo ??= url;
        continue;
      }
      markupLogo = url;
      break;
    }
  }
  let inlineLogo = declaredLogo || markupLogo ? undefined : inlineSvgLogo(html);
  if (inlineLogo && svgIsLight(decodeURIComponent(inlineLogo.slice(inlineLogo.indexOf(",") + 1)))) {
    lightLogo ??= inlineLogo;
    inlineLogo = undefined;
  }
  const logo = declaredLogo ?? markupLogo ?? inlineLogo ?? siteIcon ?? lightLogo;
  if (logo) {
    out.logo_big = logo;
    out.found.push(
      declaredLogo ? "logo (declared)" : markupLogo ? "logo (markup)" : inlineLogo ? "logo (inline SVG)"
        : logo === siteIcon ? "logo (site icon)" : "logo (white)",
    );
    if (siteIcon && logo !== siteIcon) {
      out.notes.push(`the logo the site declares (${siteIcon}) is its square site icon — took the one in the page header for the name, kept the icon as the monogram`);
    }
    if (logo === siteIcon) {
      out.notes.push("the only logo the site offers is its square icon — the open sidebar needs the house's name; set a wordmark by hand");
    }
    if (logo === lightLogo) {
      out.notes.push("the only logo the site offers is a white one — it will not show on the portal's white header; set a dark version by hand");
    }
  }
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
  // The canvas is NOT harvested, deliberately. A site's own background is the
  // one colour that cannot be lifted into this portal: it arrives without the
  // text, card and sidebar colours that make it legible, and taking it gave
  // Prada a black page with dark type on it. The portal's canvas is AION's —
  // see THEME_KEYS in src/contexts/TenantContext.tsx — so recording a
  // background here would only write a value nothing reads.
  //
  // Everything the house actually is — its logo, its primary, its typeface,
  // its photography — is still taken below.

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
      // Through fetchSite. A stylesheet is not an asset being re-hosted, it is
      // the site's own design being read — it is where the colours and the
      // typefaces are — so it belongs on the same path as the page it styles.
      // With a plain AION_UA fetch, prada.com returned nothing and the house
      // came out of onboarding with one colour, no primary and no typeface.
      const got = await fetchSite(href, { timeoutMs: 12000, accept: "text/css,*/*" });
      if (!got.response?.ok) return "";
      const text = await got.response.text();
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
      // Through fetchSite, so a house that drops our agent still gets measured.
      // It was a plain fetch with AION_UA, and on prada.com every one of the
      // fourteen candidates came back unreachable — which does not fail loudly,
      // it just means assignPortalImages has no shapes to sort by and falls back
      // to document order. The stage then reported "0 of 14 measured" and filled
      // all six slots with 4:5 packshots, including the wide ones.
      const got = await fetchSite(url, { timeoutMs: 8000, accept: "image/*,*/*" });
      const res = got.response;
      if (!res || (!res.ok && res.status !== 206)) return { url };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const dims = dimensionsFromHeader(bytes);
      return dims ? { url, ...dims } : { url };
    } catch { return { url }; }
  }));
}

/**
 * A page of the house's own site, for reading its identity.
 *
 * "could not fetch the homepage" was the branding stage's most common failure
 * and it was usually a bot wall, not a site that was down. fetchSite goes out
 * as us first and only falls back to a browser agent on a refusal.
 */
async function fetchText(url: string): Promise<string | null> {
  const got = await fetchSite(url, { timeoutMs: 15_000 });
  if (!got.response || !got.response.ok) return null;
  try {
    return await got.response.text();
  } catch { return null; }
}

/**
 * A logo file that belongs to the shop platform rather than to the house — the template's
 * placeholder that nobody replaced. Read from the file itself: Salesforce's ships with
 * `<title>2016sf_CommerceCloud_logo_RGB</title>`, under a path that says only "logo.svg".
 */
export function isPlatformPlaceholderLogo(url: string, body: string): boolean {
  if (/placeholder/i.test(url)) return true;
  return /commerce_?cloud|salesforce|shopify_logo|magento_logo|woocommerce_logo/i.test(body.slice(0, 4000));
}

/**
 * The header logo from the markup. A header often carries two — a white one for the
 * transparent header over the hero picture, and a dark one for the solid header — and the
 * white comes first. On the deck's cream slides and the portal's white header it is invisible.
 */
export function pickLogoImg(html: string): string | undefined {
  return logoImgCandidates(html)[0];
}

/** Every <img> that is plausibly the logo, best first: a dark-by-name one before one whose
 *  name says white, document order otherwise. */
export function logoImgCandidates(html: string): string[] {
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    // "No Logo" is how a campaign photographer labels the clean version of a key visual —
    // messika.com's hero is "…Key Visual - 169 - No Logo - 150 DPI…jpg" — and it went on
    // the record as the house's logo. A tag that says logo only to say there is none is not one.
    .filter((tag) => /logo|brand-?mark|wordmark/i.test(tag.replace(/no(?:[\s_-]|%20)*logo/gi, "")))
    .filter((tag) => !/sprite|placeholder|payment|card/i.test(tag));
  const light = (tag: string) => /white|inverse|negative|reverse/i.test(tag);
  return [...tags.filter((t) => !light(t)), ...tags.filter(light)];
}

/** A site icon passed off as the logo: named as one, or measured (from an SVG's viewBox, or a
 *  raster's header bytes) to be roughly square. Unmeasurable → false: no claim either way. */
async function isSiteIcon(url: string, body: string): Promise<boolean> {
  if (/fav-?icon|favico|site-?icon|apple-touch|touch-icon/i.test(url)) return true;
  let ratio = 0;
  const viewBox = /<svg\b[^>]*viewBox=["']([^"']+)["']/i.exec(body)?.[1];
  if (viewBox) {
    const [, , w, h] = viewBox.trim().split(/[\s,]+/).map(Number);
    ratio = w > 0 && h > 0 ? w / h : 0;
  } else {
    const [m] = await measureImages([url]);
    ratio = m.width && m.height ? m.width / m.height : 0;
  }
  return ratio > 0.8 && ratio < 1.25;
}

/**
 * Is this SVG a white (or near-white) logo? Judged from every colour it declares — fill,
 * stroke and gradient stops, as attributes or CSS — and true only when there is at least
 * one and all of them are light. An SVG that declares nothing paints black, so it is not.
 * `none`, `transparent`, `currentColor` and `url(#…)` say nothing about the ink and are
 * skipped. Not an SVG (a PNG's bytes as text, an empty body) → false: no claim either way.
 */
export function svgIsLight(body: string): boolean {
  if (!/<svg\b/i.test(body)) return false;
  const values = [
    ...body.matchAll(/\b(?:fill|stroke|stop-color)\s*=\s*["']([^"']+)["']/gi),
    ...body.matchAll(/\b(?:fill|stroke|stop-color)\s*:\s*([^;"'}]+)/gi),
  ].map((m) => m[1].trim().toLowerCase());
  const lum: number[] = [];
  for (const v of values) {
    if (/^(none|transparent|currentcolor|inherit)$/.test(v) || v.startsWith("url(")) continue;
    const rgb = parseColour(v);
    if (!rgb) continue;
    lum.push(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
  }
  return lum.length > 0 && lum.every((l) => l > 0.85 * 255);
}

function parseColour(v: string): [number, number, number] | null {
  if (v === "white") return [255, 255, 255];
  if (v === "black") return [0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.slice(0, 3).split("").map((c) => c + c).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/**
 * The header logo when it is drawn inline rather than linked: an `<svg>` in the page, often
 * just `<use href="#messika-logo-2025">` pointing at a `<symbol>` elsewhere in the document.
 * Most modern storefronts do this, and none of it is an <img>, so the markup search found
 * nothing and the next best thing on the page — a campaign photo — went on the record.
 *
 * Returned as a data: URL of a standalone SVG. The branding stage copies it into our storage
 * like any other logo (mirrorImage reads data: URLs), so the record ends up with our URL.
 *
 * Which inline SVG: one the markup calls a logo (its class/id/aria/title, the id it uses, or
 * the link around it), or the first one inside a link home that is clearly a wordmark — wider
 * than twice its height. Icons are square and are never it.
 */
export function inlineSvgLogo(html: string): string | undefined {
  const symbols = new Map<string, { viewBox?: string; body: string }>();
  for (const m of html.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/gi)) {
    const id = getAttr(m[1], "id");
    if (id) symbols.set(id, { viewBox: getAttr(m[1], "viewBox"), body: m[2] });
  }
  const ratio = (viewBox?: string) => {
    const [, , w, h] = (viewBox ?? "").trim().split(/[\s,]+/).map(Number);
    return w > 0 && h > 0 ? w / h : 0;
  };

  type Found = { score: number; svg: string };
  const found: Found[] = [];
  for (const m of html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi)) {
    const [, attrs, inner] = m;
    const ref = /<use\b[^>]*(?:xlink:)?href=["']#([^"']+)["']/i.exec(inner)?.[1];
    const symbol = ref ? symbols.get(ref) : undefined;
    if (ref && !symbol) continue;
    const viewBox = getAttr(attrs, "viewBox") ?? symbol?.viewBox;
    const body = symbol ? symbol.body : inner;
    if (!/<(path|polygon|rect|circle|ellipse|text|g)\b/i.test(body)) continue;

    // The 300 characters before the <svg> hold the link (or wrapper) it sits in.
    const before = html.slice(Math.max(0, (m.index ?? 0) - 300), m.index);
    const wrapper = before.slice(before.lastIndexOf("<")) ?? "";
    const saysLogo = /logo|brand-?mark|wordmark/i.test(`${attrs} ${ref ?? ""} ${/<title>([^<]*)/i.exec(inner)?.[1] ?? ""} ${wrapper}`);
    const linksHome = /<a\b[^>]*(aria-label=["'](home|homepage)["']|href=["'](\/|https?:\/\/[^"'/]+\/?(?:[a-z]{2}(?:[-_][a-z]{2})?\/?)?)["'])/i.test(wrapper);
    const wide = ratio(viewBox) >= 2;
    if (!(saysLogo || (linksHome && wide))) continue;
    if (!wide && ratio(viewBox) > 0 && ratio(viewBox) < 0.9) continue; // a tall glyph is an icon
    found.push({
      score: (saysLogo ? 2 : 0) + (linksHome ? 1 : 0) + (wide ? 1 : 0),
      svg: `<svg xmlns="http://www.w3.org/2000/svg"${viewBox ? ` viewBox="${viewBox}"` : ""}>${body}</svg>`,
    });
  }
  const best = found.sort((a, b) => b.score - a.score)[0];
  return best ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(best.svg)}` : undefined;
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
