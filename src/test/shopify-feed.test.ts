import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The shipped module, not a copy of it — the sync imports this exact file.
import { mapShopifyProducts, type RawShopifyProduct } from "../../supabase/functions/_shared/shopify-feed";

// A real Luisa Beccaria feed, trimmed to six products. Recorded rather than
// invented: every assumption below is one the live shop actually satisfies.
const feed = JSON.parse(
  readFileSync(join(__dirname, "fixtures/luisa-beccaria-products.json"), "utf8"),
) as { products: RawShopifyProduct[] };

describe("reading sizes out of a Shopify feed", () => {
  it("keeps every size, with its own price and its own availability", () => {
    const products = mapShopifyProducts(feed.products, true);
    const blouse = products.find((p) => p.name === "Cotton blouse with printed roses");
    expect(blouse).toBeTruthy();

    // The case the product-level flag destroys: this blouse is in stock in 42
    // and 46 and sold out in 38, 40 and 44. Flattened, it is just "available".
    const inStock = blouse!.variants.filter((v) => v.available).map((v) => v.title);
    const soldOut = blouse!.variants.filter((v) => !v.available).map((v) => v.title);
    expect(inStock).toEqual(["42", "46"]);
    expect(soldOut).toEqual(["38", "40", "44"]);

    // A sold-out size still carries a price worth quoting.
    for (const v of blouse!.variants) expect(v.price).toBe(798);
    expect(blouse!.optionName).toBe("Size");
  });

  it("carries sizes that aren't numbers", () => {
    const belt = mapShopifyProducts(feed.products, true).find((p) => p.name.includes("Belt"));
    expect(belt!.variants.map((v) => v.title)).toEqual(["S", "M", "L"]);
  });

  it("still only quotes a product price when the piece is purchasable", () => {
    const products = mapShopifyProducts(feed.products, true);
    for (const p of products) {
      if (!p.available) expect(p.price).toBeNull();
      else expect(p.price).toBeGreaterThan(0);
    }
  });

  it("drops Shopify's placeholder variant on a product with no real options", () => {
    const single: RawShopifyProduct[] = [{
      handle: "scarf", title: "Silk Scarf", product_type: "Accessories",
      options: [{ name: "Title" }],
      variants: [{ id: 1, title: "Default Title", price: "180.00", available: true, position: 1 }],
      images: [{ src: "https://cdn.shopify.com/x.jpg" }],
    }];
    const [p] = mapShopifyProducts(single);
    // "Default Title" is not a size and must never be shown as one.
    expect(p.variants).toEqual([]);
    expect(p.optionName).toBeNull();
    expect(p.price).toBe(180);
  });

  it("honours keep_untyped, which is why this shop has a catalogue at all", () => {
    // Luisa Beccaria ships real products with an empty product_type. Without the
    // flag the skip list eats the entire range.
    expect(mapShopifyProducts(feed.products, false)).toHaveLength(0);
    expect(mapShopifyProducts(feed.products, true).length).toBe(feed.products.length);
  });
});
