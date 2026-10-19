import { describe, it, expect } from "vitest";
import { parseProductFeed, parseFeedPrice, splitDelimited } from "../../supabase/functions/_shared/product-feed.ts";

// Almost every brand that sells online already publishes a product feed. It is the same
// catalogue, maintained by them, in a format built to be read — and the honest answer to a
// site we cannot read, because a firewall refusing us is not the house refusing us.

describe("a price, however the house writes it", () => {
  it("reads the plain forms", () => {
    expect(parseFeedPrice("12.00 EUR")).toEqual({ amount: 12, currency: "EUR" });
    expect(parseFeedPrice("EUR 1550")).toEqual({ amount: 1550, currency: "EUR" });
    expect(parseFeedPrice("1550")).toEqual({ amount: 1550, currency: null });
  });

  it("decides the decimal separator by which comes LAST, not by which it is", () => {
    // Assuming a dot is always decimal turns €1.234 into €1.23 on a German feed — an error
    // that ends up in a covered value.
    expect(parseFeedPrice("1.234,56 EUR").amount).toBe(1234.56);
    expect(parseFeedPrice("1,234.56 USD").amount).toBe(1234.56);
    expect(parseFeedPrice("1.234 EUR").amount).toBe(1234);
    expect(parseFeedPrice("1,234 EUR").amount).toBe(1234);
  });

  it("reads the symbol when there is no code", () => {
    expect(parseFeedPrice("€1.550,00")).toEqual({ amount: 1550, currency: "EUR" });
    expect(parseFeedPrice("£950.50")).toEqual({ amount: 950.5, currency: "GBP" });
    expect(parseFeedPrice("$1,234.56")).toEqual({ amount: 1234.56, currency: "USD" });
  });

  it("says nothing rather than zero for a price it cannot read", () => {
    // Zero is a value. Null is the absence of one, and they must not be confused in a
    // catalogue that prices insurance.
    expect(parseFeedPrice("price on request")).toEqual({ amount: null, currency: null });
    expect(parseFeedPrice("")).toEqual({ amount: null, currency: null });
  });
});

describe("Google Merchant RSS, which is what most houses publish", () => {
  const feed = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
  <title>Brand feed</title>
  <item>
    <g:id>05337-PG</g:id>
    <title><![CDATA[Joy brilliant-cut bracelet]]></title>
    <description>Pink gold &amp; diamonds</description>
    <link>https://brand.com/en/joy-xs-05337-pg</link>
    <g:image_link>https://brand.com/media/05337.jpg</g:image_link>
    <g:price>1550.00 EUR</g:price>
    <g:availability>in stock</g:availability>
    <g:product_type>Jewellery &gt; Bracelets</g:product_type>
  </item>
  <item>
    <g:id>05338-PG</g:id><title>Move ring</title>
    <link>https://brand.com/en/move-05338-pg</link>
    <g:price>2400.00 EUR</g:price><g:sale_price>1900.00 EUR</g:sale_price>
    <g:availability>out of stock</g:availability>
  </item>
</channel></rss>`;

  it("reads the pieces, their prices and their pictures", () => {
    const out = parseProductFeed(feed);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      sku: "05337-PG",
      name: "Joy brilliant-cut bracelet",
      price: 1550,
      currency: "EUR",
      available: true,
      imageUrl: "https://brand.com/media/05337.jpg",
      productUrl: "https://brand.com/en/joy-xs-05337-pg",
    });
    expect(out[0].description).toBe("Pink gold & diamonds");
  });

  it("takes the leaf of a taxonomy path, not the whole path", () => {
    expect(parseProductFeed(feed)[0].category).toBe("Bracelets");
  });

  it("prefers a sale price, which is what the client is actually charged", () => {
    expect(parseProductFeed(feed)[1].price).toBe(1900);
  });

  it("records what is out of stock rather than dropping it", () => {
    expect(parseProductFeed(feed)[1].available).toBe(false);
  });

  it("reads the Atom spelling of the same thing", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">
      <entry><g:id>1</g:id><title>Ring</title><link href="https://brand.com/ring-1"/>
      <g:price>900 EUR</g:price></entry></feed>`;
    const out = parseProductFeed(atom);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Ring", price: 900, productUrl: "https://brand.com/ring-1" });
  });

  it("returns one row per handle — a feed lists every variant separately", () => {
    // The catalogue is keyed on the handle, and a duplicate takes the whole batch down:
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const dupes = `<rss><channel>
      <item><g:id>X1</g:id><title>Ring</title><g:price>100 EUR</g:price></item>
      <item><g:id>X1</g:id><title>Ring</title><g:price>100 EUR</g:price></item>
    </channel></rss>`;
    expect(parseProductFeed(dupes)).toHaveLength(1);
  });
});

describe("the CSV the same spec defines", () => {
  it("reads it, tab or comma, and survives a comma inside a title", () => {
    const csv = [
      'id,title,link,image_link,price,availability,product_type',
      '"A1","Ring, brilliant cut","https://b.com/a1","https://b.com/a1.jpg","1.550,00 EUR","in stock","Jewellery > Rings"',
    ].join("\n");
    const out = parseProductFeed(csv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sku: "A1", name: "Ring, brilliant cut", price: 1550, currency: "EUR", category: "Rings",
    });
  });

  it("reads a tab-separated file, and a g: prefixed header", () => {
    const tsv = "g:id\tg:title\tg:price\nB2\tBracelet\t900 EUR";
    expect(parseProductFeed(tsv)[0]).toMatchObject({ sku: "B2", name: "Bracelet", price: 900 });
  });

  it("splits on quotes the way a spreadsheet wrote them", () => {
    expect(splitDelimited('a,"b,c","d""e"', ",")).toEqual(["a", "b,c", 'd"e']);
  });
});

describe("refusing what is not a feed", () => {
  it("returns nothing for an HTML page, a header alone, or an empty file", () => {
    expect(parseProductFeed("<html><body>Access denied</body></html>")).toEqual([]);
    expect(parseProductFeed("id,title,price")).toEqual([]);
    expect(parseProductFeed("")).toEqual([]);
  });

  it("decides by CONTENT, not by what the file is called", () => {
    // The same feed is served as text/plain, octet-stream and text/xml by different hosts.
    const csvInDisguise = "id,title,price\nA1,Ring,100 EUR";
    expect(parseProductFeed(csvInDisguise)).toHaveLength(1);
  });

  it("skips an item with no title rather than inventing one", () => {
    const feed = "<rss><channel><item><g:id>1</g:id><g:price>10 EUR</g:price></item></channel></rss>";
    expect(parseProductFeed(feed)).toEqual([]);
  });
});

describe("Shopify's Atom dialect, which is what a Shopify house publishes for free", () => {
  // Real shape, from pasqualebruni.com/collections/all.atom.
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:s="http://jadedpixel.com/-/spec/shopify">
    <entry>
      <id>https://b.com/products/10550123561307</id>
      <link rel="alternate" type="text/html" href="https://b.com/products/16906tr-accendimi-necklace"/>
      <title>ACCENDIMI NECKLACE</title>
      <s:type>Necklaces</s:type><s:vendor>Pasquale Bruni</s:vendor>
      <s:price currency="EUR">3450.00</s:price>
      <summary type="html"><![CDATA[<table><tr><td><img width="200" src="https://cdn.shopify.com/files/16906TR_1.png?v=1"></td></tr></table>]]></summary>
    </entry></feed>`;

  it("reads the category out of Shopify's spelling of the field", () => {
    expect(parseProductFeed(atom)[0].category).toBe("Necklaces");
  });

  it("takes the currency from the attribute, because that is where Shopify puts it", () => {
    expect(parseProductFeed(atom)[0]).toMatchObject({ price: 3450, currency: "EUR" });
  });

  it("finds the packshot inside the summary card, which is the only place it appears", () => {
    // No image field exists in this dialect at all. Without the fallback the feed furnishes
    // a spreadsheet rather than a deck.
    expect(parseProductFeed(atom)[0].imageUrl).toBe("https://cdn.shopify.com/files/16906TR_1.png?v=1");
  });

  it("uses the product link for the handle, so variants of one title stay distinct", () => {
    expect(parseProductFeed(atom)[0].handle).toBe("16906tr-accendimi-necklace");
  });
});

describe("the handle, which is the upsert key", () => {
  it("keeps a Google Merchant id, which is the house's own SKU", () => {
    const feed = `<rss><channel><item><g:id>05337-PG</g:id><title>Ring</title>
      <link>https://b.com/en/joy-xs-05337-pg</link></item></channel></rss>`;
    expect(parseProductFeed(feed)[0]).toMatchObject({ handle: "05337-pg", sku: "05337-PG" });
  });

  it("never stores a URL as a SKU", () => {
    const atom = `<feed><entry><id>https://b.com/products/1055012</id><title>Ring</title>
      <link rel="alternate" href="https://b.com/products/accendimi-necklace"/></entry></feed>`;
    expect(parseProductFeed(atom)[0].sku).toBe(null);
  });
});
