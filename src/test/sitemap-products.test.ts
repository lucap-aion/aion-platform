import { describe, it, expect } from "vitest";
import {
  productsFromSitemap, nameFromSlug, categoryFromSlug,
} from "../../supabase/functions/_shared/sitemap-products.ts";

// The last resort for a house we cannot read a single page of. damiani.com answers 403 to
// every plain request and hands the renderer a Cloudflare interstitial — but the sitemap it
// does serve carries both its product URLs and its packshots, and both carry the item code.

const P = (s: string) => `https://www.damiani.com/it_it/${s}`;
const IMG = (f: string) => `https://www.damiani.com/media/catalog/product/2/0/${f}?optimize=high&width=2000`;

describe("reading a name off a slug", () => {
  it("drops the item code and the variant letter that trails it", () => {
    expect(nameFromSlug("white-gold-and-diamonds-necklace-20059783")).toBe("White gold and diamonds necklace");
    expect(nameFromSlug("bypass-ring-in-white-gold-and-diamonds-20078486-c")).toBe("Bypass ring in white gold and diamonds");
  });

  it("reads as a sentence, not a spreadsheet header", () => {
    // Title Case on a descriptive slug looks like a database dump on a client's slide.
    expect(nameFromSlug("cappuccino-ceramic-pink-gold-and-diamond-earrings-20072392"))
      .toBe("Cappuccino ceramic pink gold and diamond earrings");
  });

  it("keeps a year, which is part of a name and not a code", () => {
    expect(nameFromSlug("anniversary-2024-collection-ring-20059783")).toBe("Anniversary 2024 collection ring");
  });
});

describe("the category a slug names", () => {
  it("uses the plural form the rest of the catalogue already speaks in", () => {
    expect(categoryFromSlug("white-gold-and-diamonds-necklace-20059783")).toBe("necklaces");
    expect(categoryFromSlug("bypass-ring-in-white-gold-20078486")).toBe("rings");
    expect(categoryFromSlug("black-ceramic-and-diamonds-earrings-20089711")).toBe("earrings");
    expect(categoryFromSlug("bracelet-with-heart-charm-20059821")).toBe("bracelets");
  });

  it("reads the Italian and French a house writes its own slugs in", () => {
    expect(categoryFromSlug("anello-belle-epoque-20059783")).toBe("rings");
    expect(categoryFromSlug("collana-margherita-20059784")).toBe("necklaces");
    expect(categoryFromSlug("bague-move-05337-pg")).toBe("rings");
  });

  it("says nothing rather than guessing", () => {
    expect(categoryFromSlug("belle-epoque-20059783")).toBe(null);
  });
});

describe("building a catalogue from a sitemap alone", () => {
  it("joins packshots to pieces on the item code both carry", () => {
    const out = productsFromSitemap({
      pages: [P("white-gold-and-diamonds-earrings-20061332"), P("bracelet-with-heart-charm-and-diamond-20059821")],
      images: [IMG("20061332_1.jpg"), IMG("20061332_2.jpg"), IMG("20059821_1.jpg"), IMG("99999999_1.jpg")],
    });
    expect(out).toHaveLength(2);
    const earrings = out.find((p) => p.sku === "20061332")!;
    expect(earrings.name).toBe("White gold and diamonds earrings");
    expect(earrings.category).toBe("earrings");
    expect(earrings.images).toHaveLength(2);
    expect(earrings.imageUrl).toContain("20061332_1.jpg");
    // An image whose code matches no page is somebody else's picture.
    expect(JSON.stringify(out)).not.toContain("99999999");
  });

  it("matches a variant suffix on either side", () => {
    // The page says "-20073459-c" and the file says "20073459_c_1.jpg".
    const out = productsFromSitemap({
      pages: [P("white-gold-diamonds-and-rubies-necklace-20073459-c")],
      images: [IMG("20073459_c_1.jpg")],
    });
    expect(out[0].imageUrl).toContain("20073459_c_1.jpg");
  });

  it("keeps a piece with no picture rather than losing it", () => {
    const out = productsFromSitemap({ pages: [P("solitaire-ring-20059999")], images: [] });
    expect(out).toHaveLength(1);
    expect(out[0].imageUrl).toBe(null);
  });

  it("refuses editorial, store locators and terms, whatever digits they carry", () => {
    const out = productsFromSitemap({
      pages: [
        P("storelocator/rocca-1794-bologna"),
        "https://www.damiani.com/it_it/cgv-barcelona-2021-es",
        P("news/anniversary-20059783"),
        P("solitaire-ring-20059999"),
      ],
      images: [],
    });
    expect(out.map((p) => p.sku)).toEqual(["20059999"]);
  });

  it("ignores a slug that is nothing but its own code", () => {
    // Nothing a person could read on a slide.
    expect(productsFromSitemap({ pages: [P("20059783")], images: [] })).toEqual([]);
  });

  it("is deterministic, because a cursor is kept against this list", () => {
    const input = {
      pages: [P("b-ring-20000002"), P("a-ring-20000001")],
      images: [IMG("20000001_1.jpg")],
    };
    const a = productsFromSitemap(input);
    expect(a.map((p) => p.sku)).toEqual(["20000001", "20000002"]);
    expect(productsFromSitemap(input)).toEqual(a);
  });

  it("prefers the shorter URL when a code appears in two paths", () => {
    const out = productsFromSitemap({
      pages: [P("collections/belle-epoque/white-gold-ring-20059783"), P("white-gold-ring-20059783")],
      images: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].productUrl).toBe(P("white-gold-ring-20059783"));
  });

  it("survives an empty sitemap and a malformed url", () => {
    expect(productsFromSitemap({ pages: [], images: [] })).toEqual([]);
    expect(() => productsFromSitemap({ pages: ["not a url"], images: ["also not"] })).not.toThrow();
  });
});

describe("one row per piece, whatever the slug carries", () => {
  it("emits a single product when a slug carries two item codes", () => {
    // Postgres refuses a batch that names the same conflict target twice — "ON CONFLICT DO
    // UPDATE command cannot affect row a second time" — and rejects ALL of it. A catalogue
    // that had been read perfectly well was therefore stored as nothing at all.
    const out = productsFromSitemap({
      pages: [P("earrings-set-20061332-20061333")],
      images: [IMG("20061332_1.jpg"), IMG("20061333_1.jpg")],
    });
    expect(out).toHaveLength(1);
    expect(out[0].handle).toBe("earrings-set-20061332-20061333");
    // Both codes' pictures belong to the one piece.
    expect(out[0].images).toHaveLength(2);
    expect(out[0].sku).toBe("20061332");
  });

  it("never returns the same handle twice, whatever it is given", () => {
    const out = productsFromSitemap({
      pages: [P("a-ring-20000001-20000002"), P("b-ring-20000003"), P("c-set-20000004-20000005-20000006")],
      images: [],
    });
    const handles = out.map((p) => p.handle);
    expect(new Set(handles).size).toBe(handles.length);
  });
});

describe("houses that are not jewellers", () => {
  it("reads the categories a leather and fragrance house actually sells", () => {
    // Ferragamo's catalogue is eyewear, leather and fragrance. A vocabulary of rings and
    // necklaces left three quarters of it uncategorised — and an uncategorised piece is
    // costed at zero on every sale.
    const cases: [string, string][] = [
      ["Hug handbag (M)", "bags"],
      ["Varina charm", "charms"],
      ["Ferragamo Intense Leather - EDP 3.4 fl. Oz.", "fragrance"],
      ["Signorina Romantica - EDT", "fragrance"],
      ["Gancini belt", "belts"],
      ["Silk foulard", "scarves"],
      ["Vara bow pumps", "shoes"],
      ["Wallet with Gancini", "wallets"],
      ["Aviator sunglasses", "eyewear"],
    ];
    for (const [name, expected] of cases) expect(categoryFromSlug(name), name).toBe(expected);
  });

  it("does not let a compound word steal a category", () => {
    // "handbag" is a bag; "bagatelle" is not.
    expect(categoryFromSlug("Bagatelle collection")).toBe(null);
    expect(categoryFromSlug("Ringo pendant")).toBe("pendants");
  });
});
