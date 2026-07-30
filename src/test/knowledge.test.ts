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
  return (query.match(/[\p{L}][\p{L}\p{N}'-]{3,}/gu) ?? [])
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
