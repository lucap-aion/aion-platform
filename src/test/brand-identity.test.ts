import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonLdNodes } from "../../supabase/functions/_shared/product-extract";

const html = readFileSync(join(__dirname, "fixtures/ferragamo-home.html"), "utf8");

describe("brand identity, from what the site declares", () => {
  it("finds the logo the site publishes for Google", () => {
    const logo = jsonLdNodes(html)
      .filter((n) => {
        const t = n["@type"];
        const types = Array.isArray(t) ? t.map(String) : [String(t)];
        return types.some((x) => ["Organization", "Corporation", "Brand", "WebSite", "OnlineStore"].includes(x));
      })
      .map((n) => (typeof n.logo === "string" ? n.logo : (n.logo as Record<string, unknown> | undefined)?.url))
      .find(Boolean);
    // Ferragamo declares it; the old harvester only looked at <img> tags and
    // therefore stored nothing, leaving the deck with AION's mark alone.
    expect(logo).toMatch(/^https:\/\/cdn\.ferragamo\.com\/.+logo.+\.png$/i);
  });

  it("picks the LARGEST icon, not the first in the document", () => {
    const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:apple-touch-)?icon[^"']*["'][^>]*>/gi)]
      .map((m) => m[0])
      .map((tag) => ({
        href: tag.match(/href=["']([^"']+)["']/i)?.[1],
        size: Number((tag.match(/sizes=["']([^"']+)["']/i)?.[1] ?? "").split("x")[0]) || 0,
      }))
      .filter((i) => i.href)
      .sort((a, b) => b.size - a.size);
    expect(icons.length).toBeGreaterThan(1);
    // The document lists 57x57 first, which is what got stored.
    expect(icons[0].size).toBeGreaterThan(57);
  });
});
