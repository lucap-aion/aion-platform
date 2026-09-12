import { describe, it, expect } from "vitest";
import {
  productUrlScore, rankCatalogueUrls, hasItemCode, localeOf, preferredLocale, inLocale,
} from "../../supabase/functions/_shared/catalogue-urls.ts";

// Which of a site's pages to read first when looking for a catalogue. A run reads a handful,
// so this ordering decides whether the first batch returns sixty products or none.

describe("ranking a site's URLs", () => {
  it("puts an item code above everything", () => {
    // Ferragamo's product pages carry the whole record — "@type":"Product", price,
    // currency, availability. Its CATEGORY pages carry a breadcrumb and nothing else,
    // because the grid arrives from a later client-side call no renderer waits for.
    expect(productUrlScore("https://www.ferragamo.com/shop/us/en/handbags/hug-sh-ew-798503"))
      .toBeGreaterThan(productUrlScore("https://www.ferragamo.com/shop/us/en/women/handbags"));
    expect(productUrlScore("https://www.ferragamo.com/shop/us/en/new-arrivals-woman/yasmin-95-797084")).toBe(5);
  });

  it("still recognises a path that names itself a product", () => {
    expect(productUrlScore("https://brand.com/products/silk-scarf")).toBe(4);
    expect(productUrlScore("https://brand.com/item/tote")).toBe(4);
  });

  it("ranks a listing below an item and above an unknown", () => {
    const listing = productUrlScore("https://brand.com/collections/bags");
    expect(listing).toBeLessThan(productUrlScore("https://brand.com/products/a-bag"));
    expect(listing).toBeGreaterThan(productUrlScore("https://brand.com/en/gb/something"));
  });

  it("sinks editorial, which shares the shop's own prefix", () => {
    // "/shop/us/en/sf/stories" was scoring as a listing and being read before real products.
    expect(productUrlScore("https://www.ferragamo.com/shop/us/en/sf/stories")).toBe(0);
    expect(productUrlScore("https://brand.com/shop/faq")).toBe(0);
  });

  it("does not treat a whole site living under /shop/ as one big listing", () => {
    // The old rule matched /shop/ anywhere and gave every Ferragamo URL the same score, so
    // they sorted alphabetically and the first five had no products on them.
    const scores = [
      "https://www.ferragamo.com/shop/us/en/women/handbags",
      "https://www.ferragamo.com/shop/us/en/handbags/hug-sh-ew-798503",
      "https://www.ferragamo.com/shop/us/en/sf/stories",
    ].map(productUrlScore);
    expect(new Set(scores).size).toBe(3);
  });

  it("orders stably, because a cursor indexes into the result", () => {
    // The caller reads a window of this list and stores where it stopped. A list that
    // reshuffles between runs would re-read the same pages for ever.
    const urls = [
      "https://b.com/shop/en/a-item-100200",
      "https://b.com/shop/en/b-item-100100",
      "https://b.com/collections/bags",
      "https://b.com/shop/en/sf/stories",
    ];
    const once = rankCatalogueUrls(urls);
    expect(rankCatalogueUrls([...urls].reverse())).toEqual(once);
    expect(once[0]).toBe("https://b.com/shop/en/a-item-100200");
    expect(once[once.length - 1]).toBe("https://b.com/collections/bags");
  });

  it("drops the pages that can never carry a product, rather than ranking them last", () => {
    // Ranked last, editorial still cost a renderer call each at the end of every pass and
    // padded the "pages remaining" the panel reports with pages nothing could be read from.
    expect(rankCatalogueUrls([
      "https://b.com/shop/en/a-item-100200",
      "https://b.com/shop/en/sf/stories",
      "https://b.com/shop/en/sf/faq",
      "https://b.com/legal/privacy",
    ])).toEqual(["https://b.com/shop/en/a-item-100200"]);
  });

  it("drops duplicates", () => {
    expect(rankCatalogueUrls(["https://b.com/a", "https://b.com/a"])).toHaveLength(1);
  });
});

// ── Item codes that are not preceded by a hyphen ─────────────────────────────────────────
describe("a reference run together with letters", () => {
  it("recognises Pomellato's product slugs", () => {
    // Every one of these publishes a complete Product record — name, image, sku, price,
    // currency, availability — and every one scored 2, the same as a press release. Among
    // four hundred pages read twelve at a time, the catalogue was never reached: Pomellato
    // read as a house with no products, and lost its intro deck and its demo book for it.
    expect(productUrlScore("https://www.pomellato.com/gb_en/nudo-classic-ring-pab9040-o6bkr-zaltl")).toBe(5);
    expect(productUrlScore("https://www.pomellato.com/gb_en/iconica-large-ring-pa9106d-o7000-db000")).toBe(5);
  });

  it("reads a code in front of a file extension", () => {
    expect(productUrlScore("https://www.cartier.com/en-gb/jewellery/rings/love-ring-b4084600.html")).toBe(5);
  });

  it("wants three digits, so a two-digit word is not a reference", () => {
    expect(hasItemCode("nudo-classic-ring-pab9040")).toBe(true);
    expect(hasItemCode("jauring014744")).toBe(true);
    expect(hasItemCode("the-chain-revolution")).toBe(false);
    expect(hasItemCode("ring-size-guide")).toBe(false);
  });

  it("still sinks the service pages these sites keep beside the shop", () => {
    for (const url of [
      "https://www.pomellato.com/ae_en/terms-and-conditions-of-sale",
      "https://www.pomellato.com/ae_en/client-service",
      "https://www.pomellato.com/ae_en/care-and-repairing",
      "https://www.pomellato.com/ae_en/store-locator",
    ]) expect(productUrlScore(url)).toBe(0);
  });
});

// ── One locale ───────────────────────────────────────────────────────────────────────────
describe("choosing the locale to read a catalogue from", () => {
  it("reads the locale out of the three shapes these sites use", () => {
    expect(localeOf("https://www.pomellato.com/ae_en/nudo-ring-pab9040-o6bkr")).toBe("ae_en");
    expect(localeOf("https://www.ferragamo.com/shop/us/en/women/handbags/hug-789712")).toBe("us/en");
    expect(localeOf("https://www.cartier.com/en-gb/jewellery/love-ring-b4084600.html")).toBe("en-gb");
    expect(localeOf("https://brand.com/products/a-bag")).toBe(null);
  });

  it("prefers a eurozone market, because every quote and business case is in euros", () => {
    const urls = [
      "https://www.pomellato.com/ae_en/nudo-ring-pab9040-o6bkr-zaltl",
      "https://www.pomellato.com/ae_en/sabbia-ring-pab4070-o7000-db000",
      "https://www.pomellato.com/ae_en/catene-ring-pac3011-o7000-db000",
      "https://www.pomellato.com/va_it/anello-sabbia-pab9032-o7000-dbr00",
    ];
    // The Emirates locale has three pages to the Italian one's one, and is still not it.
    expect(preferredLocale(urls)).toBe("va_it");
  });

  it("falls back to the locale the site publishes most of", () => {
    expect(preferredLocale([
      "https://www.ferragamo.com/shop/us/en/women/handbags/hug-789712",
      "https://www.ferragamo.com/shop/us/en/men/totes-m/hug-777378",
      "https://www.ferragamo.com/shop/jp/ja/women/handbags/hug-789713",
    ])).toBe("us/en");
  });

  it("counts only pages that look like products", () => {
    // A locale present in the crawl as nothing but a homepage is not where the catalogue is.
    expect(preferredLocale([
      "https://b.com/de_de",
      "https://b.com/gb_en/a-ring-ab1234-x",
      "https://b.com/gb_en/b-ring-ab1235-x",
    ])).toBe("gb_en");
  });

  it("does not narrow to a locale that leaves nothing to read", () => {
    const urls = [
      "https://b.com/it_it/a-ring-ab1234-x",
      "https://b.com/gb_en/b-ring-ab1235-x",
      "https://b.com/gb_en/c-ring-ab1236-x",
    ];
    // it_it wins on preference but holds one page; reading one page a run is worse than
    // reading three in two currencies, so the filter stands down.
    expect(inLocale(urls, "it_it")).toEqual(urls);
    expect(inLocale(urls, "gb_en", 2)).toEqual([
      "https://b.com/gb_en/b-ring-ab1235-x",
      "https://b.com/gb_en/c-ring-ab1236-x",
    ]);
  });

  it("leaves a single-market site alone", () => {
    const urls = ["https://b.com/products/a-bag", "https://b.com/products/b-bag"];
    expect(preferredLocale(urls)).toBe(null);
    expect(inLocale(urls, null)).toEqual(urls);
  });
});
