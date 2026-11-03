// Shopify as a knowledge source: the shop's own pages, blog articles and
// legal policies, read from the Admin GraphQL API.
//
// The public crawl already reaches most of this for a Shopify house, so why
// connect? Because the crawl reads what a theme happens to render, through a
// sitemap that may or may not list it, and weekly. The Admin API returns the
// text the house actually wrote — every page including ones the menu forgot,
// every article, the refund and shipping policies verbatim — with a modified
// time, so a policy edited this morning is in the assistant this afternoon.
//
// Products are deliberately NOT turned into documents: the catalogue already
// lives in storefront_products / storefront_variants, where the assistant can
// count and price it with SQL. A thousand product "documents" would crowd the
// prose this source exists to bring in out of every search.
//
// Admin REST is legacy for new apps, so this is GraphQL. Pure mapping lives
// here and is unit-tested; the call itself is a thin fetch.

import { decodeEntities } from "./html-entities.ts";

export const CONTENT_API_VERSION = "2026-07";

// read_content covers pages and articles (read_online_store_pages is the
// narrower alternative a merchant may have granted instead). Policies need
// read_legal_policies; without it we still sync pages and articles.
export const CONTENT_SCOPES = ["read_content", "read_legal_policies"] as const;

export function contentScopeGaps(granted: string[] | null | undefined): { canPages: boolean; canPolicies: boolean } {
  const g = new Set((granted ?? []).map((s) => s.trim()));
  // A write scope implies its read.
  const has = (s: string) => g.has(s) || g.has(s.replace(/^read_/, "write_"));
  return {
    canPages: has("read_content") || has("read_online_store_pages"),
    canPolicies: has("read_legal_policies"),
  };
}

// ── The queries ──────────────────────────────────────────────────────────────

export const SHOP_QUERY = `query { shop { name primaryDomain { url } } }`;

export const PAGES_QUERY = `query Pages($after: String) {
  pages(first: 50, after: $after) {
    nodes { id title handle body isPublished updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const ARTICLES_QUERY = `query Articles($after: String) {
  articles(first: 50, after: $after) {
    nodes { id title handle body summary isPublished updatedAt tags blog { title handle } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const POLICIES_QUERY = `query { shop { shopPolicies { id type title body url updatedAt } } }`;

export type ShopPage = { id: string; title: string; handle: string; body: string; isPublished: boolean; updatedAt: string };
export type ShopArticle = {
  id: string; title: string; handle: string; body: string; summary?: string | null; isPublished: boolean;
  updatedAt?: string | null; tags?: string[]; blog?: { title?: string; handle?: string } | null;
};
export type ShopPolicy = { id: string; type: string; title: string; body: string; url: string; updatedAt: string };

// ── HTML → text ──────────────────────────────────────────────────────────────

/**
 * Shopify bodies are rich-text HTML. Keep the structure the chunker uses —
 * paragraphs and list items on their own lines — and drop everything else.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = html
    .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li(\s[^>]*)?>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|table|section|article|blockquote)>/gi, "\n\n")
    .replace(/<(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Mapping to knowledge documents ───────────────────────────────────────────

export type ContentItem = {
  external_id: string;
  title: string;
  category: string;
  content: string;
  source_url: string | null;
  updated_at: string | null;
};

const base = (shopUrl: string | null) => (shopUrl ?? "").replace(/\/+$/, "");

/** Pages a shop always has that carry no knowledge. */
const BOILERPLATE_PAGE = /^(contact|contatti|contattaci|search|cerca|cart|carrello|account|login|wishlist|404)$/i;

export function pageCategory(handle: string, title: string): string {
  const h = `${handle} ${title}`.toLowerCase();
  if (/(shipping|spedizion|return|resi\b|reso\b|refund|rimbors|warranty|garanzi|terms|condizioni|privacy|cookie|legal)/.test(h)) return "policy";
  if (/(about|chi-siamo|chi siamo|story|storia|heritage|atelier|craft|artigian|maison|history|founder|fondat)/.test(h)) return "storytelling";
  if (/(care|cura|size|taglie|guide|guida|faq|bespoke|su-misura|made-to-measure|appointment|appuntamento)/.test(h)) return "training";
  return "other";
}

export function mapPage(p: ShopPage, shopUrl: string | null): ContentItem | null {
  if (!p.isPublished || BOILERPLATE_PAGE.test(p.handle)) return null;
  const text = htmlToText(p.body);
  if (text.length < 40) return null;
  return {
    external_id: p.id,
    title: (p.title || p.handle).slice(0, 300),
    category: pageCategory(p.handle, p.title),
    content: `${p.title}\n\n${text}`,
    source_url: shopUrl ? `${base(shopUrl)}/pages/${p.handle}` : null,
    updated_at: p.updatedAt ?? null,
  };
}

export function mapArticle(a: ShopArticle, shopUrl: string | null): ContentItem | null {
  if (!a.isPublished) return null;
  const text = htmlToText(a.body);
  if (text.length < 40) return null;
  const blog = a.blog?.title?.trim();
  const tags = (a.tags ?? []).filter(Boolean);
  const header = [a.title, blog ? `(${blog})` : "", tags.length ? `— ${tags.join(", ")}` : ""].filter(Boolean).join(" ");
  return {
    external_id: a.id,
    title: (a.title || a.handle).slice(0, 300),
    // Journal posts are how a house tells its story; that is where the assistant
    // looks when a client asks about the atelier or a collection's inspiration.
    category: "storytelling",
    content: `${header}\n\n${text}`,
    source_url: shopUrl && a.blog?.handle ? `${base(shopUrl)}/blogs/${a.blog.handle}/${a.handle}` : null,
    updated_at: a.updatedAt ?? null,
  };
}

export function mapPolicy(p: ShopPolicy): ContentItem | null {
  const text = htmlToText(p.body);
  // An unset policy comes back with an empty body; don't index "Refund policy" alone.
  if (text.length < 40) return null;
  return {
    external_id: p.id,
    title: p.title.slice(0, 300),
    category: "policy",
    content: `${p.title}\n\n${text}`,
    source_url: p.url || null,
    updated_at: p.updatedAt ?? null,
  };
}

// ── The call ─────────────────────────────────────────────────────────────────

export async function shopifyGraphql<T>(
  shop: string, token: string, query: string, variables: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${CONTENT_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    const body = await res.json().catch(() => null) as { data?: T; errors?: { message?: string; extensions?: { code?: string } }[] } | null;
    if (res.status === 401) throw new Error("Shopify rejected the token (401) — the app may have been uninstalled. Reconnect Shopify.");
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const errs = body?.errors ?? [];
    // GraphQL cost throttling arrives as a 200 with a THROTTLED error.
    if (errs.some((e) => e.extensions?.code === "THROTTLED")) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (errs.length) {
      const msg = errs.map((e) => e.message).filter(Boolean).join("; ");
      if (/access denied|ACCESS_DENIED/i.test(msg)) throw new Error(`Shopify: missing a scope (${msg})`);
      throw new Error(`Shopify: ${msg}`);
    }
    if (!body?.data) throw new Error("Shopify returned no data");
    return body.data;
  }
  throw new Error("Shopify kept throttling — will retry on the next run");
}

type Paged<N> = { nodes: N[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

/**
 * Every node of a paged connection, up to maxPages × 50. `complete` is false
 * when the cap cut it short — the sync must not then remove documents for
 * items it simply didn't reach.
 */
export async function fetchAllPaged<N>(
  shop: string, token: string, query: string, key: string, maxPages = 40,
): Promise<{ nodes: N[]; complete: boolean }> {
  const out: N[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const data = await shopifyGraphql<Record<string, Paged<N>>>(shop, token, query, { after });
    const conn = data[key];
    out.push(...(conn?.nodes ?? []));
    if (!conn?.pageInfo?.hasNextPage) return { nodes: out, complete: true };
    after = conn.pageInfo.endCursor;
  }
  return { nodes: out, complete: false };
}
