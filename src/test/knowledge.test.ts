import { describe, it, expect } from "vitest";
import { englishSitemapsFirst, preferCanonicalLocale } from "../../supabase/functions/_shared/crawl.ts";

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

// The real function, not a copy of it: the copy that used to live here kept passing while
// the crawler's own pattern missed every Magento locale.

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

// Buccellati is Magento: /it_it/, /fr_fr/, /en_row/, and a slug translated per locale, so the
// same bracelet is two different paths. Its knowledge base came out 528 Italian pages, 202
// French and 56 English, with the boilerplate filter learned from the French ones.
describe("Magento locales", () => {
  const b = (p: string) => `https://www.buccellati.com/${p}`;

  it("recognises underscore locales and three-letter regions", () => {
    const out = preferCanonicalLocale([b("it_it/maison.html"), b("en_row/maison.html"), b("fr_fr/maison.html")]);
    expect(out).toEqual([b("en_row/maison.html")]);
  });

  it("keeps one language when the slugs are translated", () => {
    const urls = [
      b("it_it/cuff-4-0-bracciale-jaubra012713.html"), b("it_it/anello-cocktail-jaurin008275.html"),
      b("fr_fr/bracelet-cuff-4-0-jaubra012713.html"), b("fr_fr/bague-coloured-cocktail-jaurin008275.html"),
      b("en_row/cuff-4-0-bracelet-jaubra012713.html"), b("en_us/cocktail-ring-jaurin008275.html"),
    ];
    const out = preferCanonicalLocale(urls);
    expect(out.every((u) => /\/en_(row|us)\//.test(u))).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("falls back to the biggest language when English is a stub", () => {
    const urls = [
      ...Array.from({ length: 10 }, (_, i) => b(`it_it/pezzo-${i}.html`)),
      ...Array.from({ length: 3 }, (_, i) => b(`fr_fr/piece-${i}.html`)),
      b("en_row/privacy.html"),
    ];
    const out = preferCanonicalLocale(urls);
    expect(out).toHaveLength(10);
    expect(out.every((u) => u.includes("/it_it/"))).toBe(true);
  });

  it("never drops unprefixed pages or a two-letter section that is not a language", () => {
    const urls = [b("it_it/a.html"), b("fr_fr/b.html"), b("maison.html"), b("go/boutiques.html")];
    const out = preferCanonicalLocale(urls);
    expect(out).toContain(b("maison.html"));
    expect(out).toContain(b("go/boutiques.html"));
    expect(out).toHaveLength(3);
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

describe("englishSitemapsFirst", () => {
  it("reads a house's English market sitemaps before the one it lists first", () => {
    // Buccellati's robots.txt: Italian first, every sitemap the whole site.
    const sm = (l: string) => `https://www.buccellati.com/media/sitemap/sitemap_${l}.xml`;
    const out = englishSitemapsFirst([sm("it_it"), sm("fr_fr"), sm("en_us"), sm("jp_jp"), sm("en_row"), "https://www.buccellati.com/sitemap.xml"]);
    expect(out).toEqual([sm("en_us"), sm("en_row"), sm("it_it"), sm("fr_fr"), sm("jp_jp"), "https://www.buccellati.com/sitemap.xml"]);
  });

  it("knows a market in the path, and leaves unmarked sitemaps alone", () => {
    expect(englishSitemapsFirst(["https://x.com/it-it/sitemap.xml", "https://x.com/en-gb/sitemap.xml"]))
      .toEqual(["https://x.com/en-gb/sitemap.xml", "https://x.com/it-it/sitemap.xml"]);
    // "sitemap_pages.xml" is not a market, nor is a host that happens to contain "en-".
    const plain = ["https://en-shop.com/sitemap_pages.xml", "https://en-shop.com/sitemap_products.xml"];
    expect(englishSitemapsFirst(plain)).toEqual(plain);
  });
});

describe("preferCanonicalLocale — which English market", () => {
  it("prefers the international English market, then US, then UK, over any other English market", () => {
    const b = (l: string) => `https://www.buccellati.com/${l}/caviar-set.html`;
    expect(preferCanonicalLocale([b("en_be"), b("en_us"), b("en_gb")])).toEqual([b("en_us")]);
    expect(preferCanonicalLocale([b("en_be"), b("en_us"), b("en_row")])).toEqual([b("en_row")]);
    expect(preferCanonicalLocale([b("en_be"), b("en_gb")])).toEqual([b("en_gb")]);
    expect(preferCanonicalLocale([b("en_be"), b("en_ae")])).toEqual([b("en_ae")]);
  });
});
