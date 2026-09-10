import { describe, it, expect } from "vitest";

// Two pieces of logic that were wrong in production and are easy to break again.

// ── 1. Page classification ──────────────────────────────────────────────────
// categorize() used to run on url + title + the first 300 characters of the
// page. On a luxury site those 300 characters are the global nav — "World of
// LB", "About us", "Sustainability", "Craft" — so every page matched the
// storytelling rule before the product rule was reached, and 112 of Luisa
// Beccaria's 141 "storytelling" documents were product pages.
const PRODUCT_URL = /\/(products?|p|item|articolo|prodotti?)\/[^/]+/i;
const RULES: { re: RegExp; category: string }[] = [
  { re: /(return|reso|warranty|garanzia|shipping|faq|privacy|terms|legal)/i, category: "policy" },
  { re: /(about|stor(y|ia)|heritage|founder|maison|world|values|sustainab|craft)/i, category: "storytelling" },
  { re: /(product|collection|collezion|care|materials?)/i, category: "product" },
];

function categorize(url: string, title = "", text = ""): string {
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  if (PRODUCT_URL.test(path)) return "product";
  const label = `${path} ${title}`;
  for (const r of RULES) if (r.re.test(label)) return r.category;
  for (const r of RULES) if (r.re.test(text)) return r.category;
  return "other";
}

const LB_NAV = "Skip to content World of LB About us Sustainability Bridal Collections New in";

describe("page classification", () => {
  it("a product URL is a product page whatever the nav says", () => {
    expect(categorize(
      "https://luisabeccaria.com/products/flower-embroidered-tulle-maxi-gown",
      "Flower Embroidered Tulle Maxi Gown", LB_NAV,
    )).toBe("product");
  });

  it("the site nav no longer decides the category", () => {
    // The exact regression: nav text alone must not make a product page
    // "storytelling".
    expect(categorize("https://luisabeccaria.com/products/tumbler-glass", "Glass", LB_NAV))
      .not.toBe("storytelling");
  });

  it("still recognises genuine editorial", () => {
    expect(categorize("https://luisabeccaria.com/pages/about-us", "About our exclusive brand"))
      .toBe("storytelling");
  });

  it("still recognises policy pages", () => {
    expect(categorize("https://luisabeccaria.com/pages/returns-and-refunds", "Returns and refunds"))
      .toBe("policy");
  });
});

// ── 2. Lexical retrieval ────────────────────────────────────────────────────
// Vector search is blind to names: a document answering "what is the Zafferano
// Protocol?" scored below the floor while answering the paraphrased question at
// 0.89. The lexical pass exists to catch invented names.
const STOP = new Set(["what", "which", "the", "and", "our", "is", "are", "rules", "policy", "tell", "how", "does"]);
function salientTerms(query: string): string[] {
  const words: string[] = query.match(/[\p{L}][\p{L}\p{N}'-]{3,}/gu) ?? [];
  return words
    .filter((w) => !STOP.has(w.toLowerCase()))
    .filter((w) => /^[\p{Lu}]/u.test(w) || w.length >= 7)
    .slice(0, 4);
}

describe("lexical fallback term selection", () => {
  it("picks the invented name out of the question", () => {
    expect(salientTerms("What is the Zafferano Protocol and what are its rules?")).toContain("Zafferano");
  });

  it("picks an internal code", () => {
    expect(salientTerms("What does Codice 7-B cover?")).toContain("Codice");
  });

  it("does not fire on an ordinary short question", () => {
    // Nothing distinctive → no lexical lookup, so we don't drag in half the corpus.
    expect(salientTerms("what are the rules")).toHaveLength(0);
  });

  it("never returns more than four terms", () => {
    expect(salientTerms("Zafferano Protocol Bottoncino Ceremony Bridesmaids Beachwear Pomellato").length)
      .toBeLessThanOrEqual(4);
  });
});

// ── Locale variants ─────────────────────────────────────────────────────────
// Pasquale Bruni's sitemap lists every Middle East market, so the crawler
// indexed the same page under ar-sa, ar-qa, ar-kw, en-sa and en-qa. 531
// documents covering 139 pages. These pin the rule that collapses them.

const LOCALE_SEG = /^[a-z]{2}(-[a-z]{2})?$/i;

function preferCanonicalLocale(urls: string[]): string[] {
  const best = new Map<string, { url: string; score: number }>();
  for (const raw of urls) {
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    const segs = u.pathname.split("/").filter(Boolean);
    const hasLocale = segs.length > 0 && LOCALE_SEG.test(segs[0]);
    const locale = hasLocale ? segs[0].toLowerCase() : "";
    const key = `${u.hostname}/${(hasLocale ? segs.slice(1) : segs).join("/")}${u.search}`;
    const score = !hasLocale ? 0 : locale.startsWith("en") ? 1 : 2;
    const cur = best.get(key);
    // Ties break on length, then lexically — never on which order the sitemap
    // happened to list them, or the same crawl could pick en-sa one day and
    // en-qa the next and re-index the whole base as "new" documents.
    const better = !cur || score < cur.score ||
      (score === cur.score && (raw.length < cur.url.length ||
        (raw.length === cur.url.length && raw < cur.url)));
    if (better) best.set(key, { url: raw, score });
  }
  return [...best.values()].map((v) => v.url);
}

describe("locale variants collapse to one page", () => {
  const page = (l: string) => `https://www.pasqualebruni.com/${l}/blogs/news/luce`;

  it("keeps the unprefixed page over every market variant", () => {
    const out = preferCanonicalLocale([
      page("ar-sa"), page("en-qa"), "https://www.pasqualebruni.com/blogs/news/luce", page("ar-kw"),
    ]);
    expect(out).toEqual(["https://www.pasqualebruni.com/blogs/news/luce"]);
  });

  it("prefers English when the site only serves locale-prefixed URLs", () => {
    const out = preferCanonicalLocale([page("ar-sa"), page("ar-qa"), page("en-qa"), page("ar-kw")]);
    expect(out).toEqual([page("en-qa")]);
  });

  it("is stable between crawls, not dependent on sitemap order", () => {
    const a = preferCanonicalLocale([page("ar-sa"), page("en-sa"), page("en-qa")]);
    const b = preferCanonicalLocale([page("en-qa"), page("ar-sa"), page("en-sa")]);
    expect(a).toEqual(b);
  });

  it("does not merge genuinely different pages", () => {
    const out = preferCanonicalLocale([
      "https://x.com/en-gb/collections/rings",
      "https://x.com/en-gb/collections/necklaces",
    ]);
    expect(out).toHaveLength(2);
  });

  it("leaves a two-letter path that is not a locale alone", () => {
    // /it/ is a locale; /shop/ is not, and neither is a product slug.
    const out = preferCanonicalLocale(["https://x.com/shop/rings", "https://x.com/it/shop/rings"]);
    expect(out).toEqual(["https://x.com/shop/rings"]);
  });

  it("collapses the real Pasquale Bruni shape 5:1", () => {
    const urls = ["ar-sa", "ar-qa", "ar-kw", "en-sa", "en-qa"].flatMap((l) => [
      page(l), `https://www.pasqualebruni.com/${l}/collections/fall-selection`,
    ]);
    expect(urls).toHaveLength(10);
    expect(preferCanonicalLocale(urls)).toHaveLength(2);
  });
});

describe("html entities in titles", () => {
  const NAMED: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    ndash: "–", mdash: "—", rsquo: "’", eacute: "é",
  };
  const decode = (s: string) => s.replace(/&([a-z]+);/gi, (m, n) => NAMED[String(n).toLowerCase()] ?? m);

  it("decodes the entity that reached 395 of one brand's titles", () => {
    expect(decode("Fall selection &ndash; Pasquale Bruni")).toBe("Fall selection – Pasquale Bruni");
  });

  it("leaves an unknown entity visible rather than eating it", () => {
    expect(decode("A &weirdthing; B")).toBe("A &weirdthing; B");
  });
});
