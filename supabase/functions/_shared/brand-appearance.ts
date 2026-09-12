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

/** A candidate with whatever is known about its shape. */
export type SizedImage = { url: string; width?: number; height?: number };

/**
 * What each slot actually needs, because they are six different jobs.
 *
 * The old rule handed the candidates out in document order, one per slot, and its own note
 * admitted it: "assigned in order, not chosen, so look at the claim and feedback screens
 * before a client does". In practice that put a square packshot behind the sign-in form
 * (where it is stretched across a whole screen) and a wide campaign crop into a claim tile
 * (where it is letterboxed into a thumbnail).
 *
 *   auth background — a full screen behind a form. Wide, and the bigger the better.
 *   top banner      — a letterbox strip across the portal. The widest thing available.
 *   theft / damage  — a tile beside "my piece was stolen". A PIECE, square-ish.
 *   faq             — a tile beside the questions. Landscape, atmospheric.
 *   feedback        — a tile beside "how did we do". Anything portrait or square.
 *
 * `want` is the aspect ratio the slot is happiest with; a candidate is scored by how far it
 * is from that, then by size. An image whose dimensions are unknown is neither favoured nor
 * rejected — it sorts in the middle, because a picture with no measurements is still better
 * than an empty box.
 */
const SLOT_SHAPES: { slot: keyof PortalImages; want: number; minWidth?: number }[] = [
  { slot: "auth_background_image", want: 1.8, minWidth: 1000 },
  { slot: "top_banner_image", want: 3.0, minWidth: 900 },
  { slot: "theft_image", want: 1.0 },
  { slot: "damage_image", want: 1.0 },
  { slot: "faq_image", want: 1.5 },
  { slot: "feedback_image", want: 0.9 },
];

const aspect = (c: SizedImage): number | null =>
  c.width && c.height ? c.width / c.height : null;

/** How wrong this picture is for a slot that wants `want`. Unknown shape = middling. */
function shapeCost(c: SizedImage, want: number): number {
  const ratio = aspect(c);
  if (ratio == null) return 0.6;
  // Log distance, so 3:1 against 1:1 costs the same as 1:3 does.
  return Math.abs(Math.log(ratio / want));
}

/**
 * Hand the candidates out across the six slots, best fit first.
 *
 * Still one picture per slot and never the same one twice: the same photograph behind the
 * login form, across the dashboard banner and on all four claim screens reads as a bug.
 * Fewer pictures than slots leaves the remainder empty, which is honest and which the
 * go-live checklist already has a human tick for.
 *
 * Slots are filled in the order above — the two a client sees first get the pick of the
 * pile — and `preferred` (a brand's own product photography, which is exactly what belongs
 * beside a claim form) is offered to the tiles before anything scraped off a homepage.
 */
export function assignPortalImages(
  candidates: (string | SizedImage)[],
  preferred: { theft_image?: string; damage_image?: string } = {},
): PortalImages {
  const pool: SizedImage[] = candidates.map((c) => (typeof c === "string" ? { url: c } : c));
  const out: PortalImages = {};
  const used = new Set<string>();

  for (const [slot, url] of Object.entries(preferred)) {
    if (url && !used.has(url)) { out[slot as keyof PortalImages] = url; used.add(url); }
  }

  for (const { slot, want, minWidth } of SLOT_SHAPES) {
    if (out[slot]) continue;
    const ranked = pool
      .filter((c) => !used.has(c.url))
      // A hero slot would rather be empty than hold a thumbnail stretched over a screen —
      // but only when the width is actually known.
      .filter((c) => !(minWidth && c.width && c.width < minWidth))
      .map((c) => ({ c, cost: shapeCost(c, want), area: (c.width ?? 0) * (c.height ?? 0) }))
      .sort((a, b) => a.cost - b.cost || b.area - a.area);
    const pick = ranked[0]?.c;
    if (pick) { out[slot] = pick.url; used.add(pick.url); }
  }
  return out;
}

// ── Measuring a picture without downloading it ────────────────────────────────────────

/**
 * The pixel dimensions in an image's header bytes.
 *
 * The first couple of kilobytes of a PNG, JPEG, GIF or WebP carry the size, so the shape of
 * ten candidates costs ten range requests rather than ten photographs. A URL that states
 * its own size is read for free by `sizeFromUrl` and never fetched at all.
 */
export function dimensionsFromHeader(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number, le = false) => (o + 2 <= bytes.length ? view.getUint16(o, le) : 0);
  const u32 = (o: number, le = false) => (o + 4 <= bytes.length ? view.getUint32(o, le) : 0);

  // PNG: IHDR is always the first chunk.
  if (bytes.length > 24 && u32(0) === 0x89504e47) {
    return { width: u32(16), height: u32(20) };
  }
  // GIF87a/GIF89a: little-endian logical screen descriptor.
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: u16(6, true), height: u16(8, true) };
  }
  // WebP: VP8/VP8L/VP8X all state it differently.
  if (bytes.length > 30 && u32(0) === 0x52494646 && u32(8) === 0x57454250) {
    const fourcc = u32(12);
    if (fourcc === 0x56503858) return { width: (u32(24, true) & 0xffffff) + 1, height: ((u32(26, true) >> 8) & 0xffffff) + 1 };
    if (fourcc === 0x56503820) return { width: u16(26, true) & 0x3fff, height: u16(28, true) & 0x3fff };
    if (fourcc === 0x5650384c) {
      const b = u32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: walk the segment markers to the first frame header.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue; }
      const marker = bytes[o + 1];
      // SOF0…SOF15, excluding the four that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: u16(o + 5), width: u16(o + 7) };
      }
      o += 2 + u16(o + 2);
    }
  }
  return null;
}

/** The dimensions a URL states about itself — "…_1600x900.jpg", "?width=1600&height=900". */
export function sizeFromUrl(url: string): { width: number; height: number } | null {
  const pair = SIZE_IN_URL.exec(url);
  if (pair) return { width: Number(pair[1]), height: Number(pair[2]) };
  const w = Number(WIDTH_PARAM.exec(url)?.[1] ?? 0);
  const h = Number(/[?&](?:h|height|sh|maxheight)=(\d{2,4})\b/i.exec(url)?.[1] ?? 0);
  return w && h ? { width: w, height: h } : null;
}

// ── Colour ────────────────────────────────────────────────────────────────────────────

// A custom property NAMED for something is the one colour signal on a stylesheet that is
// not a guess: somebody wrote `--brand-gold`, or `--bg-color`, on purpose. Ferragamo's
// homepage declares exactly one — `--bg-color: #DEDACB`, its sand — and reading only
// brand/primary/accent names threw it away.
const TOKEN_PATTERNS: { slot: keyof NamedColours; re: RegExp }[] = [
  { slot: "primary", re: /--[\w-]*?(?:brand|primary|accent|main|theme)[\w-]*?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi },
  { slot: "background", re: /--[\w-]*?(?:bg|background|surface|paper)[\w-]*?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi },
  { slot: "foreground", re: /--[\w-]*?(?:text|foreground|ink|copy)[\w-]*?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi },
];

export type NamedColours = { primary?: string; background?: string; foreground?: string };

/** Every colour the site names for a role, mapped to the slot that role belongs to. */
export function namedColours(css: string): NamedColours {
  const out: NamedColours = {};
  for (const { slot, re } of TOKEN_PATTERNS) {
    for (const m of css.matchAll(re)) {
      const value = toHex(m[1].trim());
      if (!value) continue;
      // A named token set to white or black is page furniture, not a decision — except for
      // a background, where white is a perfectly deliberate answer.
      if (slot !== "background" && /^#(?:ffffff|000000)$/i.test(value)) continue;
      out[slot] = value;
      break;
    }
  }
  return out;
}

/**
 * The colour a stylesheet leans on hardest that could carry white text.
 *
 * Frequency, NOT saturation. Ferragamo's stylesheet offers #1d1d1b (its near-black, used
 * most), then two blues that belong to an embedded third-party widget — and preferring the
 * colourful one would paint a Florentine house navy.
 */
export function dominantUsableColour(css: string): string | null {
  return frequentColours(css, 8).find((hex) => canCarryWhiteText(hex)) ?? null;
}

/**
 * Could a button in this colour hold white text?
 *
 * This replaces a rule that also demanded saturation >= 12%, which rejected exactly the
 * palette luxury actually uses: Ferragamo's #1d1d1b is 4% saturated and 11% light, so it
 * failed as "too grey" AND as "too dark", and the house was left with AION's gold. Black
 * buttons are the most common primary in this industry. Lightness is the only thing that
 * decides legibility, so it is the only thing tested.
 */
export function canCarryWhiteText(hex: string): boolean {
  const rgb = toHex(hex);
  if (!rgb) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(rgb.slice(i, i + 2), 16) / 255);
  // Relative luminance, the WCAG definition, so "light enough to lose white text" means the
  // same thing here as it does to anyone checking the contrast afterwards.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // 4.5:1 against white, the AA threshold for body text.
  return (1.05) / (luminance + 0.05) >= 4.5;
}

/**
 * The brand's primary colour, or null.
 *
 * Deliberately only the confident case. The existing rule is that a wrong primary is worse
 * than none, because it repaints the whole portal — so a colour is taken when the site
 * names one, and the frequency of hex codes across a stylesheet is reported as a
 * suggestion rather than applied.
 */
export function brandColourFrom(css: string): string | null {
  return namedColours(css).primary ?? null;
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
    // Pure neutrals are page furniture on every site ever built. A near-black like #1d1d1b
    // is NOT one of them — it is a deliberate off-black, and for a monochrome house it is
    // the brand colour.
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
export function googleFontsFrom(html: string, css = ""): BrandFonts | null {
  const link = [...html.matchAll(/<link\b[^>]*href=["']([^"']*fonts\.googleapis\.com\/css2?[^"']*)["'][^>]*>/gi)]
    .map((m) => m[1])
    .find((href) => /family=/.test(href));
  if (!link) return null;

  const url = link.replace(/&amp;/g, "&");
  const families = [...url.matchAll(/family=([^&:]+)/gi)]
    .map((m) => decodeURIComponent(m[1]).replace(/\+/g, " ").trim())
    .filter(Boolean);
  if (!families.length) return null;

  // A LOADED font is not necessarily the site's typeface. Buccellati loads Qwitcher Grypen,
  // a handwriting face, for one flourish — and taking the first family in the link set every
  // heading and every line of body copy in that client's portal to a script font.
  //
  // So when the stylesheet is available, rank the loadable families by how much the site
  // actually uses each one, and refuse a family it barely touches. Without the stylesheet
  // there is nothing to weigh and the link order stands, as before.
  if (css) {
    const used = families
      .map((family) => ({ family, uses: fontFamilyUses(css, family) }))
      .filter((f) => f.uses >= 2)
      .sort((a, b) => b.uses - a.uses);
    if (!used.length) return null;
    return {
      font_url: url,
      // The face used most is the body copy; the runner-up, if there is one, is the display.
      body_font: used[0].family,
      heading_font: (used[1] ?? used[0]).family,
    };
  }

  // Two families is the usual pairing: a display face for headings and a text face for
  // everything else, in that order. One family does both jobs.
  return {
    font_url: url,
    heading_font: families[0],
    body_font: families[1] ?? families[0],
  };
}

/** How many font-family declarations in this stylesheet name a given family. */
export function fontFamilyUses(css: string, family: string): number {
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (css.match(new RegExp(`font-family\\s*:[^;}]*["']?${escaped}["']?`, "gi")) ?? []).length;
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

// ── A typeface we can actually serve ──────────────────────────────────────────────────

// Faces that are BOTH what these houses use and free on Google Fonts, so naming one in the
// record sets a font-family the portal can really load.
//
// The reason this list exists: a house self-hosts its licensed webfonts, so
// `googleFontsFrom` finds no Google link and the record was left with empty font fields and
// a note telling somebody to "pick a near match by hand". But the family the stylesheet
// names is very often a Google face already — Buccellati sets Cormorant, which is free, and
// the programme in production runs on Cormorant Garamond. When the name matches, the match
// is not "near", it is exact.
const SERVABLE_FAMILIES = [
  "Cormorant Garamond", "Cormorant", "Cormorant Infant", "EB Garamond", "Playfair Display",
  "Libre Baskerville", "Lora", "Marcellus", "Italiana", "Tenor Sans", "Gilda Display",
  "Bodoni Moda", "Prata", "Spectral", "Crimson Text", "Josefin Sans", "Jost", "Montserrat",
  "Lato", "Raleway", "Inter", "Work Sans", "Karla", "Manrope", "DM Sans", "Mulish",
  "Nunito Sans", "Open Sans", "Roboto", "Poppins", "Futura", "Optima",
];

/**
 * The typeface a site names, when Google Fonts can serve that exact family.
 *
 * Only an exact family match, and only faces on the list above: guessing that "Ferragamo
 * Sans" is near enough to something else would put a typeface on a client's portal that
 * their brand team never chose. A name we cannot serve stays unanswered, as before.
 */
export function servableDeclaredFonts(css: string): BrandFonts | null {
  const declared = declaredFontFamilies(css, 8);
  const matches = declared
    .map((family) => SERVABLE_FAMILIES.find((s) => s.toLowerCase() === family.toLowerCase()))
    .filter((f): f is string => !!f);
  if (!matches.length) return null;

  const heading = matches[0];
  const body = matches[1] ?? matches[0];
  const families = [...new Set([heading, body])]
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`)
    .join("&");
  return {
    font_url: `https://fonts.googleapis.com/css2?${families}&display=swap`,
    heading_font: heading,
    body_font: body,
  };
}
