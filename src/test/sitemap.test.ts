import { describe, it, expect, vi, afterEach } from "vitest";
import { collectSitemapUrls, collectSitemap, spreadAcrossSections } from "../../supabase/functions/_shared/crawl.ts";

// A sitemap is the canonical list of every page a site wants found. It is the best source of
// product URLs on a house with no product feed, and it was read with a plain fetch and
// nothing behind it — so it yielded nothing on exactly the sites that need it most.

const ORIGIN = new URL("https://www.example.com");

const xmlOf = (urls: string[]) =>
  `<?xml version="1.0"?><urlset>${urls.map((u) => `<loc>${u}</loc>`).join("")}</urlset>`;
const indexOf = (maps: string[]) =>
  `<?xml version="1.0"?><sitemapindex>${maps.map((u) => `<loc>${u}</loc>`).join("")}</sitemapindex>`;

const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
const blocked = () => new Response("<html>Access denied</html>", { status: 403 });

/** A site that answers some paths and refuses the rest. */
function site(routes: Record<string, () => Response>, onRender?: (url: string) => Response) {
  return vi.fn((input: string | URL) => {
    const url = String(input);
    if (url.startsWith("https://r.jina.ai/")) {
      const target = url.slice("https://r.jina.ai/".length);
      return Promise.resolve(onRender ? onRender(target) : blocked());
    }
    const hit = routes[url];
    return Promise.resolve(hit ? hit() : new Response("not found", { status: 404 }));
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("reading a sitemap the ordinary way", () => {
  it("takes the sitemaps robots.txt names", async () => {
    vi.stubGlobal("fetch", site({
      "https://www.example.com/robots.txt": () => ok("User-agent: *\nSitemap: https://www.example.com/it.xml\n"),
      "https://www.example.com/it.xml": () => ok(xmlOf([
        "https://www.example.com/it/ring-20059822",
        "https://www.example.com/it/bracelet-20059821",
      ])),
    }));
    const urls = await collectSitemapUrls(ORIGIN);
    expect(urls).toEqual([
      "https://www.example.com/it/ring-20059822",
      "https://www.example.com/it/bracelet-20059821",
    ]);
  });

  it("falls back to /sitemap.xml when robots.txt names none", async () => {
    vi.stubGlobal("fetch", site({
      "https://www.example.com/robots.txt": () => ok("User-agent: *\nDisallow: /checkout/\n"),
      "https://www.example.com/sitemap.xml": () => ok(xmlOf(["https://www.example.com/a"])),
    }));
    expect(await collectSitemapUrls(ORIGIN)).toEqual(["https://www.example.com/a"]);
  });

  it("follows an index down to the sitemaps it lists", async () => {
    vi.stubGlobal("fetch", site({
      "https://www.example.com/robots.txt": () => ok(""),
      "https://www.example.com/sitemap.xml": () => ok(indexOf([
        "https://www.example.com/pages.xml", "https://www.example.com/sitemap-products-1.xml",
      ])),
      "https://www.example.com/pages.xml": () => ok(xmlOf(["https://www.example.com/returns"])),
      "https://www.example.com/sitemap-products-1.xml": () => ok(xmlOf(["https://www.example.com/ring-1"])),
    }));
    const urls = await collectSitemapUrls(ORIGIN);
    expect(urls).toContain("https://www.example.com/returns");
    expect(urls).toContain("https://www.example.com/ring-1");
    // Informational first, so a large catalogue cannot exhaust the cap before the policy
    // pages are reached.
    expect(urls.indexOf("https://www.example.com/returns")).toBeLessThan(urls.indexOf("https://www.example.com/ring-1"));
  });

  it("stops at the url cap", async () => {
    vi.stubGlobal("fetch", site({
      "https://www.example.com/robots.txt": () => ok(""),
      "https://www.example.com/sitemap.xml": () => ok(xmlOf(
        Array.from({ length: 50 }, (_, i) => `https://www.example.com/p${i}`),
      )),
    }));
    expect(await collectSitemapUrls(ORIGIN, 10)).toHaveLength(10);
  });
});

describe("a house that refuses plain requests", () => {
  // damiani.com answers 403 to everything. The sitemap fetch threw, the loop swallowed it,
  // and the crawl fell back to following links — 643 product pages sat in that sitemap while
  // the queue filled with store-locator entries and the house was recorded as having none.
  const ROBOTS_ONLY = {
    "https://www.example.com/robots.txt": () => ok(
      "User-agent: *\nSitemap: https://www.example.com/media/sitemap/sitemap_it.xml\n" +
      "Sitemap: https://www.example.com/media/sitemap/sitemap_en.xml\n",
    ),
  };
  // What a renderer hands back: the tags are gone, the URLs are not.
  const rendered = (urls: string[]) => ok(`sitemap ${urls.join(" \n ")} end`);

  it("pays for one render when the cheap pass found nothing", async () => {
    const fetchSpy = site(ROBOTS_ONLY, (target) =>
      target === "https://www.example.com/media/sitemap/sitemap_it.xml"
        ? rendered(["https://www.example.com/it_it/ring-20059822", "https://www.example.com/it_it/anelli"])
        : blocked());
    vi.stubGlobal("fetch", fetchSpy);

    const urls = await collectSitemapUrls(ORIGIN, 3000, 24, "jina-key");
    expect(urls).toEqual([
      "https://www.example.com/it_it/ring-20059822",
      "https://www.example.com/it_it/anelli",
    ]);
    // Exactly one render: they cost 30–60s each, and the first one gave up the catalogue.
    const renders = fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith("https://r.jina.ai/"));
    expect(renders).toHaveLength(1);
    // And it is the sitemap the site itself named first — its primary market.
    expect(String(renders[0][0])).toContain("sitemap_it.xml");
  });

  it("still renders when no key is configured, because the renderer answers without one", async () => {
    // It used to require a key and give up silently without one, which reports a missing
    // piece of OUR configuration as "this house publishes no catalogue".
    const fetchSpy = site(ROBOTS_ONLY, () => rendered(["https://www.example.com/it_it/ring-1"]));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await collectSitemapUrls(ORIGIN)).toEqual(["https://www.example.com/it_it/ring-1"]);
    const renders = fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith("https://r.jina.ai/"));
    expect(renders).toHaveLength(1);
    expect((renders[0][1] as RequestInit | undefined)?.headers).not.toHaveProperty("Authorization");
  });

  it("says WHY the renderer produced nothing, instead of implying the site has no catalogue", async () => {
    vi.stubGlobal("fetch", site(ROBOTS_ONLY, () => new Response("", { status: 429 })));
    const out = await collectSitemap(ORIGIN, 3000, 24, "a-key");
    expect(out.pages).toEqual([]);
    expect(out.rendererError).toContain("429");
  });

  it("does not render when the cheap pass already worked", async () => {
    const fetchSpy = site({
      ...ROBOTS_ONLY,
      "https://www.example.com/media/sitemap/sitemap_it.xml": () => ok(xmlOf(["https://www.example.com/a"])),
    }, () => rendered(["https://www.example.com/should-not-be-used"]));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await collectSitemapUrls(ORIGIN, 3000, 24, "jina-key")).toEqual(["https://www.example.com/a"]);
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith("https://r.jina.ai/"))).toHaveLength(0);
  });

  it("drops other sitemaps out of a rendered result rather than listing them as pages", async () => {
    vi.stubGlobal("fetch", site(ROBOTS_ONLY, () => rendered([
      "https://www.example.com/media/sitemap/sitemap_en.xml",
      "https://www.example.com/it_it/ring-1",
    ])));
    expect(await collectSitemapUrls(ORIGIN, 3000, 24, "jina-key")).toEqual(["https://www.example.com/it_it/ring-1"]);
  });

  it("ignores another host that happens to appear in the rendered text", async () => {
    vi.stubGlobal("fetch", site(ROBOTS_ONLY, () => rendered([
      "https://cdn.other.com/asset.png", "https://www.example.com/it_it/ring-1",
    ])));
    expect(await collectSitemapUrls(ORIGIN, 3000, 24, "jina-key")).toEqual(["https://www.example.com/it_it/ring-1"]);
  });

  it("retries the renderer without the key when the key is the thing being refused", async () => {
    // A rejected or exhausted key is a fact about OUR configuration, not about the house's
    // website — and it was reported as the latter. 401 comes back in a quarter of a second,
    // so the stage that should have spent thirty seconds reading Damiani's sitemap finished
    // in five and recorded the site as having no catalogue.
    const calls: { url: string; auth: boolean }[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://r.jina.ai/")) {
        return Promise.resolve(url.endsWith("robots.txt")
          ? ok("Sitemap: https://www.example.com/it.xml\n") : blocked());
      }
      const auth = Boolean((init?.headers as Record<string, string>)?.Authorization);
      calls.push({ url, auth });
      return Promise.resolve(auth
        ? new Response("no", { status: 401 })
        : ok("sitemap https://www.example.com/it_it/ring-20059783 end"));
    }));
    const urls = await collectSitemapUrls(ORIGIN, 3000, 24, "expired-key");
    expect(urls).toEqual(["https://www.example.com/it_it/ring-20059783"]);
    expect(calls.map((c) => c.auth)).toEqual([true, false]);
  });

  it("does not retry without the key when the RENDERER is simply down", async () => {
    // A 500 is not an auth problem; asking again unauthenticated just wastes another call.
    let renders = 0;
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://r.jina.ai/")) { renders++; return Promise.resolve(new Response("", { status: 500 })); }
      return Promise.resolve(url.endsWith("robots.txt") ? ok("Sitemap: https://www.example.com/it.xml\n") : blocked());
    }));
    await collectSitemapUrls(ORIGIN, 3000, 24, "a-key");
    expect(renders).toBe(1);
  });

  it("gives up quietly when even the renderer cannot read it", async () => {
    vi.stubGlobal("fetch", site(ROBOTS_ONLY, () => blocked()));
    await expect(collectSitemapUrls(ORIGIN, 3000, 24, "jina-key")).resolves.toEqual([]);
  });
});

describe("no one section eats the whole crawl", () => {
  // Damiani publishes 344 store-locator pages. At a 500-page budget that is 69% of the crawl
  // spent on boutique addresses, with nothing left for the catalogue or for the policies the
  // assistant has to answer from.
  const locators = Array.from({ length: 344 }, (_, i) => `https://www.example.com/it_it/storelocator/shop-${i}`);
  const rest = [
    "https://www.example.com/it_it/gioielleria/anelli",
    "https://www.example.com/it_it/spedizioni-e-resi",
    "https://www.example.com/it_it/contatti",
  ];

  it("lets the rest of the site through ahead of one section's overflow", () => {
    const out = spreadAcrossSections([...locators, ...rest], 500);
    const firstNonLocator = out.findIndex((u) => !u.includes("/storelocator/"));
    // A quarter of the budget, and then everything else.
    expect(firstNonLocator).toBe(125);
    expect(out.slice(125, 128)).toEqual(rest);
  });

  it("keeps every url — the overflow queues behind, it is not dropped", () => {
    const all = [...locators, ...rest];
    const out = spreadAcrossSections(all, 500);
    expect(out).toHaveLength(all.length);
    expect(new Set(out)).toEqual(new Set(all));
  });

  it("leaves a site with no dominant section in its own order", () => {
    expect(spreadAcrossSections(rest, 500)).toEqual(rest);
  });

  it("gives a small budget a floor, so a short crawl is not all one page", () => {
    // 25% of 12 is 3; the floor keeps it usable.
    const out = spreadAcrossSections(locators, 12);
    expect(out.findIndex((u) => u.endsWith("shop-20"))).toBe(20);
  });

  it("treats each product page as its own section, so products are never capped", () => {
    const products = Array.from({ length: 300 }, (_, i) => `https://www.example.com/it_it/ring-${i}-2005978${i}`);
    expect(spreadAcrossSections(products, 500)).toEqual(products);
  });

  it("does not throw on something that is not a url", () => {
    expect(() => spreadAcrossSections(["not a url", "also not"], 100)).not.toThrow();
  });
});

describe("turning a page into text a reader can use", () => {
  it("keeps a table cell beside its label instead of below it", async () => {
    // A table CELL is not a paragraph. Ending every </td> with a newline split
    // "Sede Legale | Piazza Damiano Grassi Damiani 1" into two lines, and a label with its
    // value on the next line is a label with no value as far as any reader is concerned.
    const { extractContent } = await import("../../supabase/functions/_shared/crawl.ts");
    const html = "<html><body><table><tr><td>Sede Legale</td><td>Via Cusani 5, 20121 Milano</td></tr>" +
      "<tr><td>P. IVA</td><td>01234567890</td></tr></table></body></html>";
    const { text } = extractContent(html);
    expect(text).toContain("Sede Legale Via Cusani 5, 20121 Milano");
    // The ROW still ends a line, so the table's shape survives.
    expect(text).toMatch(/Milano\s*\n/);
  });

  it("does the same for a definition list, the other way a house lays this out", async () => {
    const { extractContent } = await import("../../supabase/functions/_shared/crawl.ts");
    const { text } = extractContent(
      "<html><body><dl><dt>Siège social</dt><dd>2 Rue du Pont Neuf, 75001 Paris</dd></dl></body></html>",
    );
    expect(text).toContain("Siège social 2 Rue du Pont Neuf, 75001 Paris");
  });

  it("still breaks a line where a paragraph ends", async () => {
    // The fix for cells must not run every paragraph on the page together.
    const { extractContent } = await import("../../supabase/functions/_shared/crawl.ts");
    const { text } = extractContent("<html><body><p>First.</p><p>Second.</p></body></html>");
    expect(text).toMatch(/First\.\s*\n\s*Second\./);
  });
});
