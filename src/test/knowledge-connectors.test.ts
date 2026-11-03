import { describe, it, expect } from "vitest";
// The shipped modules, not copies of them.
import {
  parseFolderId, planFile, titleFromFileName, categoryFromPath, parseServiceAccount,
} from "../../supabase/functions/_shared/gdrive";
import {
  htmlToText, mapPage, mapArticle, mapPolicy, contentScopeGaps, pageCategory,
} from "../../supabase/functions/_shared/shopify-content";
import {
  normaliseShopDomain, verifyShopifyHmac, signState, verifyState, authorizeUrl, safeReturnTo, OAUTH_SCOPES,
} from "../../supabase/functions/_shared/shopify-oauth";

// NOTE: the Drive and Shopify payloads below are written to the documented API
// shapes, not recorded from a live folder or shop. They prove the mapping is
// self-consistent; re-check against a real source on first connection.

describe("Drive folder links", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  it("reads every way a folder link gets pasted", () => {
    expect(parseFolderId(`https://drive.google.com/drive/folders/${id}`)).toBe(id);
    expect(parseFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id);
    expect(parseFolderId(`https://drive.google.com/drive/u/0/folders/${id}`)).toBe(id);
    expect(parseFolderId(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(parseFolderId(`  ${id}  `)).toBe(id);
  });
  it("refuses a link to a single file — the source is a folder", () => {
    expect(parseFolderId(`https://docs.google.com/document/d/${id}/edit`)).toBeNull();
    expect(parseFolderId(`https://drive.google.com/file/d/${id}/view`)).toBeNull();
    expect(parseFolderId("")).toBeNull();
    expect(parseFolderId("not a link")).toBeNull();
  });
});

describe("what to do with each Drive file", () => {
  it("exports Google-native files as text", () => {
    expect(planFile({ name: "Brand book", mimeType: "application/vnd.google-apps.document" }))
      .toEqual({ how: "export", exportMime: "text/plain", asName: "Brand book.txt" });
    expect(planFile({ name: "Price list", mimeType: "application/vnd.google-apps.spreadsheet" }))
      .toMatchObject({ how: "export", exportMime: "text/csv", asName: "Price list.csv" });
    expect(planFile({ name: "Deck", mimeType: "application/vnd.google-apps.presentation" }).how).toBe("export");
  });
  it("downloads stored files under a name extract-text recognises", () => {
    expect(planFile({ name: "Returns.pdf", mimeType: "application/pdf" })).toEqual({ how: "download", asName: "Returns.pdf" });
    // No extension on the name: the type supplies one.
    expect(planFile({
      name: "Onboarding", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).toEqual({ how: "download", asName: "Onboarding.docx" });
  });
  it("skips what can't be read as text, and says why", () => {
    expect(planFile({ name: "photo.jpg", mimeType: "image/jpeg" }).how).toBe("skip");
    expect(planFile({ name: "Form", mimeType: "application/vnd.google-apps.form" }).how).toBe("skip");
    expect(planFile({ name: "huge.pdf", mimeType: "application/pdf", size: String(30 * 1024 * 1024) }))
      .toEqual({ how: "skip", reason: "larger than 25 MB" });
  });
  it("names and files a document the way the brand filed it", () => {
    expect(titleFromFileName("Protocollo_resi_v3.pdf")).toBe("Protocollo resi v3");
    expect(categoryFromPath(["Policies"], "Returns.pdf")).toBe("policy");
    expect(categoryFromPath(["Formazione", "2026"], "Benvenuto.docx")).toBe("training");
    expect(categoryFromPath(["Collezioni"], "FW26 line sheet")).toBe("product");
    expect(categoryFromPath([], "Brand book")).toBe("storytelling");
    expect(categoryFromPath([], "Residenze estive")).toBe("other"); // "resi" must not match "Residenze"
  });
  it("only accepts a service-account key that can sign", () => {
    expect(parseServiceAccount(JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "k" }))).not.toBeNull();
    expect(parseServiceAccount(JSON.stringify({ client_email: "a@b" }))).toBeNull();
    expect(parseServiceAccount("{oops")).toBeNull();
    expect(parseServiceAccount(undefined)).toBeNull();
  });
});

describe("Shopify content", () => {
  it("turns rich text into paragraphs the chunker can split", () => {
    const text = htmlToText("<h2>Care</h2><p>Store in the pouch.&nbsp;Avoid&nbsp;perfume.</p><ul><li>Silk</li><li>Lace</li></ul><script>x()</script>");
    expect(text).toBe("Care\n\nStore in the pouch. Avoid perfume.\n\n• Silk\n• Lace");
  });

  const shop = "https://www.house.com";
  it("indexes published pages with their public address", () => {
    const item = mapPage({
      id: "gid://shopify/Page/1", title: "Our atelier", handle: "atelier", isPublished: true,
      updatedAt: "2026-10-01T10:00:00Z", body: "<p>Every dress is cut by hand in Milan, in the same atelier since 1986.</p>",
    }, shop);
    expect(item).toMatchObject({
      external_id: "gid://shopify/Page/1", category: "storytelling",
      source_url: "https://www.house.com/pages/atelier", updated_at: "2026-10-01T10:00:00Z",
    });
    expect(item!.content.startsWith("Our atelier\n\n")).toBe(true);
  });
  it("leaves out drafts, empty pages and the contact page", () => {
    const base = { id: "gid://shopify/Page/2", title: "T", updatedAt: "2026-10-01T10:00:00Z", body: "<p>" + "x".repeat(60) + "</p>" };
    expect(mapPage({ ...base, handle: "draft", isPublished: false }, shop)).toBeNull();
    expect(mapPage({ ...base, handle: "contact", isPublished: true }, shop)).toBeNull();
    expect(mapPage({ ...base, handle: "short", isPublished: true, body: "<p>Hi</p>" }, shop)).toBeNull();
  });
  it("files pages by what they are", () => {
    expect(pageCategory("shipping-returns", "Shipping & returns")).toBe("policy");
    expect(pageCategory("size-guide", "Size guide")).toBe("training");
    expect(pageCategory("chi-siamo", "Chi siamo")).toBe("storytelling");
  });
  it("indexes articles with their blog and tags", () => {
    const item = mapArticle({
      id: "gid://shopify/Article/9", title: "Lace from Calais", handle: "lace-from-calais", isPublished: true,
      updatedAt: "2026-09-01T08:00:00Z", tags: ["FW26", "lace"], blog: { title: "Journal", handle: "journal" },
      body: "<p>The FW26 collection uses Leavers lace woven in Calais on nineteenth-century looms.</p>",
    }, shop);
    expect(item).toMatchObject({ category: "storytelling", source_url: "https://www.house.com/blogs/journal/lace-from-calais" });
    expect(item!.content.split("\n")[0]).toBe("Lace from Calais (Journal) — FW26, lace");
  });
  it("indexes policies verbatim, and skips one never written", () => {
    const p = { id: "gid://shopify/ShopPolicy/3", type: "REFUND_POLICY", title: "Refund policy", url: "https://www.house.com/policies/refund-policy", updatedAt: "2026-10-02T00:00:00Z" };
    expect(mapPolicy({ ...p, body: "<p>Returns are accepted within 14 days of delivery, unworn and with tags.</p>" }))
      .toMatchObject({ category: "policy", source_url: p.url });
    expect(mapPolicy({ ...p, body: "" })).toBeNull();
  });
  it("knows which content a token can read", () => {
    expect(contentScopeGaps(["read_content", "read_legal_policies"])).toEqual({ canPages: true, canPolicies: true });
    expect(contentScopeGaps(["write_content"])).toEqual({ canPages: true, canPolicies: false });
    expect(contentScopeGaps(["read_orders", "read_customers"])).toEqual({ canPages: false, canPolicies: false });
  });
});

describe("Shopify install", () => {
  it("accepts only a myshopify address", () => {
    expect(normaliseShopDomain("https://House.myshopify.com/admin")).toBe("house.myshopify.com");
    expect(normaliseShopDomain("house")).toBe("house.myshopify.com");
    expect(normaliseShopDomain("www.house.com")).toBeNull();
  });

  it("asks for an offline token with every scope the connectors use", () => {
    const u = new URL(authorizeUrl("house.myshopify.com", "cid", "https://x.supabase.co/functions/v1/shopify-oauth", "st"));
    expect(u.origin).toBe("https://house.myshopify.com");
    expect(u.searchParams.get("scope")).toBe(OAUTH_SCOPES.join(","));
    expect(u.searchParams.get("grant_options[]")).toBeNull();
  });

  it("verifies Shopify's signature and rejects a tampered one", async () => {
    // Signed the way Shopify documents it: sorted params minus hmac, HMAC-SHA256 hex.
    const secret = "hush";
    const params = new URLSearchParams({ code: "abc", shop: "house.myshopify.com", state: "s", timestamp: "1730000000" });
    const message = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    params.set("hmac", sig);
    expect(await verifyShopifyHmac(params, secret)).toBe(true);
    expect(await verifyShopifyHmac(params, "other secret")).toBe(false);
    params.set("shop", "evil.myshopify.com");
    expect(await verifyShopifyHmac(params, secret)).toBe(false);
  });

  it("round-trips a signed state, and refuses a forged or expired one", async () => {
    const s = await signState({ brand_id: 17, shop: "house.myshopify.com", return_to: "https://app.aioncover.com/lb/knowledge", profile_id: "p" }, "k");
    expect(await verifyState(s, "k")).toMatchObject({ brand_id: 17, shop: "house.myshopify.com" });
    expect(await verifyState(s, "other")).toBeNull();
    const [body, sig] = s.split(".");
    const forged = btoa(JSON.stringify({ ...JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))), brand_id: 2 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyState(`${forged}.${sig}`, "k")).toBeNull();
    const expired = await signState({ brand_id: 17, shop: "h.myshopify.com", return_to: "/", profile_id: null }, "k", -1);
    expect(await verifyState(expired, "k")).toBeNull();
  });

  it("sends people back only to our own app", () => {
    expect(safeReturnTo("https://dev.app.aioncover.com", "/lb/knowledge")).toBe("https://dev.app.aioncover.com/lb/knowledge");
    expect(safeReturnTo("https://evil.com", "/lb/knowledge")).toBeNull();
    expect(safeReturnTo("https://app.aioncover.com", "//evil.com")).toBe("https://app.aioncover.com/");
  });
});
