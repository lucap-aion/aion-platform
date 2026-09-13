import { describe, it, expect, vi, afterEach } from "vitest";
import { collectSitemapUrls } from "../../supabase/functions/_shared/crawl.ts";

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

  it("does not render when there is no key", async () => {
    const fetchSpy = site(ROBOTS_ONLY);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await collectSitemapUrls(ORIGIN)).toEqual([]);
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith("https://r.jina.ai/"))).toHaveLength(0);
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

  it("gives up quietly when even the renderer cannot read it", async () => {
    vi.stubGlobal("fetch", site(ROBOTS_ONLY, () => blocked()));
    await expect(collectSitemapUrls(ORIGIN, 3000, 24, "jina-key")).resolves.toEqual([]);
  });
});
