// Shopify Admin API orders → the rows we store.
//
// Pure: give it the parsed JSON, get rows back. Nothing here fetches, so the
// whole transform is testable without a shop — which matters, because this was
// written before we had any Shopify account to point it at. What a fixture
// CANNOT prove is on the network side (scopes, rate limits, real pagination
// behaviour); that stays in the edge function, behind a connection that is off
// until someone tests it.

export type AdminOrder = {
  id: number;
  name?: string;                   // "#1001" — the number a human quotes
  order_number?: number;
  created_at?: string;
  processed_at?: string;
  cancelled_at?: string | null;
  currency?: string;
  // current_* reflect edits and refunds; the plain ones are the original.
  total_price?: string;
  current_total_price?: string;
  subtotal_price?: string;
  current_subtotal_price?: string;
  total_discounts?: string;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  email?: string | null;
  phone?: string | null;
  customer?: {
    id?: number;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  line_items?: {
    id?: number;
    product_id?: number | null;
    variant_id?: number | null;
    sku?: string | null;
    title?: string | null;
    name?: string | null;
    variant_title?: string | null;
    quantity?: number;
    price?: string;
    total_discount?: string;
  }[];
  refunds?: {
    refund_line_items?: { line_item_id?: number; quantity?: number }[];
  }[];
};

export type OrderRow = {
  brand_id: number;
  shopify_order_id: number;
  order_number: string | null;
  placed_at: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  total_discounts: number | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  shopify_customer_id: number | null;
};

export type ItemRow = {
  brand_id: number;
  shopify_line_id: number | null;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
  sku: string | null;
  name: string | null;
  variant_title: string | null;
  quantity: number;
  price: number | null;
  total_discount: number | null;
  refunded_quantity: number;
};

const money = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/** Lower-cased, trimmed — the key we match a client on. */
export function emailKey(email: unknown): string | null {
  const s = typeof email === "string" ? email.trim().toLowerCase() : "";
  return s.includes("@") ? s : null;
}

export function mapOrder(o: AdminOrder, brandId: number): { order: OrderRow; items: ItemRow[] } {
  // Guest checkout leaves `customer` null but still carries an email on the
  // order; a logged-in shopper is the other way round when the order was placed
  // by an agent. Take whichever exists.
  const email = emailKey(o.email) ?? emailKey(o.customer?.email);
  const name = [o.customer?.first_name, o.customer?.last_name]
    .map((p) => (p ?? "").trim()).filter(Boolean).join(" ");

  // Refunds arrive as their own objects, one per refund event, each listing the
  // lines it gave back. A piece returned in two goes must add up, so sum rather
  // than take the last.
  const refundedByLine = new Map<number, number>();
  for (const r of o.refunds ?? []) {
    for (const rl of r.refund_line_items ?? []) {
      if (rl.line_item_id == null) continue;
      refundedByLine.set(rl.line_item_id, (refundedByLine.get(rl.line_item_id) ?? 0) + (rl.quantity ?? 0));
    }
  }

  const order: OrderRow = {
    brand_id: brandId,
    shopify_order_id: Number(o.id),
    // `name` is what the client sees on their confirmation ("#1001"); the bare
    // order_number is the fallback when a shop has customised it away.
    order_number: text(o.name) ?? (o.order_number != null ? String(o.order_number) : null),
    // processed_at is when the money moved; created_at is when the draft
    // appeared. For "what did she buy and when", processed_at is the truth.
    placed_at: text(o.processed_at) ?? text(o.created_at),
    currency: text(o.currency),
    subtotal: money(o.current_subtotal_price ?? o.subtotal_price),
    total: money(o.current_total_price ?? o.total_price),
    total_discounts: money(o.total_discounts),
    financial_status: text(o.financial_status),
    // Shopify sends null for "nothing shipped yet" rather than a word.
    fulfillment_status: text(o.fulfillment_status) ?? "unfulfilled",
    cancelled_at: text(o.cancelled_at),
    customer_email: email,
    customer_name: name || null,
    customer_phone: text(o.customer?.phone) ?? text(o.phone),
    shopify_customer_id: o.customer?.id != null ? Number(o.customer.id) : null,
  };

  const items: ItemRow[] = (o.line_items ?? []).map((li) => ({
    brand_id: brandId,
    shopify_line_id: li.id != null ? Number(li.id) : null,
    shopify_product_id: li.product_id != null ? Number(li.product_id) : null,
    shopify_variant_id: li.variant_id != null ? Number(li.variant_id) : null,
    sku: text(li.sku),
    // `name` carries the variant ("Dress - 42"); `title` is the product alone.
    name: text(li.title) ?? text(li.name),
    variant_title: text(li.variant_title),
    quantity: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 1,
    price: money(li.price),
    total_discount: money(li.total_discount),
    refunded_quantity: li.id != null ? (refundedByLine.get(Number(li.id)) ?? 0) : 0,
  }));

  return { order, items };
}

/**
 * The next page's cursor, out of the Link header.
 *
 * Shopify stopped accepting ?page= years ago: pagination is a `page_info`
 * cursor handed back in a Link header, and the ONLY safe way to get it is to
 * read that header. Guessing the next URL, or reusing a cursor with changed
 * query parameters, gets you a 400 — so this returns the whole relative URL's
 * page_info and nothing else.
 *
 * Absent rel="next" means this was the last page.
 */
export function nextPageInfo(linkHeader: string | null | undefined): string | null {
  if (!linkHeader) return null;
  // <https://shop.myshopify.com/admin/api/2025-07/orders.json?limit=250&page_info=abc>; rel="next"
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
    if (!m) continue;
    try {
      return new URL(m[1]).searchParams.get("page_info");
    } catch {
      const q = m[1].match(/[?&]page_info=([^&]+)/);
      return q ? decodeURIComponent(q[1]) : null;
    }
  }
  return null;
}

/** The scopes an order sync needs, and what is missing from a token's grant. */
export const REQUIRED_SCOPES = ["read_orders", "read_customers"] as const;

export function missingScopes(granted: string[] | null | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim().toLowerCase()));
  return REQUIRED_SCOPES.filter((s) => !have.has(s));
}
