// Photographs of a house, found on the house's own site.
//
// The intro deck needs three things a product catalogue does not contain: a boutique with the
// sign above the door, the face of the house, and people wearing the pieces. Until now the
// only non-packshot pictures available were the two campaign shots onboarding keeps for the
// portal's hero slots — and for a house that publishes them as AVIF, or does not publish them
// on its homepage at all, that is nothing. So those slots kept the template's stock
// photography and the deck went out looking like a template.
//
// The site already tells us where to look. The crawl enqueues every page it finds, and these
// houses file this material predictably: /store-locator, /pradasphere/campaigns, /world,
// /maison, /lookbook. Pick the pages whose URL says what they are, read the pictures off
// them, and keep the ones that are actually photographs.
//
// THE HOUSE'S OWN SITE, and nowhere else. A picture of a brand's boutique on a brand's own
// site is theirs, shown back to them in a deck about their programme. A picture of the same
// boutique from a stock library or a magazine is somebody else's copyright and could not go
// in a client deck at all — so there is no "search the web" here, and the page a picture came
// from is reported with it so anybody can check.
//
// I/O is injected, so the ranking and the reading are unit tested against real markup.

import { imageSize, sniffFormat } from "./image-bytes.ts";

export type PhotoRole = "store" | "ambassador" | "lifestyle";

export type CrawledPage = { url: string; title?: string | null };

export type FoundPhoto = {
  url: string;
  role: PhotoRole;
  /** The page it was found on, so the choice can be checked. */
  page: string;
  width: number;
  height: number;
  format: string;
  score: number;
};

/** What a page about each of these looks like, in the URLs these houses actually use. */
const PAGE_PATTERNS: Record<PhotoRole, RegExp> = {
  // A store locator is the one page every luxury site has and every one of them illustrates.
  store: /store-?locator|store-?director|\/stores?\b|boutique|negoz|tiend|magasin|shop-?finder|flagship|epicent/i,
  // Campaign and editorial. "pradasphere" is not a generalisation from one house — it is the
  // pattern: each of them invents a name for this section, so the generic words have to be
  // there too and the house-specific ones are a bonus when they match.
  ambassador: /campaign|ambassador|testimonial|celebrit|editorial|portrait|\/world\b|maison|stories|journal|magazine|pradasphere/i,
  lifestyle: /campaign|lookbook|\/look\b|collection|editorial|runway|fashion-?show|sfilat|defile|\/world\b|stories|pradasphere/i,
};

/** Words in an image's own URL or alt text that make it likelier to be what we want. */
const IMAGE_HINTS: Record<PhotoRole, RegExp> = {
  store: /store|boutique|shop|interior|facade|vetrin|window|flagship/i,
  ambassador: /campaign|portrait|ambassador|face|hero|talent|celebrit/i,
  lifestyle: /campaign|look|lifestyle|editorial|model|worn|street/i,
};

/**
 * Things that are on every page and are never the photograph.
 *
 * A logo is the failure that matters: it is on every page, it is often the largest PNG in the
 * markup, and a deck whose "boutique photograph" is the brand's own wordmark is worse than
 * one that left the stock image alone.
 */
const NEVER = /logo|icon|favicon|sprite|placeholder|pixel|spacer|badge|button|arrow|chevron|flag|payment|visa|mastercard|paypal|social|facebook|instagram|twitter|linkedin|youtube|wechat|qr-?code|loader|spinner|avatar|thumb(?:nail)?[-_.]?(?:s|small)?\b/i;

// A photograph, in the terms a slide needs. Below this it is a thumbnail, and a deck slot is
// half a slide wide.
const MIN_LONG_EDGE = 700;
const MIN_SHORT_EDGE = 400;
// Wider than this is a banner or a hero strip, taller is a mobile poster; neither crops into
// the near-square boxes these slots are.
const MAX_ASPECT = 2.6;
const MIN_ASPECT = 0.38;

/**
 * The pages worth opening for one role, best first.
 *
 * Scored rather than filtered: a site with no /store-locator still has pages, and reading the
 * three best guesses costs three requests. Localised duplicates are collapsed — these sites
 * publish the same page per market, and reading prada.com/tr/tr and prada.com/ie/en of the
 * same campaign is two requests for one picture.
 */
export function rankPages(pages: CrawledPage[], role: PhotoRole, want = 4): CrawledPage[] {
  const pattern = PAGE_PATTERNS[role];
  const seen = new Set<string>();
  const scored: { page: CrawledPage; score: number }[] = [];

  for (const p of pages) {
    const url = p.url ?? "";
    if (!url) continue;
    const haystack = `${url} ${p.title ?? ""}`;
    const hits = (haystack.match(new RegExp(pattern.source, "gi")) ?? []).length;
    if (!hits) continue;

    const key = localeFreeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);

    scored.push({
      page: p,
      // More matches is a stronger signal; a shorter path is usually the section's own index
      // page rather than one item within it, and an index page carries more photography.
      score: hits * 10 - depth(url),
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, want).map((s) => s.page);
}

/** The same page in another market reduced to one key: /ww/en/x and /tr/tr/x are one page. */
function localeFreeKey(url: string): string {
  try {
    const u = new URL(url);
    // Up to TWO leading locale segments, because these sites use both shapes: prada.com
    // files a page under /ww/en and /tr/tr, while others use a single /it. Stripping one at a
    // time left "/en/campaign" and "/tr/campaign" looking like different pages.
    return u.host.replace(/^www\./, "") + u.pathname
      .replace(/^(?:\/[a-z]{2}(?:[-_][a-z]{2})?){1,2}(?=\/)/i, "")
      .replace(/\/$/, "");
  } catch { return url; }
}

function depth(url: string): number {
  try { return new URL(url).pathname.split("/").filter(Boolean).length; } catch { return 9; }
}

/**
 * Every picture referenced by a page, as absolute URLs.
 *
 * All four of the ways these sites deliver photography: the social preview, plain <img>, the
 * responsive <img srcset> / <source srcset> (where the LARGEST candidate is taken, because
 * the first one listed is the phone), and CSS background images, which is how a full-bleed
 * campaign shot is usually set.
 */
export function imageUrlsFrom(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const abs = absolute(raw.trim(), pageUrl);
    if (abs) out.push(abs);
  };

  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/gi)) {
    push(/content=["']([^"']+)["']/i.exec(m[0])?.[1]);
  }
  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) ?? []) {
    const srcset = attrValue(tag, "srcset") ?? attrValue(tag, "data-srcset");
    if (srcset) push(largestInSrcset(srcset));
    push(attrValue(tag, "src"));
    // Lazy loading puts a placeholder in src and the real URL somewhere else. On a Vue or
    // Alpine page that "somewhere else" is a BOUND attribute, and the binding is where this
    // originally failed — see attrValue.
    push(attrValue(tag, "data-src"));
    push(attrValue(tag, "data-original"));
  }
  for (const m of html.matchAll(/background-image\s*:\s*url\((["']?)([^)"']+)\1\)/gi)) {
    push(m[2]);
  }
  // Markdown, because a JavaScript-rendered page only yields its photography through the
  // renderer, and the renderer answers in markdown far more reliably than in HTML. Harmless
  // on real markup: `![alt](url)` does not occur in HTML.
  for (const m of html.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    push(m[1]);
  }

  // Order matters — og:image first, then document order — so dedupe keeps the first sighting.
  return [...new Set(out)];
}

/**
 * One attribute's value, however the page happens to write it.
 *
 * Three shapes, and the third is the one that mattered. A plain `src="/a.jpg"`; a
 * single-quoted `src='/a.jpg'`; and a FRAMEWORK BINDING, which is what these sites are built
 * on — Vue and Alpine write `:data-src="'/content/dam/…jpg'"`, with the real value quoted
 * INSIDE the attribute quotes. A pattern looking for `data-src="([^"']+)"` sees the inner
 * quote immediately and matches nothing, silently: prada.com's campaign pages carry
 * thirty-eight pictures written exactly that way, and the deck reported "no usable picture on
 * the ambassador pages" for a page that is nothing but photography.
 *
 * `:src="''"` — a bound empty placeholder — correctly yields nothing.
 */
function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?::|\\b)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const raw = m?.[1] ?? m?.[2];
  if (raw == null) return undefined;
  // Unwrap a bound value: "'/a.jpg'" and "['/a.jpg']" both mean /a.jpg.
  const inner = /^\[?\s*(['"])([\s\S]*?)\1\s*\]?$/.exec(raw.trim());
  const value = (inner ? inner[2] : raw).trim();
  return value || undefined;
}

/** "a.jpg 400w, b.jpg 1600w" -> "b.jpg". The first entry is the phone's. */
function largestInSrcset(srcset: string): string | undefined {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = Number(/(\d+)w/.exec(size ?? "")?.[1] ?? 0);
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url;
}

function absolute(raw: string, pageUrl: string): string | null {
  if (!raw || raw.startsWith("data:")) return null;
  try { return new URL(raw, pageUrl).toString(); } catch { return null; }
}

/** Ruled out on its URL alone, before spending a request measuring it. */
export function plausiblePhotoUrl(url: string): boolean {
  const path = url.split("?")[0];
  if (/\.svg$/i.test(path)) return false;      // vector: a logo or an icon, never a photograph
  if (NEVER.test(path)) return false;
  return true;
}

/**
 * The photographs on one house's site for the roles asked for.
 *
 * `readPage` and `readImageHead` are injected: the caller supplies the fetcher that knows
 * about this house's bot wall, and the tests supply markup.
 */
export async function findBrandPhotos(opts: {
  pages: CrawledPage[];
  roles: PhotoRole[];
  readPage: (url: string) => Promise<string | null>;
  /** The first few kilobytes of an image — enough for its format and dimensions. */
  readImageHead: (url: string) => Promise<Uint8Array | null>;
  /** Pages opened per role. Each one is a request. */
  pagesPerRole?: number;
  /** Candidate images measured per role. Each one is a request. */
  measurePerRole?: number;
}): Promise<{ photos: FoundPhoto[]; notes: string[] }> {
  const notes: string[] = [];
  const photos: FoundPhoto[] = [];
  const measured = new Map<string, { width: number; height: number; format: string } | null>();

  for (const role of opts.roles) {
    const pages = rankPages(opts.pages, role, opts.pagesPerRole ?? 3);
    if (!pages.length) {
      notes.push(`no page on this site reads as ${role} photography`);
      continue;
    }

    const candidates: { url: string; page: string; hint: number }[] = [];
    for (const page of pages) {
      const html = await opts.readPage(page.url);
      if (!html) { notes.push(`${page.url} could not be read`); continue; }
      for (const url of imageUrlsFrom(html, page.url)) {
        if (!plausiblePhotoUrl(url)) continue;
        candidates.push({ url, page: page.url, hint: IMAGE_HINTS[role].test(url) ? 1 : 0 });
      }
    }
    if (!candidates.length) { notes.push(`no usable picture on the ${role} pages`); continue; }

    // Measure the ones the URL already argues for, then the rest, and stop at the budget —
    // measuring is a request each and a campaign page can list eighty pictures.
    const order = candidates.sort((a, b) => b.hint - a.hint);
    let spent = 0;
    const budget = opts.measurePerRole ?? 12;
    for (const c of order) {
      if (spent >= budget) break;
      if (!measured.has(c.url)) {
        spent++;
        const head = await opts.readImageHead(c.url);
        measured.set(c.url, head ? describe(head) : null);
      }
      const m = measured.get(c.url);
      if (!m) continue;
      if (!isPhotograph(m)) continue;
      photos.push({
        url: c.url, role, page: c.page,
        width: m.width, height: m.height, format: m.format,
        // Area, in megapixels, plus a nudge for a URL that says what it is. Big is the best
        // available proxy for "this is the editorial shot rather than a thumbnail of it".
        score: (m.width * m.height) / 1_000_000 + c.hint,
      });
    }
    if (!photos.some((p) => p.role === role)) {
      notes.push(spent === 1
        ? `the one picture on the ${role} pages was not a usable photograph`
        : `${spent} pictures on the ${role} pages were measured and none was a usable photograph`);
    }
  }

  photos.sort((a, b) => b.score - a.score);
  return { photos, notes };
}

function describe(head: Uint8Array): { width: number; height: number; format: string } | null {
  const format = sniffFormat(head);
  if (!format) return null;
  const size = imageSize(head);
  if (!size) return null;
  return { width: size.w, height: size.h, format };
}

/** Big enough, and shaped like a photograph rather than a banner or a button. */
function isPhotograph(m: { width: number; height: number; format: string }): boolean {
  // AVIF is excluded here as well as at embed time: measuring it and then refusing it later
  // wastes a slot that another candidate could have had.
  if (m.format === "avif") return false;
  const long = Math.max(m.width, m.height);
  const short = Math.min(m.width, m.height);
  if (long < MIN_LONG_EDGE || short < MIN_SHORT_EDGE) return false;
  const aspect = m.width / m.height;
  return aspect <= MAX_ASPECT && aspect >= MIN_ASPECT;
}
