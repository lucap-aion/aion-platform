import { describe, it, expect } from "vitest";
// The shipped module, not a copy of it.
import {
  mapOrder, nextPageInfo, missingScopes, emailKey, type AdminOrder,
} from "../../supabase/functions/_shared/shopify-orders";

// NOTE, and it matters: unlike the catalogue fixture, this payload is NOT
// recorded from a live shop — we have no Shopify account yet. It is built to
// Shopify's documented Admin API order shape, so it proves the transform is
// self-consistent and handles the cases we know exist; it cannot prove the wire
// format. Re-record it against a development store before switch-on.
const order: AdminOrder = {
  id: 5123456789,
  name: "#1042",
  order_number: 1042,
  created_at: "2026-08-30T09:12:00+02:00",
  processed_at: "2026-08-31T18:04:11+02:00",
  currency: "EUR",
  subtotal_price: "1598.00",
  current_subtotal_price: "798.00",
  total_price: "1598.00",
  current_total_price: "798.00",
  total_discounts: "0.00",
  financial_status: "partially_refunded",
  fulfillment_status: null,
  email: "Giulia.Rossi@example.com ",
  customer: { id: 77001, email: "giulia.rossi@example.com", first_name: "Giulia", last_name: "Rossi", phone: "+39 333 1234567" },
  line_items: [
    { id: 1, product_id: 900, variant_id: 9001, sku: "LB-BLOUSE-42", title: "Cotton blouse with printed roses", variant_title: "42", quantity: 1, price: "798.00", total_discount: "0.00" },
    { id: 2, product_id: 901, variant_id: 9011, sku: "LB-PANTS-42", title: "Chiné Floral Cotton Pants", variant_title: "42", quantity: 1, price: "800.00", total_discount: "0.00" },
  ],
  // Returned in two goes — one unit, then nothing more on that line.
  refunds: [
    { refund_line_items: [{ line_item_id: 2, quantity: 1 }] },
  ],
};

describe("an order from the Shopify Admin API", () => {
  it("keeps what the client actually paid, not the original total", () => {
    const { order: row } = mapOrder(order, 17);
    // current_* reflects the refund. Storing total_price would have this client
    // spending €1,598 on a purchase she half returned.
    expect(row.total).toBe(798);
    expect(row.subtotal).toBe(798);
    expect(row.financial_status).toBe("partially_refunded");
  });

  it("dates the sale from when the money moved", () => {
    const { order: row } = mapOrder(order, 17);
    expect(row.placed_at).toBe("2026-08-31T18:04:11+02:00");
  });

  it("normalises the email so a client matches whatever case they typed", () => {
    const { order: row } = mapOrder(order, 17);
    expect(row.customer_email).toBe("giulia.rossi@example.com");
    expect(row.customer_name).toBe("Giulia Rossi");
  });

  it("counts a returned piece as returned", () => {
    const { items } = mapOrder(order, 17);
    const pants = items.find((i) => i.sku === "LB-PANTS-42")!;
    const blouse = items.find((i) => i.sku === "LB-BLOUSE-42")!;
    expect(pants.refunded_quantity).toBe(1);
    expect(blouse.refunded_quantity).toBe(0);
    // The size is on the line, which is how an order joins back to a variant.
    expect(pants.variant_title).toBe("42");
  });

  it("adds up a piece returned across two refunds", () => {
    const twice: AdminOrder = {
      ...order,
      line_items: [{ id: 7, sku: "X", title: "Thing", quantity: 3, price: "10.00" }],
      refunds: [
        { refund_line_items: [{ line_item_id: 7, quantity: 1 }] },
        { refund_line_items: [{ line_item_id: 7, quantity: 1 }] },
      ],
    };
    expect(mapOrder(twice, 17).items[0].refunded_quantity).toBe(2);
  });

  it("survives a guest checkout, which has no customer at all", () => {
    const guest: AdminOrder = { ...order, customer: null, email: "walkin@example.com" };
    const { order: row } = mapOrder(guest, 17);
    expect(row.customer_email).toBe("walkin@example.com");
    expect(row.customer_name).toBeNull();
    expect(row.shopify_customer_id).toBeNull();
  });

  it("calls nothing-shipped-yet what it is, instead of leaving a null", () => {
    expect(mapOrder(order, 17).order.fulfillment_status).toBe("unfulfilled");
  });
});

describe("pagination, which is a Link header and nothing else", () => {
  it("reads the next cursor out of the header", () => {
    const h = '<https://x.myshopify.com/admin/api/2025-07/orders.json?limit=250&page_info=abc123>; rel="next"';
    expect(nextPageInfo(h)).toBe("abc123");
  });

  it("takes next, not previous, when both are offered", () => {
    const h = '<https://x.myshopify.com/admin/api/2025-07/orders.json?page_info=older>; rel="previous", '
      + '<https://x.myshopify.com/admin/api/2025-07/orders.json?page_info=newer>; rel="next"';
    expect(nextPageInfo(h)).toBe("newer");
  });

  it("stops at the last page", () => {
    const h = '<https://x.myshopify.com/admin/api/2025-07/orders.json?page_info=older>; rel="previous"';
    expect(nextPageInfo(h)).toBeNull();
    expect(nextPageInfo(null)).toBeNull();
  });
});

describe("scopes", () => {
  it("names what is missing rather than failing with a bare 403", () => {
    expect(missingScopes(["read_products", "read_orders"])).toEqual(["read_customers"]);
    expect(missingScopes(["read_orders", "read_customers"])).toEqual([]);
    expect(missingScopes(null)).toEqual(["read_orders", "read_customers"]);
  });

  it("ignores an address that isn't one", () => {
    expect(emailKey("not-an-email")).toBeNull();
    expect(emailKey(null)).toBeNull();
  });
});
