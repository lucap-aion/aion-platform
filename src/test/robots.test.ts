import { describe, it, expect } from "vitest";
import {
  parseRobots, robotsAllows, rulesToConfig, rulesFromConfig, NO_RULES,
} from "../../supabase/functions/_shared/robots.ts";

// We read robots.txt for its Sitemap: lines and ignored the rest — which is the wrong
// posture for a company crawling the sites of the clients it wants to sign, and part of why
// we get challenged. These are the cases that decide whether honouring it blocks the right
// things or the wrong ones.

const AGENT = "aionknowledgebot";

describe("reading the file", () => {
  it("takes the wildcard group when nothing names us", () => {
    const r = parseRobots("User-agent: *\nDisallow: /checkout/\nCrawl-delay: 5\n", AGENT);
    expect(r.disallow).toEqual(["/checkout/"]);
    expect(r.crawlDelaySeconds).toBe(5);
  });

  it("prefers a group that names us over the wildcard", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: AIONKnowledgeBot\nDisallow: /admin/\n", AGENT);
    // The wildcard bans everything; our own group does not. Taking both would ban the site.
    expect(r.disallow).toEqual(["/admin/"]);
  });

  it("shares one group between consecutive user-agent lines", () => {
    const r = parseRobots("User-agent: Googlebot\nUser-agent: *\nDisallow: /a/\n", AGENT);
    expect(r.disallow).toEqual(["/a/"]);
  });

  it("reads Damiani's file the way Damiani wrote it", () => {
    const r = parseRobots([
      "User-agent: *", "Disallow: /index.php/", "Disallow: /checkout/", "Disallow: /catalog/",
      "Disallow: /*.php$", "Disallow: /*?*price=", "Crawl-delay: 5",
      "Sitemap: https://www.damiani.com/media/sitemap/sitemap_it.xml",
    ].join("\n"), AGENT);
    expect(r.crawlDelaySeconds).toBe(5);
    expect(r.disallow).toContain("/catalog/");
    // A Sitemap: line is not a rule.
    expect(r.disallow.join(" ")).not.toContain("http");
  });

  it("ignores comments, blank lines and anything it does not understand", () => {
    const r = parseRobots("# hello\nUser-agent: *\nDisallow: /a/ # why\nHost: example.com\n", AGENT);
    expect(r.disallow).toEqual(["/a/"]);
  });

  it("treats an EMPTY Disallow as permission, not as a ban on everything", () => {
    // "Disallow:" with no value means nothing is disallowed. Storing it as a rule would
    // match every path and take the whole site off the crawl.
    const r = parseRobots("User-agent: *\nDisallow:\n", AGENT);
    expect(r.disallow).toEqual([]);
    expect(robotsAllows(r, "https://h.com/anything")).toBe(true);
  });

  it("returns nothing to enforce for an empty or absent file", () => {
    expect(parseRobots("", AGENT)).toEqual(NO_RULES);
    expect(robotsAllows(NO_RULES, "https://h.com/x")).toBe(true);
  });
});

describe("deciding one url", () => {
  const rules = parseRobots([
    "User-agent: *",
    "Disallow: /catalog/",
    "Disallow: /*.php$",
    "Disallow: /*?*price=",
    "Allow: /catalog/category/view/",
  ].join("\n"), AGENT);

  it("blocks a disallowed prefix and allows everything else", () => {
    expect(robotsAllows(rules, "https://h.com/catalog/product/9")).toBe(false);
    expect(robotsAllows(rules, "https://h.com/it_it/ring-20059783")).toBe(true);
  });

  it("lets a more specific Allow re-admit a page inside a banned section", () => {
    expect(robotsAllows(rules, "https://h.com/catalog/category/view/id/3")).toBe(true);
  });

  it("honours the end-anchor", () => {
    expect(robotsAllows(rules, "https://h.com/index.php")).toBe(false);
    // Not at the end, so the anchored rule does not apply.
    expect(robotsAllows(rules, "https://h.com/index.php/products")).toBe(true);
  });

  it("matches a wildcard in the middle, query string included", () => {
    expect(robotsAllows(rules, "https://h.com/it_it/rings?price=100-200")).toBe(false);
    expect(robotsAllows(rules, "https://h.com/it_it/rings?colour=gold")).toBe(true);
  });

  it("is not fooled by a pattern that matches only part-way", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a/b/c\n", AGENT);
    expect(robotsAllows(r, "https://h.com/a/b/d")).toBe(true);
    expect(robotsAllows(r, "https://h.com/a/b/c/d")).toBe(false);
  });

  it("allows what it cannot parse rather than blocking it", () => {
    // A crawler that refuses everything on a malformed url stops for no reason.
    expect(robotsAllows(rules, "not a url")).toBe(true);
  });
});

describe("carrying the rules on the source", () => {
  it("survives a round trip", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /a/\nAllow: /a/b\nCrawl-delay: 2.5\n", AGENT);
    expect(rulesFromConfig(rulesToConfig(rules))).toEqual(rules);
  });

  it("reads a config written before any of this existed", () => {
    expect(rulesFromConfig({ max_pages: 500 })).toEqual(NO_RULES);
    expect(rulesFromConfig(null)).toEqual(NO_RULES);
    expect(rulesFromConfig({ robots_disallow: "not an array" })).toEqual(NO_RULES);
  });
});
