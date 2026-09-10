import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The shipped module, not a copy of it. The other tests in this repo
// re-implement the logic they check, which means they pass while the real code
// rots; this imports what actually runs in the edge function.
import { extractProducts } from "../../supabase/functions/_shared/product-extract";

const fixture = readFileSync(join(__dirname, "fixtures/ferragamo-listing.html"), "utf8");
const BASE = "https://www.ferragamo.com/shop/us/en/women/shoes-1";

describe("a catalogue from a site that is not Shopify", () => {
  it("reads products off a real Ferragamo listing page", () => {
    const products = extractProducts(fixture, BASE);
    // The page 403s a plain fetch and has no products.json. Before this it was a
    // brand with no catalogue, and therefore no deck and no demo.
    expect(products.length).toBeGreaterThan(10);
  });

  it("gets everything storefront_products needs on each row", () => {
    const p = extractProducts(fixture, BASE).find((x) => x.price != null && x.image_url);
    expect(p).toBeTruthy();
    expect(p!.name.length).toBeGreaterThan(2);
    expect(p!.image_url).toMatch(/^https:\/\//);
    expect(p!.product_url).toMatch(/^https:\/\/www\.ferragamo\.com\//);
    expect(p!.price).toBeGreaterThan(0);
    expect(p!.price_currency).toBe("USD");
  });

  it("collapses the colourways a listing page repeats", () => {
    const products = extractProducts(fixture, BASE);
    const urls = products.map((p) => p.product_url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("the shapes different sites publish", () => {
  const ld = (obj: unknown) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;

  it("takes a bare Product", () => {
    const out = extractProducts(ld({
      "@type": "Product", name: "Luce ring", image: "/i/luce.jpg",
      offers: { price: "4200.00", priceCurrency: "eur", availability: "https://schema.org/InStock" },
    }), "https://brand.com/p/luce");
    expect(out).toHaveLength(1);
    expect(out[0].image_url).toBe("https://brand.com/i/luce.jpg"); // relative resolved
    expect(out[0].price).toBe(4200);
    expect(out[0].price_currency).toBe("EUR");
    expect(out[0].available).toBe(true);
  });

  it("walks an @graph, which is how many CMSes emit it", () => {
    const out = extractProducts(ld({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebPage" }, { "@type": "Product", name: "Bag", image: "https://b.com/b.jpg" }],
    }), "https://b.com");
    expect(out.map((p) => p.name)).toEqual(["Bag"]);
  });

  it("unwraps ListItem, which is what Ferragamo uses", () => {
    const out = extractProducts(ld({
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", item: { "@type": "Product", name: "A", image: "https://b.com/a.jpg" } },
        { "@type": "ListItem", item: { "@type": "Product", name: "B", image: "https://b.com/b.jpg" } },
      ],
    }), "https://b.com");
    expect(out.map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("survives one malformed block without losing the rest of the page", () => {
    const good = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Kept", image: "https://b.com/k.jpg" })}</script>`;
    const bad = `<script type="application/ld+json">{ "@type": "Product", name: 'unquoted', }</script>`;
    expect(extractProducts(`<html>${bad}${good}</html>`, "https://b.com").map((p) => p.name)).toEqual(["Kept"]);
  });

  it("falls back to og: tags on a product page with no JSON-LD", () => {
    const html = `<html><head>
      <meta property="og:type" content="product">
      <meta property="og:title" content="Giardini ring">
      <meta property="og:image" content="https://b.com/g.jpg">
      <meta property="product:price:amount" content="3.250,00">
      <meta property="product:price:currency" content="EUR"></head></html>`;
    const out = extractProducts(html, "https://b.com/p/g");
    expect(out).toHaveLength(1);
    // European decimals: 3.250,00 is three thousand two hundred and fifty.
    expect(out[0].price).toBe(3250);
  });

  it("does not invent a catalogue out of an ordinary page", () => {
    expect(extractProducts("<html><body><h1>About us</h1></body></html>", "https://b.com")).toEqual([]);
    expect(extractProducts(ld({ "@type": "Organization", name: "Brand" }), "https://b.com")).toEqual([]);
  });

  it("drops a row with neither a picture nor a price", () => {
    // The deck needs the image; the demo book needs the price. A name alone is
    // a row that makes the catalogue look fuller than it is.
    const out = extractProducts(ld({ "@type": "Product", name: "Mystery" }), "https://b.com");
    expect(out).toEqual([]);
  });
});
