// ==============================|| WHAT THE PORTAL LOOKS LIKE ||============================== //
// The imagery, the primary colour and the typefaces — the fields that decide whether a
// client's portal looks like theirs or like AION's.
//
// The harvester filled two of them and only when the homepage declared an og:image: the
// auth background and the top banner. The four section images (theft, damage, FAQ,
// feedback), the fonts and, for most sites, the colour were never attempted at all, so a
// freshly onboarded brand arrived at the Record tab with six empty upload boxes, blank font
// fields and AION's own gold as its primary. That is most of "Collect the brand assets" and
// all of "Define the portal theme" on the go-live checklist, left as manual work.
//
// The hard part is not finding images — a luxury homepage is nothing but images — it is
// rejecting the ones that are furniture. Payment-card logos, sprites, spacers and the
// brand's own wordmark are all <img> tags, and any of them landing on a client's sign-in
// screen is worse than the empty box it replaced.
//
// No imports: pure functions over strings, unit-tested from the frontend suite.

// ── Imagery ───────────────────────────────────────────────────────────────────────────

// Anything whose URL says it is not a photograph. Ordered by how often it bites: payment
// marks sit in every luxury footer, and a sprite sheet is the single worst thing to stretch
// across a login page.
const NOT_A_PHOTO =
  /(?:sprite|favicon|apple-touch|placeholder|spacer|pixel|blank|1x1|transparent|payment|visa|mastercard|amex|paypal|klarna|applepay|googlepay|badge|flag[-_/]|icon[-_./]|[-_/]icons?[-_/]|logo|wordmark|brandmark|loader|spinner|arrow|chevron|close|burger|menu)/i;

// A size in the URL is the cheapest honest signal that an image is too small to be a hero.
const SIZE_IN_URL = /(?:^|[^\d])(\d{2,4})\s*[x×]\s*(\d{2,4})(?:[^\d]|$)/;
const WIDTH_PARAM = /[?&](?:w|width|sw|maxwidth)=(\d{2,4})\b/i;

const MIN_EDGE = 400;

/** Strip the parts of a URL that make the same picture look like two. */
function imageKey(url: string): string {
  return url
    .replace(/[?#].*$/, "")
    .replace(/@[23]x(?=\.\w+$)/i, "")
    .replace(/[-_](?:\d{2,4}[x×]\d{2,4}|small|medium|large|thumb|mobile|desktop)(?=\.\w+$)/i, "")
    .toLowerCase();
}

/** Does this URL look like a photograph big enough to sit behind a sign-in form? */
export function looksLikePhoto(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // SVG is a logo or an icon, never a photograph, whatever its filename says.
  if (/\.svg(?:[?#]|$)/i.test(url)) return false;
  if (!/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url) && !/\/image\/|\/media\/|format=/i.test(url)) return false;
  if (NOT_A_PHOTO.test(url)) return false;

  const dims = SIZE_IN_URL.exec(url);
  if (dims && (Number(dims[1]) < MIN_EDGE || Number(dims[2]) < MIN_EDGE)) return false;
  const w = WIDTH_PARAM.exec(url);
  if (w && Number(w[1]) < MIN_EDGE) return false;
  return true;
}

/** The widest candidate a srcset offers. "a.jpg 400w, b.jpg 1600w" -> b.jpg */
export function widestFromSrcset(srcset: string): string | null {
  const best = srcset.split(",")
    .map((part) => part.trim().split(/\s+/))
    .map(([url, size]) => ({ url, w: Number((size ?? "").replace(/[wx]$/i, "")) || 0 }))
    .filter((c) => c.url)
    .sort((a, b) => b.w - a.w)[0];
  return best?.url ?? null;
}

export type ImageSources = {
  /** The page's HTML, when a direct fetch got through. */
  html?: string;
  /** The renderer's markdown, which carries ![](…) for every image it saw. */
  markdown?: string;
  /** For resolving relative URLs. */
  origin: string;
};

/**
 * Every picture the page offers, best first, deduplicated.
 *
 * "Best" is: the share image the brand chose for itself, then anything it marked up as its
 * own content image, then everything else in document order. There is no way to tell a hero
 * from a lookbook shot without laying the page out, and both are fine on a portal.
 */
export function imageCandidates({ html, markdown, origin }: ImageSources): string[] {
  const abs = (u: string | null | undefined): string | null => {
    if (!u) return null;
    const trimmed = u.trim();
    if (!trimmed || trimmed.startsWith("data:")) return null;
    try { return new URL(trimmed, origin).toString(); } catch { return null; }
  };

  const ordered: string[] = [];
  const push = (u: string | null) => { if (u) ordered.push(u); };

  if (html) {
    // The brand's own chosen share image, first.
    for (const prop of ["og:image", "og:image:secure_url", "twitter:image"]) {
      const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i").exec(html)?.[0];
      if (tag) push(abs(/content=["']([^"']+)["']/i.exec(tag)?.[1]));
    }
    // <picture><source srcset> outranks the <img> it wraps: it is the version the site
    // actually serves to a large screen.
    for (const m of html.matchAll(/<source\b[^>]*>/gi)) {
      const srcset = /srcset=["']([^"']+)["']/i.exec(m[0])?.[1];
      if (srcset) push(abs(widestFromSrcset(srcset)));
    }
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const srcset = /(?:data-)?srcset=["']([^"']+)["']/i.exec(tag)?.[1];
      if (srcset) push(abs(widestFromSrcset(srcset)));
      push(abs(/\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1]));
      push(abs(/\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]));
    }
    // Hero imagery is very often a CSS background rather than an <img>.
    for (const m of html.matchAll(/background-image\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
      push(abs(m[2]));
    }
  }

  // The renderer's markdown. This is the path that works on a site whose bot protection
  // refuses a plain fetch — which is most luxury storefronts.
  if (markdown) {
    for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*(<?)([^)\s>]+)\1[^)]*\)/g)) push(abs(m[2]));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of ordered) {
    if (!looksLikePhoto(url)) continue;
    const key = imageKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export type PortalImages = {
  auth_background_image?: string;
  top_banner_image?: string;
  theft_image?: string;
  damage_image?: string;
  faq_image?: string;
  feedback_image?: string;
};

// The order the slots get filled. The two a client sees first come first, so a site that
// only yields two usable pictures still dresses the sign-in screen and the dashboard.
const SLOTS: (keyof PortalImages)[] = [
  "auth_background_image", "top_banner_image",
  "theft_image", "damage_image", "faq_image", "feedback_image",
];

/**
 * Hand the candidates out across the six slots, one each.
 *
 * Distinct on purpose, and short rather than repeated: the same photograph behind the login
 * form, across the dashboard banner and on all four claim screens reads as a bug. Fewer
 * pictures than slots leaves the remainder empty, which is honest and which the go-live
 * checklist already has a human tick for.
 */
export function assignPortalImages(candidates: string[]): PortalImages {
  const out: PortalImages = {};
  SLOTS.forEach((slot, i) => { if (candidates[i]) out[slot] = candidates[i]; });
  return out;
}

// ── Colour ────────────────────────────────────────────────────────────────────────────

// A custom property NAMED for the brand is the one colour signal on a stylesheet that is
// not a guess: somebody wrote `--brand-gold` on purpose.
const BRAND_TOKEN = /--(?:[\w-]*?(?:brand|primary|accent|main|theme)[\w-]*?)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi;

/**
 * The brand's primary colour, or null.
 *
 * Deliberately only the confident case. The existing rule is that a wrong primary is worse
 * than none, because it repaints the whole portal — so a colour is taken when the site
 * names one, and the frequency of hex codes across a stylesheet is reported as a
 * suggestion rather than applied.
 */
export function brandColourFrom(css: string): string | null {
  for (const m of css.matchAll(BRAND_TOKEN)) {
    const value = toHex(m[1].trim());
    if (!value) continue;
    // A named token set to white or black is a neutral, not the house colour.
    if (/^#(?:ffffff|000000)$/i.test(value)) continue;
    return value;
  }
  return null;
}

/** "#c9a227", "#c92", "rgb(201, 162, 39)" -> "#c9a227". The platform speaks hex. */
export function toHex(value: string): string | null {
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) return `#${short[1].split("").map((c) => c + c).join("").toLowerCase()}`;
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value);
  if (long) return `#${long[1].toLowerCase()}`;
  // rgb()/rgba() is how a stylesheet written by a build tool states the same colour.
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i.exec(value);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
    if (parts.some((n) => n > 255)) return null;
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/** The hex codes a stylesheet leans on, most used first — a suggestion for a human. */
export function frequentColours(css: string, limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    // Neutrals are page furniture on every site ever built.
    if (/^#(?:0{6}|f{6}|([0-9a-f])\1{5})$/i.test(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex);
}

// ── Typefaces ─────────────────────────────────────────────────────────────────────────

export type BrandFonts = { font_url: string; heading_font: string; body_font: string };

/**
 * The typefaces, but only when they can actually be loaded.
 *
 * A luxury house's own typeface is licensed and self-hosted, so naming it in the record
 * would set a font-family the portal cannot serve and every heading would silently fall
 * back. So this only answers for a site that loads Google Fonts, where the name and the URL
 * that provides it come together and both are usable.
 */
export function googleFontsFrom(html: string): BrandFonts | null {
  const link = [...html.matchAll(/<link\b[^>]*href=["']([^"']*fonts\.googleapis\.com\/css2?[^"']*)["'][^>]*>/gi)]
    .map((m) => m[1])
    .find((href) => /family=/.test(href));
  if (!link) return null;

  const url = link.replace(/&amp;/g, "&");
  const families = [...url.matchAll(/family=([^&:]+)/gi)]
    .map((m) => decodeURIComponent(m[1]).replace(/\+/g, " ").trim())
    .filter(Boolean);
  if (!families.length) return null;

  // Two families is the usual pairing: a display face for headings and a text face for
  // everything else, in that order. One family does both jobs.
  return {
    font_url: url,
    heading_font: families[0],
    body_font: families[1] ?? families[0],
  };
}

/** The font families a page names, for a note when they cannot be loaded. */
export function declaredFontFamilies(css: string, limit = 3): string[] {
  const seen = new Set<string>();
  // NOT [^;}"'] — excluding the quote made `font-family:"Ferragamo Sans", …` match the
  // empty string between the colon and the quote, which is exactly the case this exists for.
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(",")[0].replace(/["']/g, "").trim();
    // Generic families and CSS variables say nothing about the house.
    if (!first || first.startsWith("var(") || /^(?:inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system)$/i.test(first)) continue;
    seen.add(first);
    if (seen.size >= limit) break;
  }
  return [...seen];
}
