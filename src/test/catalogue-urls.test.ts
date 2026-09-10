import { describe, it, expect } from "vitest";
import { productUrlScore, rankCatalogueUrls } from "../../supabase/functions/_shared/catalogue-urls.ts";

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
    expect(once[once.length - 1]).toBe("https://b.com/shop/en/sf/stories");
  });

  it("drops duplicates", () => {
    expect(rankCatalogueUrls(["https://b.com/a", "https://b.com/a"])).toHaveLength(1);
  });
});
