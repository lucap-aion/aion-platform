// ==============================|| WHICH PAGE CARRIES THE CATALOGUE ||============================== //
// Ordering a site's crawled URLs by how likely each is to yield products.
//
// It matters because a run reads a handful of pages, not the whole site: the ordering
// decides whether the first batch returns sixty products or none.
//
// The rule used to be "a path that says collection/shop/category carries many products, a
// path that says product carries one, so try the listings first". That is right for a
// Shopify store and exactly wrong for the houses this code exists for. Ferragamo's whole
// site lives under /shop/, so every URL scored as a listing and they sorted alphabetically;
// the first five were category pages, and Ferragamo's category pages publish a breadcrumb
// and nothing else — the product grid arrives from a later client-side call that no
// renderer waits for. Meanwhile its PRODUCT pages carry the lot:
//
//   "@type":"Product" … "price":"2500.00" … "priceCurrency":"USD" … "availability":"InStock"
//
// So an item code in the path is the strongest signal there is, and it is the one the old
// rule ranked LAST. A run of five category pages returned zero products from a site with a
// full catalogue, which is what "it doesn't scrape the products despite being there" was.

/**
 * Higher is more likely to carry product data.
 *
 * Deliberately ordered for sites that are NOT Shopify — a Shopify store never reaches this,
 * because its feed is taken whole from /products.json.
 */
export function productUrlScore(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";

  // Editorial lives under the same prefix as the shop on these sites and never has a price
  // in it. Worth actively ranking below everything else rather than merely not boosting.
  if (/\/(stories|news|journal|about|world|heritage|magazine|faq|help|customer|legal|privacy)(\/|$)/.test(path)) {
    return 0;
  }

  // An item code — "hug-sh-ew-798503", "yasmin-95-797084". One page, one product, and the
  // product's full structured data.
  if (/\d{4,}$/.test(last) || /-\d{4,}(-|$)/.test(last)) return 5;

  // A path that names itself a product.
  if (/\/(products?|item|pd|dp)\//.test(path)) return 4;

  // A listing. Rich on a site that renders server-side, empty on one that does not, so it
  // sits above the unknowns and below anything that looks like an actual item.
  if (/\/(collections?|category|categories|catalog(ue)?)\//.test(path)) return 3;

  return 2;
}

/**
 * Crawled URLs, best first, stable.
 *
 * The tie-break is not decoration: the caller reads a window of this list and stores an
 * index into it, so a list that reshuffles between runs makes that cursor meaningless.
 */
export function rankCatalogueUrls(urls: string[]): string[] {
  return [...new Set(urls)]
    // Score 0 is not "unlikely to carry a product", it is "never": a FAQ, a privacy notice
    // and a heritage story publish no Product data on any site. Ranking them last still
    // cost a renderer call each at the end of every pass, and — worse — padded the
    // "pages remaining" the panel reports with pages the run could learn nothing from.
    .filter((u) => productUrlScore(u) > 0)
    .sort((a, b) => productUrlScore(b) - productUrlScore(a) || a.localeCompare(b));
}
